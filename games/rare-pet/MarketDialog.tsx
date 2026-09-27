import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { PET_DEPLOYMENT, type PetWalletSession } from './wallet';
import { readRareMarketPage, type RareMarketCursor, type RareMarketToken } from './market-catalog';
import { readMarketBalances, readMarketSwapQuote, sendMarketApproval, sendMarketSwap, getMarketTransaction, subscribeMarketTransactions, refreshMarketTransaction, type MarketSwapQuote } from './market-swap';
import './market.css';

type Side = 'buy' | 'sell';
const problem = (cause: unknown) => cause instanceof Error ? cause.message : 'This request could not be completed. Please try again.';
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const explorer = (address: string) => `${PET_DEPLOYMENT.explorer}/address/${address}`;
function amountText(amount: bigint, decimals: number, digits = 8) {
  const exact = formatUnits(amount, decimals), [whole, fraction] = exact.split('.');
  if (!fraction || fraction.length <= digits) return exact;
  if (amount > 0n && whole === '0' && !/[1-9]/.test(fraction.slice(0, digits))) return `<0.${'0'.repeat(digits - 1)}1`;
  return `${whole}.${fraction.slice(0, digits).replace(/0+$/, '')}`.replace(/\.$/, '');
}
function TokenImage({ token }: { token: RareMarketToken }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [token.imageUrl]);
  return <span className="market-token-image">{token.imageUrl && !failed
    ? <img src={token.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <span aria-hidden="true">{token.symbol.slice(0, 2).toUpperCase()}</span>}</span>;
}

export function MarketDialog({ session, close }: { session: PetWalletSession; close: () => void }) {
  const wallet = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const account = wallet.status === 'connected' && wallet.account ? wallet.account as Address : null;
  const transaction = useSyncExternalStore(subscribeMarketTransactions, () => getMarketTransaction(account));
  const unresolved = transaction && ['awaiting-wallet', 'pending', 'unverified'].includes(transaction.status) ? transaction : null;
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), writeLock = useRef(false), work = useRef(0);
  const catalogueAbort = useRef<AbortController | null>(null), catalogueWork = useRef(0), catalogueLock = useRef(false);
  const titleId = useId(), queryId = useId(), pairId = useId(), amountId = useId(), slippageId = useId();
  const [tokens, setTokens] = useState<readonly RareMarketToken[]>([]), [cursor, setCursor] = useState<RareMarketCursor | null>(null);
  const [complete, setComplete] = useState(false), [loading, setLoading] = useState(false), [catalogueError, setCatalogueError] = useState('');
  const [scanned, setScanned] = useState<{ from: bigint; to: bigint } | null>(null);
  const [query, setQuery] = useState(''), [pair, setPair] = useState('all');
  const [selected, setSelected] = useState<RareMarketToken | null>(null), [side, setSide] = useState<Side>('buy');
  const [amount, setAmount] = useState(''), [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<MarketSwapQuote | null>(null), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [lastHash, setLastHash] = useState<Hex | null>(null);
  const [copied, setCopied] = useState(''), [now, setNow] = useState(Date.now());
  const [balances, setBalances] = useState<{ asset: bigint; quote: bigint } | null>(null), [balanceError, setBalanceError] = useState(''), [balanceLoading, setBalanceLoading] = useState(false), [balanceRefresh, setBalanceRefresh] = useState(0);
  const tradePanel = useRef<HTMLElement>(null);

  async function loadCatalogue(reset = false) {
    if (catalogueLock.current || (!reset && complete)) return;
    catalogueLock.current = true; const task = ++catalogueWork.current;
    catalogueAbort.current?.abort(); const controller = new AbortController(); catalogueAbort.current = controller;
    setLoading(true); setCatalogueError('');
    try {
      const page = await readRareMarketPage({ ...(reset || !cursor ? {} : { cursor }), signal: controller.signal });
      if (!alive.current || task !== catalogueWork.current) return;
      setTokens(previous => {
        const byAddress = new Map((reset ? [] : previous).map(token => [token.asset.toLowerCase(), token]));
        for (const token of page.items) byAddress.set(token.asset.toLowerCase(), token);
        return [...byAddress.values()].sort((a, b) => a.blockNumber === b.blockNumber ? a.asset.localeCompare(b.asset) : a.blockNumber > b.blockNumber ? -1 : 1);
      });
      setCursor(page.cursor); setComplete(page.complete);
      setScanned(previous => ({ from: reset || !previous || page.scannedFromBlock < previous.from ? page.scannedFromBlock : previous.from,
        to: reset || !previous || page.scannedToBlock > previous.to ? page.scannedToBlock : previous.to }));
    } catch (cause) { if (alive.current && !controller.signal.aborted && task === catalogueWork.current) setCatalogueError(problem(cause)); }
    finally { if (task === catalogueWork.current) { catalogueLock.current = false; if (alive.current) setLoading(false); } }
  }
  useEffect(() => {
    alive.current = true; dialog.current?.showModal(); void loadCatalogue(true);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; work.current++; catalogueWork.current++; catalogueLock.current = false; catalogueAbort.current?.abort(); clearInterval(timer); dialog.current?.close(); };
  }, []);
  useEffect(() => {
    work.current++; setQuote(null); setError('');
    if (!writeLock.current) { setBusy(''); setStatus(''); }
  }, [wallet.revision, wallet.status, wallet.account]);
  useEffect(() => {
    setBalances(null); setBalanceError(''); setBalanceLoading(false);
    if (!selected || !account) return;
    let active = true; setBalanceLoading(true);
    void readMarketBalances(selected, account).then(value => { if (active) setBalances(value); })
      .catch(cause => { if (active) setBalanceError(problem(cause)); }).finally(() => { if (active) setBalanceLoading(false); });
    return () => { active = false; };
  }, [selected, account, wallet.revision, balanceRefresh]);

  const pairs = useMemo(() => [...new Map(tokens.map(token => [token.quote.id, token.quote])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol)), [tokens]);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return tokens.filter(token => (pair === 'all' || token.quote.id === pair) && (!search || token.name.toLowerCase().includes(search)
      || token.symbol.toLowerCase().includes(search.replace(/^\$/, '')) || token.asset.toLowerCase().includes(search)));
  }, [tokens, pair, query]);
  const frozen = !!busy || !!unresolved;
  const inputSymbol = selected ? side === 'buy' ? selected.quote.symbol : selected.symbol : '';
  const outputSymbol = selected ? side === 'buy' ? selected.symbol : selected.quote.symbol : '';
  const inputDecimals = selected ? side === 'buy' ? selected.quote.decimals : selected.decimals : 18;
  const inputBalance = quote && quote.account?.toLowerCase() === account?.toLowerCase() && quote.balance !== null ? quote.balance : balances ? side === 'buy' ? balances.quote : balances.asset : null;
  const outputBalance = balances ? side === 'buy' ? balances.asset : balances.quote : null;
  const outputDecimals = selected ? side === 'buy' ? selected.decimals : selected.quote.decimals : 18;
  const expired = !!quote && quote.expiresAt <= now;
  const enough = !!quote && quote.balance !== null && quote.balance >= quote.amountIn;
  const quoteOwned = !!quote && !!account && quote.account?.toLowerCase() === account.toLowerCase();

  function invalidateQuote() { work.current++; setQuote(null); setError(''); setStatus(''); setLastHash(null); }
  function selectToken(token: RareMarketToken) {
    if (frozen) return;
    invalidateQuote(); setSelected(token); setAmount(''); setSide('buy');
    window.requestAnimationFrame(() => tradePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
  function switchSide(next: Side) { if (frozen || next === side) return; invalidateQuote(); setSide(next); setAmount(''); }
  async function copyAddress(address: string) {
    try { await navigator.clipboard.writeText(address); if (alive.current) setCopied(address); }
    catch { if (alive.current) setError('Copy was unavailable. Select the full contract address in the token details.'); }
  }
  function slippageBps() {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(slippage)) throw new Error('Enter slippage as a percentage with up to two decimal places.');
    const bps = Math.round(Number(slippage) * 100);
    if (!Number.isSafeInteger(bps) || bps < 10 || bps > 500) throw new Error('Choose slippage between 0.1% and 5%.');
    return bps;
  }
  async function quoteTrade(event?: FormEvent) {
    event?.preventDefault();
    if (!selected || writeLock.current || unresolved || busy) return;
    const task = ++work.current;
    setBusy('quote'); setError(''); setStatus('Checking this pool and your exact input…'); setQuote(null);
    try {
      const next = await readMarketSwapQuote({ market: selected, side, amount, slippageBps: slippageBps(), ...(account ? { account } : {}) });
      if (!alive.current || task !== work.current) return;
      setQuote(next); setStatus('Quote ready. Review what you pay and the minimum you receive.');
    } catch (cause) { if (alive.current && task === work.current) { setError(problem(cause)); setStatus(''); } }
    finally { if (alive.current && task === work.current) setBusy(''); }
  }
  async function send(kind: 'approval' | 'swap') {
    if (!quote || !account || writeLock.current || unresolved || busy || expired || !quoteOwned || !enough) return;
    if ((kind === 'swap' && quote.approval) || (kind === 'approval' && !quote.approval)) return;
    const reviewed = quote, owner = account, revision = wallet.revision, task = ++work.current;
    writeLock.current = true; setBusy(kind); setError(''); setStatus(kind === 'approval' ? 'Confirm this approval in your wallet.' : 'Confirm your swap in your wallet.');
    const assertActive = () => {
      const current = session.getSnapshot();
      if (!alive.current || task !== work.current || current.revision !== revision || current.status !== 'connected'
        || current.account?.toLowerCase() !== owner.toLowerCase()) throw new Error('Your trading wallet or this review changed. Refresh the quote before continuing.');
    };
    const onHash = (hash: Hex) => {
      if (alive.current) { setLastHash(hash); setStatus(kind === 'approval' ? 'Approval sent. Waiting for confirmation…' : 'Swap sent. Waiting for confirmation…'); }
    };
    try {
      assertActive();
      const options = { session, account: owner, revision, quote: reviewed, onHash, assertActive };
      const result = kind === 'approval' ? await sendMarketApproval(options) : await sendMarketSwap(options);
      if (!alive.current || task !== work.current) return;
      setLastHash(result.transactionHash); setQuote(null); setBalanceRefresh(value => value + 1);
      setStatus(kind === 'approval' ? 'Approval confirmed. Get a fresh quote to review the next step.' : `${side === 'buy' ? 'Buy' : 'Sell'} confirmed. Your tokens are in your connected wallet.`);
    } catch (cause) {
      const text = problem(cause);
      if (alive.current) { setError(text); setStatus(''); }
    } finally { writeLock.current = false; if (alive.current) setBusy(''); }
  }
  async function recheckTransaction() {
    if (!account || busy || writeLock.current) return;
    const owner = account; setBusy('recheck'); setError('');
    try {
      const checked = await refreshMarketTransaction(owner);
      if (!alive.current) return;
      if (checked?.status === 'confirmed') { setQuote(null); setLastHash(checked.hash); setBalanceRefresh(value => value + 1); setStatus(`${checked.kind === 'swap' ? 'Swap' : 'Approval'} confirmed. Get a fresh quote to continue.`); }
      else if (checked?.error) setError(checked.error);
    } catch (cause) { if (alive.current) setError(problem(cause)); }
    finally { if (alive.current) setBusy(''); }
  }
  async function connect() {
    setError('');
    try { if (wallet.status === 'wrong-network') await session.switchNetwork(); else await session.connect(); }
    catch (cause) { if (alive.current) setError(problem(cause)); }
  }
  function requestClose() { if (!writeLock.current) close(); }

  return <dialog ref={dialog} className="pet-dialog market-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => { if (event.target === dialog.current) requestClose(); }}>
    <header className="dialog-heading"><h2 id={titleId}>BUY / SELL</h2><button type="button" aria-label="Close Buy / Sell" disabled={busy === 'approval' || busy === 'swap'} onClick={requestClose}>×</button></header>
    <div className="market-content">
      <div className="market-intro"><div><span className="market-eyebrow">THE RAREPET MARKET</span><h3>Meet your next rare find.</h3><p>Explore tokens launched by Rare Friends and their people.</p></div><span className="market-network">ROBINHOOD</span></div>
      <div className="market-wallet"><div><b>YOUR TRADING WALLET</b><span>Buys and sells use your connected owner wallet.</span></div>{account ? <button className="market-address" type="button" onClick={() => void copyAddress(account)} aria-label="Copy your trading wallet address">{shortAddress(account)} {copied === account ? '✓' : '⧉'}</button> : <button className="market-connect" type="button" onClick={() => void connect()} disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'}>{wallet.status === 'wrong-network' ? 'SWITCH TO ROBINHOOD' : wallet.status === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET ↗'}</button>}</div>
      {wallet.error && <p className="market-error" role="alert">{wallet.error}</p>}
      {unresolved && <div className="market-pending" role="status"><b>{unresolved.kind === 'swap' ? 'SWAP' : 'APPROVAL'} {unresolved.status === 'awaiting-wallet' ? 'AWAITING YOUR WALLET' : 'AWAITING VERIFICATION'}</b><p>{unresolved.error || (unresolved.status === 'awaiting-wallet' ? 'Review the request in your connected wallet.' : 'Your transaction was submitted. Its result must be verified before another trade.')}</p>{unresolved.hash && <a href={`${PET_DEPLOYMENT.explorer}/tx/${unresolved.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>}{unresolved.status !== 'awaiting-wallet' && <button type="button" disabled={!!busy} onClick={() => void recheckTransaction()}>{busy === 'recheck' ? 'CHECKING…' : 'CHECK TRANSACTION STATUS'}</button>}</div>}
      {!unresolved && transaction?.status === 'confirmed' && !selected && <p className="market-status" role="status">Your last {transaction.kind === 'swap' ? 'swap' : 'approval'} is confirmed.{transaction.hash && <> <a href={`${PET_DEPLOYMENT.explorer}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a></>}</p>}
      <div className={`market-layout${selected ? ' has-selection' : ''}`}>
        <section className="market-browser" aria-label="RarePet launched tokens">
          <div className="market-filters"><label htmlFor={queryId}>FIND A TOKEN<input id={queryId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, ticker or contract address" autoComplete="off"/></label><label htmlFor={pairId}>PAIRED WITH<select id={pairId} value={pair} onChange={event => setPair(event.target.value)}><option value="all">All pairs</option>{pairs.map(asset => <option key={asset.id} value={asset.id}>{asset.symbol}</option>)}</select></label></div>
          <div className="market-results"><span>{visible.length} TOKEN{visible.length === 1 ? '' : 'S'}{!complete && tokens.length ? ' LOADED' : ''}</span><button type="button" disabled={loading || frozen} onClick={() => void loadCatalogue(true)}>REFRESH ↻</button></div>
          {loading && !tokens.length && <div className="market-empty" role="status"><span className="market-empty-mark" aria-hidden="true">✦</span><h4>Finding RarePet launches…</h4><p>Checking the launch history on Robinhood Chain.</p></div>}
          {catalogueError && <div className="market-error" role="alert"><p>{catalogueError}</p><button type="button" disabled={loading} onClick={() => void loadCatalogue(!cursor)}>RETRY LOADING</button></div>}
          {!loading && !catalogueError && !visible.length && <div className="market-empty"><span className="market-empty-mark" aria-hidden="true">✦</span><h4>{tokens.length ? 'No matching tokens.' : complete ? 'A new market starts here.' : 'More history to explore.'}</h4><p>{tokens.length ? 'Try another name, ticker, contract address or pair.' : complete ? 'RarePet tokens will appear here after their launches confirm.' : 'No launches in this range. Load earlier history to keep looking.'}</p>{!!tokens.length && <button type="button" onClick={() => { setQuery(''); setPair('all'); }}>CLEAR FILTERS</button>}{!tokens.length && complete && <a href="/launch/">LAUNCH A TOKEN ↗</a>}</div>}
          {!!visible.length && <div className="market-token-grid">{visible.map(token => <article className={`market-token-card${selected?.asset.toLowerCase() === token.asset.toLowerCase() ? ' is-selected' : ''}`} key={token.asset}>
            <button className="market-select-token" type="button" disabled={frozen} aria-pressed={selected?.asset.toLowerCase() === token.asset.toLowerCase()} aria-label={`Trade ${token.name}, ${token.symbol}, paired with ${token.quote.symbol}`} onClick={() => selectToken(token)}><TokenImage token={token}/><span className="market-card-title"><b>{token.name}</b><span>${token.symbol}</span></span><span className="market-card-meta"><span>{token.quote.symbol} PAIR</span><span>{token.fee / 10_000}% FEE</span></span><span className="market-card-creator">{token.mode === 'friend' ? `RARE FRIEND #${token.tokenId}` : 'WALLET LAUNCH'}<span aria-hidden="true">↗</span></span></button>
            <div className="market-card-links"><button type="button" onClick={() => void copyAddress(token.asset)} aria-label={`Copy ${token.symbol} contract address`}>{copied === token.asset ? 'COPIED ✓' : `${shortAddress(token.asset)} ⧉`}</button><a href={explorer(token.asset)} target="_blank" rel="noreferrer" aria-label={`View ${token.symbol} on Blockscout`}>EXPLORER ↗</a></div>
          </article>)}</div>}
          {!complete && !loading && <button className="market-load-more" type="button" onClick={() => void loadCatalogue(false)}>LOAD EARLIER LAUNCHES <span>↓</span></button>}
          {loading && !!tokens.length && <p className="market-loading" role="status">Loading more launch history…</p>}
          {scanned && <p className="market-scan-note">{complete ? 'Launch history loaded' : 'Search covers loaded tokens; load earlier launches for more.'}<span>Blocks {scanned.from.toLocaleString()}–{scanned.to.toLocaleString()}</span></p>}
        </section>
        {selected && <section ref={tradePanel} className="market-trade" aria-label={`Trade ${selected.symbol}`}>
          <div className="market-trade-heading"><TokenImage token={selected}/><div><h4>{selected.name}</h4><span>${selected.symbol} / {selected.quote.symbol}</span></div><button type="button" aria-label="Close token trade" disabled={frozen} onClick={() => { invalidateQuote(); setSelected(null); }}>×</button></div>
          <div className="market-token-address"><span>TOKEN CONTRACT</span><code>{selected.asset}</code><button type="button" onClick={() => void copyAddress(selected.asset)}>{copied === selected.asset ? 'COPIED ✓' : 'COPY ⧉'}</button><a href={explorer(selected.asset)} target="_blank" rel="noreferrer">EXPLORER ↗</a></div>
          <div className="market-side" role="group" aria-label="Trade direction"><button type="button" aria-pressed={side === 'buy'} disabled={frozen} onClick={() => switchSide('buy')}>BUY {selected.symbol}</button><button type="button" aria-pressed={side === 'sell'} disabled={frozen} onClick={() => switchSide('sell')}>SELL {selected.symbol}</button></div>
          <form className="market-trade-form" onSubmit={event => void quoteTrade(event)}>
            <label htmlFor={amountId}>YOU PAY <span>{inputSymbol}</span></label><div className="market-amount"><input id={amountId} value={amount} onChange={event => { invalidateQuote(); setAmount(event.target.value); }} inputMode="decimal" maxLength={100} placeholder="0.00" autoComplete="off" spellCheck={false} disabled={frozen} aria-describedby={`${amountId}-balance`}/><b>{inputSymbol}</b></div>
            <div className="market-balance" id={`${amountId}-balance`}><span title={inputBalance === null ? undefined : formatUnits(inputBalance, inputDecimals)}>{account ? inputBalance !== null ? `Balance: ${amountText(inputBalance, inputDecimals)} ${inputSymbol}` : balanceLoading ? 'Loading your wallet balance…' : balanceError ? 'Balance unavailable.' : 'Get a quote to load your balance.' : 'Connect to see your wallet balance.'}</span>{account && inputBalance !== null && <button type="button" disabled={frozen} onClick={() => { const maximum = formatUnits(inputBalance, inputDecimals); invalidateQuote(); setAmount(maximum); }}>MAX</button>}{account && balanceError && <button type="button" disabled={balanceLoading || frozen} onClick={() => setBalanceRefresh(value => value + 1)}>RETRY</button>}</div>
            <div className="market-output"><span>YOU RECEIVE <small>ESTIMATE</small></span><strong>{quote ? amountText(quote.amountOut, quote.tokenOut.decimals) : '—'} <small>{outputSymbol}</small></strong></div>
            {account && outputBalance !== null && <p className="market-output-balance" title={formatUnits(outputBalance, outputDecimals)}>You hold {amountText(outputBalance, outputDecimals)} {outputSymbol}</p>}
            <div className="market-slippage"><label htmlFor={slippageId}>SLIPPAGE LIMIT</label><span><input id={slippageId} value={slippage} onChange={event => { invalidateQuote(); setSlippage(event.target.value); }} inputMode="decimal" maxLength={5} autoComplete="off" disabled={frozen} aria-label="Slippage limit percentage"/>%</span></div>
            <div className="market-slippage-presets">{['0.5', '1', '2'].map(value => <button type="button" key={value} aria-pressed={slippage === value} disabled={frozen} onClick={() => { invalidateQuote(); setSlippage(value); }}>{value}%</button>)}</div>
            {quote && <dl className="market-quote-review"><div><dt>EXACT INPUT</dt><dd>{formatUnits(quote.amountIn, quote.tokenIn.decimals)} {quote.tokenIn.symbol}</dd></div><div><dt>MINIMUM RECEIVED</dt><dd>{formatUnits(quote.minimumAmountOut, quote.tokenOut.decimals)} {quote.tokenOut.symbol}</dd></div><div><dt>POOL TRADING FEE</dt><dd>{selected.fee / 10_000}%</dd></div><div><dt>QUOTE</dt><dd>{expired ? 'EXPIRED · REFRESH' : `${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))}s REMAINING`}</dd></div></dl>}
            {quoteOwned && !enough && <p className="market-error" role="alert">Your connected wallet has insufficient {inputSymbol} for this amount.</p>}
            <button className={quote && !expired ? 'market-secondary market-quote-button' : 'market-primary'} type="submit" disabled={frozen || !amount.trim()}>{busy === 'quote' ? 'GETTING QUOTE…' : quote ? 'REFRESH QUOTE ↻' : 'GET QUOTE ↗'}</button>
          </form>
          {quote && !expired && <div className="market-trade-actions">{!account ? <button className="market-primary" type="button" disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'} onClick={() => void connect()}>{wallet.status === 'wrong-network' ? 'SWITCH NETWORK TO TRADE' : 'CONNECT WALLET TO TRADE'}</button> : <>
            <ol className="market-steps" aria-label="Trade steps"><li className={quote.approval ? 'is-current' : 'is-complete'}><span>01</span><div><b>AUTHORIZE {inputSymbol}</b><small>{quote.approval === 'token' ? 'Approve this amount. Trading authorization may follow.' : quote.approval === 'router' ? 'Enable this amount for the trading router.' : 'Allowance ready for this trade.'}</small></div></li><li className={!quote.approval ? 'is-current' : ''}><span>02</span><div><b>CONFIRM {side.toUpperCase()}</b><small>Your wallet confirms the swap separately.</small></div></li></ol>
            {quote.approval ? <button className="market-primary" type="button" disabled={frozen || !quoteOwned || !enough} onClick={() => void send('approval')}>{busy === 'approval' ? 'CONFIRMING APPROVAL…' : quote.approval === 'token' ? `APPROVE ${inputSymbol}` : `ENABLE ${inputSymbol} TRADING`} <span>↗</span></button> : <button className="market-primary" type="button" disabled={frozen || !quoteOwned || !enough} onClick={() => void send('swap')}>{busy === 'swap' ? 'CONFIRMING SWAP…' : `${side.toUpperCase()} ${selected.symbol}`} <span>↗</span></button>}
          </>}</div>}
          <p className="market-trade-note">{selected.quote.kind === 'weth' ? 'This pool trades WETH. ' : ''}Keep ETH in your connected wallet for network fees.</p>
          <a className="market-external-route" href={`https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${side === 'buy' ? selected.quote.address : selected.asset}&outputCurrency=${side === 'buy' ? selected.asset : selected.quote.address}`} target="_blank" rel="noreferrer">OPEN THIS PAIR ON UNISWAP ↗ <small>External app · route availability may vary</small></a>
          {status && <p className="market-status" role="status">{status}</p>}{error && <p className="market-error" role="alert">{error}</p>}
          {lastHash && <a className="market-transaction" href={`${PET_DEPLOYMENT.explorer}/tx/${lastHash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>}
        </section>}
      </div>
      {!selected && error && <p className="market-error" role="alert">{error}</p>}
      <div className="market-footer"><span>RAREPET LAUNCHES · REAL ONCHAIN POOLS</span><a href="/launch/">LAUNCH YOUR TOKEN ↗</a></div>
    </div>
  </dialog>;
}

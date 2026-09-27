import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { PET_DEPLOYMENT, type PetWalletSession } from './wallet';
import { readRareMarketPage, type RareMarketCursor, type RareMarketToken } from './market-catalog';
import { buildMarketAssets, filterMarketAssets, marketAssetQuote, type MarketAsset } from './market-assets';
import { readMarketBalances, readMarketSwapQuote, sendMarketApproval, sendMarketSwap, getMarketTransaction, subscribeMarketTransactions, refreshMarketTransaction, marketActorWallet, marketActorOwner, type MarketActor, type MarketSwapQuote } from './market-swap';
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
function TokenImage({ token }: { token: Pick<MarketAsset, 'imageUrl' | 'symbol'> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [token.imageUrl]);
  return <span className="market-token-image">{token.imageUrl && !failed
    ? <img src={token.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <span aria-hidden="true">{token.symbol.slice(0, 2).toUpperCase()}</span>}</span>;
}

export function MarketDialog({ session, actor, close }: { session: PetWalletSession; actor?: MarketActor; close: () => void }) {
  const wallet = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const account = wallet.status === 'connected' && wallet.account ? wallet.account as Address : null;
  const sourceAccount = actor ? marketActorWallet(actor) : account;
  const friendMode = actor?.kind === 'friend';
  const actorReady = !!account && (!actor || marketActorOwner(actor).toLowerCase() === account.toLowerCase());
  const transaction = useSyncExternalStore(subscribeMarketTransactions, () => getMarketTransaction(sourceAccount));
  const unresolved = transaction && ['awaiting-wallet', 'pending', 'unverified'].includes(transaction.status) ? transaction : null;
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), writeLock = useRef(false), work = useRef(0);
  const catalogueAbort = useRef<AbortController | null>(null), catalogueWork = useRef(0), catalogueLock = useRef(false);
  const titleId = useId(), queryId = useId(), categoryId = useId(), pickerId = useId(), amountId = useId(), slippageId = useId();
  const [tokens, setTokens] = useState<readonly RareMarketToken[]>([]), [cursor, setCursor] = useState<RareMarketCursor | null>(null);
  const [complete, setComplete] = useState(false), [loading, setLoading] = useState(false), [catalogueError, setCatalogueError] = useState('');
  const [scanned, setScanned] = useState<{ from: bigint; to: bigint } | null>(null);
  const [query, setQuery] = useState(''), [category, setCategory] = useState<'all' | 'crypto' | 'stocks' | 'launch'>('all');
  const [pickerOpen, setPickerOpen] = useState(false), [activeOption, setActiveOption] = useState(-1);
  const [selectedAsset, setSelectedAsset] = useState<MarketAsset | null>(null), [side, setSide] = useState<Side>('buy');
  const selected = selectedAsset;
  const pairedAsset = selected ? marketAssetQuote(selected) : null;
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
  }, [wallet.revision, wallet.status, wallet.account, sourceAccount]);
  useEffect(() => {
    setBalances(null); setBalanceError(''); setBalanceLoading(false);
    if (!selected || !sourceAccount) return;
    let active = true; setBalanceLoading(true);
    void readMarketBalances(selected, sourceAccount, undefined, actor).then(value => { if (active) setBalances(value); })
      .catch(cause => { if (active) setBalanceError(problem(cause)); }).finally(() => { if (active) setBalanceLoading(false); });
    return () => { active = false; };
  }, [selected, sourceAccount, actor, wallet.revision, balanceRefresh]);

  const assets = useMemo(() => buildMarketAssets(tokens), [tokens]);
  const visible = useMemo(() => filterMarketAssets(assets, { query, category }), [assets, category, query]);
  const options = useMemo(() => filterMarketAssets(assets, { query }), [assets, query]);
  const frozen = !!busy || !!unresolved;
  const inputSymbol = selected ? side === 'buy' ? pairedAsset!.symbol : selected.symbol : '';
  const outputSymbol = selected ? side === 'buy' ? selected.symbol : pairedAsset!.symbol : '';
  const inputDecimals = selected ? side === 'buy' ? pairedAsset!.decimals : selected.decimals : 18;
  const inputBalance = quote && quote.account?.toLowerCase() === sourceAccount?.toLowerCase() && quote.balance !== null ? quote.balance : balances ? side === 'buy' ? balances.quote : balances.asset : null;
  const outputBalance = balances ? side === 'buy' ? balances.asset : balances.quote : null;
  const outputDecimals = selected ? side === 'buy' ? selected.decimals : pairedAsset!.decimals : 18;
  const expired = !!quote && quote.expiresAt <= now;
  const enough = !!quote && quote.balance !== null && quote.balance >= quote.amountIn;
  const quoteOwned = !!quote && actorReady && !!sourceAccount && quote.account?.toLowerCase() === sourceAccount.toLowerCase();

  function invalidateQuote() { work.current++; setQuote(null); setError(''); setStatus(''); setLastHash(null); }
  function selectToken(token: MarketAsset) {
    if (frozen) return;
    invalidateQuote(); setSelectedAsset(token); setAmount(''); setSide('buy'); setQuery(''); setPickerOpen(false); setActiveOption(-1);
    window.requestAnimationFrame(() => tradePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
  function closeToken() { invalidateQuote(); setSelectedAsset(null); }
  const categoryLabel = (asset: MarketAsset) => asset.source === 'launch' ? 'RAREPET' : asset.category === 'stocks' ? 'STOCK / ETF' : 'CRYPTO';
  function focusOption(index: number) {
    setActiveOption(index);
    window.requestAnimationFrame(() => document.getElementById(`${pickerId}-${index}`)?.scrollIntoView({ block: 'nearest' }));
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
    setBusy('quote'); setError(''); setStatus('Finding and checking a route for your exact input…'); setQuote(null);
    try {
      const next = await readMarketSwapQuote({ market: selected, side, amount, slippageBps: slippageBps(), ...(sourceAccount ? { account: sourceAccount } : {}), ...(actor ? { actor } : {}) });
      if (!alive.current || task !== work.current) return;
      setNow(Date.now()); setQuote(next); setStatus('Quote ready. Review what you pay and the minimum you receive.');
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
      const options = { session, account: owner, revision, quote: reviewed, onHash, assertActive, ...(actor ? { actor } : {}) };
      const result = kind === 'approval' ? await sendMarketApproval(options) : await sendMarketSwap(options);
      if (!alive.current || task !== work.current) return;
      setLastHash(result.transactionHash); setQuote(null); setBalanceRefresh(value => value + 1);
      setStatus(kind === 'approval' ? 'Approval confirmed. Get a fresh quote to review the next step.' : `${side === 'buy' ? 'Buy' : 'Sell'} confirmed. Your tokens are in ${friendMode ? 'this Friend’s Rare Wallet' : 'your connected wallet'}.`);
    } catch (cause) {
      const text = problem(cause);
      if (alive.current) { setError(text); setStatus(''); }
    } finally { writeLock.current = false; if (alive.current) setBusy(''); }
  }
  async function recheckTransaction() {
    if (!sourceAccount || busy || writeLock.current) return;
    const owner = sourceAccount; setBusy('recheck'); setError('');
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
      <div className="market-intro"><div><span className="market-eyebrow">THE RAREPET MARKET</span><h3>Meet your next rare find.</h3><p>Explore crypto, stocks, ETFs and tokens launched through RarePet.</p></div><span className="market-network">ROBINHOOD</span></div>
      <div className="market-wallet"><div><b>{friendMode ? "RARE FRIEND TRADING WALLET" : "YOUR TRADING WALLET"}</b><span>{friendMode ? "Trades use this Friend’s assets. You sign and pay gas." : "Buy and sell here with your connected wallet."}</span></div>{sourceAccount ? <button className="market-address" type="button" onClick={() => void copyAddress(sourceAccount)} aria-label="Copy your trading wallet address">{shortAddress(sourceAccount)} {copied === sourceAccount ? '✓' : '⧉'}</button> : <button className="market-connect" type="button" onClick={() => void connect()} disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'}>{wallet.status === 'wrong-network' ? 'SWITCH TO ROBINHOOD' : wallet.status === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET ↗'}</button>}</div>
      {friendMode && !actorReady && <p className="market-error" role="alert">Connect the current owner of this Rare Friend to trade from its wallet.</p>}
      {wallet.error && <p className="market-error" role="alert">{wallet.error}</p>}
      {unresolved && <div className="market-pending" role="status"><b>{unresolved.kind === 'swap' ? 'SWAP' : 'APPROVAL'} {unresolved.status === 'awaiting-wallet' ? 'AWAITING YOUR WALLET' : 'AWAITING VERIFICATION'}</b><p>{unresolved.error || (unresolved.status === 'awaiting-wallet' ? 'Review the request in your connected wallet.' : 'Your transaction was submitted. Its result must be verified before another trade.')}</p>{unresolved.hash && <a href={`${PET_DEPLOYMENT.explorer}/tx/${unresolved.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>}{unresolved.status !== 'awaiting-wallet' && <button type="button" disabled={!!busy} onClick={() => void recheckTransaction()}>{busy === 'recheck' ? 'CHECKING…' : 'CHECK TRANSACTION STATUS'}</button>}</div>}
      {!unresolved && transaction?.status === 'confirmed' && !selected && <p className="market-status" role="status">Your last {transaction.kind === 'swap' ? 'swap' : 'approval'} is confirmed.{transaction.hash && <> <a href={`${PET_DEPLOYMENT.explorer}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a></>}</p>}
      <div className={`market-layout${selectedAsset ? ' has-selection' : ''}`}>
        <section className="market-browser" aria-label="All supported tokens">
          <div className="market-filters">
            <div className="market-token-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setPickerOpen(false); setActiveOption(-1); } }}>
              <label htmlFor={queryId}>FIND A TOKEN</label>
              <div className="market-picker-input"><input id={queryId} role="combobox" aria-autocomplete="list" aria-controls={pickerId} aria-expanded={pickerOpen} aria-activedescendant={pickerOpen && activeOption >= 0 && options[activeOption] ? `${pickerId}-${activeOption}` : undefined} value={query}
                onFocus={() => setPickerOpen(true)} onChange={event => { setQuery(event.target.value); setPickerOpen(true); setActiveOption(-1); }}
                onKeyDown={event => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPickerOpen(true); if (options.length) focusOption(event.key === 'ArrowDown' ? Math.min(activeOption + 1, options.length - 1) : activeOption < 0 ? options.length - 1 : Math.max(activeOption - 1, 0)); }
                  else if (event.key === 'Enter' && pickerOpen) { event.preventDefault(); const choice = options[activeOption >= 0 ? activeOption : 0]; if (choice) selectToken(choice); }
                  else if (event.key === 'Escape' && pickerOpen) { event.preventDefault(); event.stopPropagation(); setPickerOpen(false); setActiveOption(-1); }
                }} placeholder="All tokens · search name, ticker or address" autoComplete="off" disabled={frozen}/>
                <button type="button" aria-label={pickerOpen ? 'Hide token dropdown' : 'Show all tokens'} aria-expanded={pickerOpen} aria-controls={pickerId} disabled={frozen} onClick={() => { setPickerOpen(value => !value); setActiveOption(-1); }}><span aria-hidden="true">⌄</span></button>
              </div>
              {pickerOpen && <div className="market-picker-menu" id={pickerId} role="listbox" aria-label="Find a token">{options.length ? options.map((asset, index) => <button type="button" role="option" tabIndex={-1} id={`${pickerId}-${index}`} key={asset.address} aria-selected={selectedAsset?.address.toLowerCase() === asset.address.toLowerCase()} className={`market-picker-option${activeOption === index ? ' is-active' : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => selectToken(asset)}><TokenImage token={asset}/><span className="market-card-title"><b>{asset.symbol}</b><span>{asset.name}</span></span><span className="market-card-category">{categoryLabel(asset)}</span></button>) : <p className="market-picker-empty">No matching tokens.</p>}</div>}
            </div>
            <label htmlFor={categoryId}>SHOW<select id={categoryId} className="market-category" value={category} disabled={frozen} onChange={event => setCategory(event.target.value as typeof category)}><option value="all">All tokens</option><option value="crypto">Crypto</option><option value="stocks">Stocks &amp; ETFs</option><option value="launch">RarePet launches</option></select></label>
          </div>
          <div className="market-results"><span>{visible.length} TOKEN{visible.length === 1 ? '' : 'S'}</span><button type="button" disabled={loading || frozen} onClick={() => void loadCatalogue(true)}>REFRESH ↻</button></div>
          {catalogueError && <div className="market-error" role="alert"><p>RarePet launch history is unavailable: {catalogueError}</p><button type="button" disabled={loading} onClick={() => void loadCatalogue(!cursor)}>RETRY LAUNCH HISTORY</button></div>}
          {!visible.length && <div className="market-empty"><span className="market-empty-mark" aria-hidden="true">✦</span><h4>{category === 'launch' && !query && !tokens.length ? loading ? 'Finding RarePet launches…' : complete ? 'A new market starts here.' : 'Launch history is incomplete.' : 'No matching tokens.'}</h4><p>{category === 'launch' && !query && !tokens.length ? complete ? 'RarePet tokens will appear here after their launches confirm.' : 'Load the launch history to see confirmed tokens.' : 'Try another name, ticker, contract address or category.'}</p><button type="button" onClick={() => { setQuery(''); setCategory('all'); }}>SHOW ALL TOKENS</button></div>}
          {!!visible.length && <div className="market-token-grid" role="region" aria-label="Tokens" tabIndex={0}>{visible.map(asset => <article className={`market-token-card${selectedAsset?.address.toLowerCase() === asset.address.toLowerCase() ? ' is-selected' : ''}`} key={asset.address}>
            <button className="market-select-token" type="button" disabled={frozen} aria-pressed={selectedAsset?.address.toLowerCase() === asset.address.toLowerCase()} aria-label={`Select ${asset.name}, ${asset.symbol}`} title={`${asset.name} · ${asset.address}`} onClick={() => selectToken(asset)}><TokenImage token={asset}/><span className="market-card-title"><b>{asset.symbol}</b><span>{asset.name}</span></span><span className="market-card-category">{categoryLabel(asset)}</span><span className="market-card-arrow" aria-hidden="true">↗</span></button>
          </article>)}</div>}
          <p className="market-catalog-note">Trade here using available Uniswap liquidity. A listed token needs an available route before you can swap.</p>
          {!complete && !loading && <button className="market-load-more" type="button" disabled={frozen} onClick={() => void loadCatalogue(false)}>LOAD EARLIER LAUNCHES <span>↓</span></button>}
          {loading && <p className="market-loading" role="status">Checking RarePet launch history…</p>}
          {scanned && <p className="market-scan-note">{complete ? 'RarePet launch history loaded' : 'Catalog includes loaded launches; load earlier history for more.'}<span>Blocks {scanned.from.toLocaleString()}–{scanned.to.toLocaleString()}</span></p>}
        </section>
        {selected && <section ref={tradePanel} className="market-trade" aria-label={`Trade ${selected.symbol}`}>
          <div className="market-trade-heading"><TokenImage token={selected}/><div><h4>{selected.name}</h4><span>${selected.symbol} / {pairedAsset!.symbol}</span></div><button type="button" aria-label="Close token trade" disabled={frozen} onClick={closeToken}>×</button></div>
          <div className="market-token-address"><span>TOKEN CONTRACT</span><code>{selected.address}</code><button type="button" onClick={() => void copyAddress(selected.address)}>{copied === selected.address ? 'COPIED ✓' : 'COPY ⧉'}</button><a href={explorer(selected.address)} target="_blank" rel="noreferrer">EXPLORER ↗</a></div>
          <div className="market-side" role="group" aria-label="Trade direction"><button type="button" aria-pressed={side === 'buy'} disabled={frozen} onClick={() => switchSide('buy')}>BUY {selected.symbol}</button><button type="button" aria-pressed={side === 'sell'} disabled={frozen} onClick={() => switchSide('sell')}>SELL {selected.symbol}</button></div>
          <form className="market-trade-form" onSubmit={event => void quoteTrade(event)}>
            <label htmlFor={amountId}>YOU PAY <span>{inputSymbol}</span></label><div className="market-amount"><input id={amountId} value={amount} onChange={event => { invalidateQuote(); setAmount(event.target.value); }} inputMode="decimal" maxLength={100} placeholder="0.00" autoComplete="off" spellCheck={false} disabled={frozen} aria-describedby={`${amountId}-balance`}/><b>{inputSymbol}</b></div>
            <div className="market-balance" id={`${amountId}-balance`}><span title={inputBalance === null ? undefined : formatUnits(inputBalance, inputDecimals)}>{account ? inputBalance !== null ? `Balance: ${amountText(inputBalance, inputDecimals)} ${inputSymbol}` : balanceLoading ? 'Loading your wallet balance…' : balanceError ? 'Balance unavailable.' : 'Get a quote to load your balance.' : 'Connect to see your wallet balance.'}</span>{account && inputBalance !== null && <button type="button" disabled={frozen} onClick={() => { const maximum = formatUnits(inputBalance, inputDecimals); invalidateQuote(); setAmount(maximum); }}>MAX</button>}{account && balanceError && <button type="button" disabled={balanceLoading || frozen} onClick={() => setBalanceRefresh(value => value + 1)}>RETRY</button>}</div>
            <div className="market-output"><span>YOU RECEIVE <small>ESTIMATE</small></span><strong>{quote ? amountText(quote.amountOut, quote.tokenOut.decimals) : '—'} <small>{outputSymbol}</small></strong></div>
            {account && outputBalance !== null && <p className="market-output-balance" title={formatUnits(outputBalance, outputDecimals)}>You hold {amountText(outputBalance, outputDecimals)} {outputSymbol}</p>}
            <div className="market-slippage"><label htmlFor={slippageId}>SLIPPAGE LIMIT</label><span><input id={slippageId} value={slippage} onChange={event => { invalidateQuote(); setSlippage(event.target.value); }} inputMode="decimal" maxLength={5} autoComplete="off" disabled={frozen} aria-label="Slippage limit percentage"/>%</span></div>
            <div className="market-slippage-presets">{['0.5', '1', '2'].map(value => <button type="button" key={value} aria-pressed={slippage === value} disabled={frozen} onClick={() => { invalidateQuote(); setSlippage(value); }}>{value}%</button>)}</div>
            {quote && <dl className="market-quote-review"><div><dt>EXACT INPUT</dt><dd>{formatUnits(quote.amountIn, quote.tokenIn.decimals)} {quote.tokenIn.symbol}</dd></div><div><dt>MINIMUM RECEIVED</dt><dd>{formatUnits(quote.minimumAmountOut, quote.tokenOut.decimals)} {quote.tokenOut.symbol}</dd></div><div><dt>{quote.route ? 'ROUTE' : 'POOL TRADING FEE'}</dt><dd>{quote.route ? `Uniswap V${quote.route.version} · ${quote.route.legs.length} pool${quote.route.legs.length === 1 ? '' : 's'}` : selected.source === 'launch' ? `${selected.launch.fee / 10_000}%` : '—'}</dd></div>{quote.route && <div><dt>POOL FEES</dt><dd>{quote.route.legs.map(leg => leg.fee === 8388608 ? 'Dynamic' : `${leg.fee / 10_000}%`).join(' → ')}</dd></div>}{sourceAccount && <div><dt>RECEIVING WALLET</dt><dd title={sourceAccount}>{friendMode ? 'RF · ' : ''}{shortAddress(sourceAccount)}</dd></div>}<div><dt>QUOTE</dt><dd>{expired ? 'EXPIRED · REFRESH' : `${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))}s REMAINING`}</dd></div></dl>}
            {quoteOwned && !enough && <p className="market-error" role="alert">{friendMode ? "This Friend’s Rare Wallet" : "Your connected wallet"} has insufficient {inputSymbol} for this amount.</p>}
            <button className={quote && !expired ? 'market-secondary market-quote-button' : 'market-primary'} type="submit" disabled={frozen || !amount.trim()}>{busy === 'quote' ? 'GETTING QUOTE…' : quote ? 'REFRESH QUOTE ↻' : 'GET QUOTE ↗'}</button>
          </form>
          {quote && !expired && <div className="market-trade-actions">{!account ? <button className="market-primary" type="button" disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'} onClick={() => void connect()}>{wallet.status === 'wrong-network' ? 'SWITCH NETWORK TO TRADE' : 'CONNECT WALLET TO TRADE'}</button> : <>
            <ol className="market-steps" aria-label="Trade steps"><li className={quote.approval ? 'is-current' : 'is-complete'}><span>01</span><div><b>AUTHORIZE {inputSymbol}</b><small>{quote.approval === 'token' ? 'Approve this amount. Trading authorization may follow.' : quote.approval === 'router' ? 'Enable this amount for the trading router.' : 'Allowance ready for this trade.'}</small></div></li><li className={!quote.approval ? 'is-current' : ''}><span>02</span><div><b>CONFIRM {side.toUpperCase()}</b><small>{friendMode ? "You sign; this Friend’s wallet makes the swap." : "Your wallet confirms the swap separately."}</small></div></li></ol>
            {quote.approval ? <button className="market-primary" type="button" disabled={frozen || !quoteOwned || !enough} onClick={() => void send('approval')}>{busy === 'approval' ? 'CONFIRMING APPROVAL…' : quote.approval === 'token' ? `APPROVE ${inputSymbol}` : `ENABLE ${inputSymbol} TRADING`} <span>↗</span></button> : <button className="market-primary" type="button" disabled={frozen || !quoteOwned || !enough} onClick={() => void send('swap')}>{busy === 'swap' ? 'CONFIRMING SWAP…' : `${side.toUpperCase()} ${selected.symbol}`} <span>↗</span></button>}
          </>}</div>}
          <p className="market-trade-note">{pairedAsset!.kind === 'weth' ? 'Pay with WETH when buying; receive WETH when selling. ' : ''}{friendMode ? 'Tokens stay in this Friend’s Rare Wallet. Keep ETH in your owner wallet for gas.' : 'Keep ETH in your connected wallet for gas.'}</p>
          {status && <p className="market-status" role="status">{status}</p>}{error && <p className="market-error" role="alert">{error}</p>}
          {lastHash && <a className="market-transaction" href={`${PET_DEPLOYMENT.explorer}/tx/${lastHash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>}
        </section>}
      </div>
      {!selected && error && <p className="market-error" role="alert">{error}</p>}
      <div className="market-footer"><span>ROBINHOOD TOKENS · RAREPET LAUNCHES</span><a href="/launch/">LAUNCH YOUR TOKEN ↗</a></div>
    </div>
  </dialog>;
}

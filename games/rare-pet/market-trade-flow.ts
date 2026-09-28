import type { MarketActor, MarketSwapQuote } from './market-swap.ts';

export type MarketTradeStage = 'token-approval' | 'router-approval' | 'refresh' | 'swap';
export type MarketTradeFlowOptions<T> = {
  quote: MarketSwapQuote;
  assertActive: () => void;
  refreshQuote: (reviewed: MarketSwapQuote) => Promise<MarketSwapQuote>;
  /** Resolves only after the exact approval has been confirmed and verified. */
  approve: (reviewed: MarketSwapQuote) => Promise<unknown>;
  /** Resolves only after the swap receipt has been verified. */
  swap: (reviewed: MarketSwapQuote) => Promise<T>;
  onStage?: (stage: MarketTradeStage, reviewed: MarketSwapQuote) => void;
  now?: () => number;
};

const lower = (value: string) => value.toLowerCase();
function actorIdentity(actor: MarketActor | null) {
  if (!actor) return null;
  if (actor.kind === 'owner') return ['owner', lower(actor.account)];
  const pet = actor.pet;
  return ['friend', lower(pet.owner), lower(pet.walletAddress!), pet.chainId, pet.collection, lower(pet.contract), pet.tokenId];
}
function intentIdentity(quote: MarketSwapQuote) {
  const market = quote.market;
  const launch = 'source' in market ? market.source === 'launch' ? market.launch : null : market;
  const route = quote.route;
  const poolKey = (pool: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }) =>
    [lower(pool.currency0), lower(pool.currency1), pool.fee, pool.tickSpacing, lower(pool.hooks)];
  return JSON.stringify([
    quote.account && lower(quote.account), actorIdentity(quote.actor), quote.side,
    [lower(quote.tokenIn.address), quote.tokenIn.symbol, quote.tokenIn.decimals],
    [lower(quote.tokenOut.address), quote.tokenOut.symbol, quote.tokenOut.decimals],
    quote.amountIn.toString(), quote.slippageBps,
    launch ? ['launch', lower(launch.asset), lower(launch.router), lower(launch.quote.address), lower(launch.poolId), poolKey(launch.poolKey)]
      : ['ecosystem', lower('address' in market ? market.address : market.asset)],
    route && [route.version, lower(route.tokenIn), lower(route.tokenOut), route.legs.map(leg =>
      [leg.version, lower(leg.tokenIn), lower(leg.tokenOut), leg.fee,
        leg.version === 3 ? lower(leg.poolAddress) : [lower(leg.poolId), poolKey(leg.poolKey)]])],
  ]);
}

/** Continue one reviewed trade through its remaining exact approvals. Wallet
 * errors stop the sequence; only a new explicit user action may resume it. */
export async function runMarketTrade<T>(options: MarketTradeFlowOptions<T>): Promise<T> {
  const { assertActive } = options, now = options.now ?? Date.now;
  assertActive();
  let quote = options.quote;
  if (!quote.account || !quote.actor || quote.minimumAmountOut <= 0n) throw new Error('Review a quote for your selected trading wallet before continuing.');
  const intent = intentIdentity(quote), approved = new Set<'token' | 'router'>();
  let minimum = quote.minimumAmountOut;
  function assertIntent(next: MarketSwapQuote) {
    if (intentIdentity(next) !== intent || next.minimumAmountOut < minimum || next.amountOut < next.minimumAmountOut)
      throw new Error('The trade changed or its price moved beyond your reviewed minimum. Review a new quote before continuing.');
    minimum = next.minimumAmountOut;
  }
  function stage(value: MarketTradeStage) {
    assertActive(); options.onStage?.(value, quote); assertActive();
  }
  async function refresh() {
    stage('refresh');
    const next = await options.refreshQuote(quote);
    assertActive(); assertIntent(next);
    if (!Number.isFinite(next.expiresAt) || next.expiresAt <= now()) throw new Error('Your refreshed quote expired. Review a new quote before continuing.');
    quote = next;
  }
  assertIntent(quote);
  if (!Number.isFinite(quote.expiresAt) || quote.expiresAt <= now()) await refresh();
  while (quote.approval) {
    const approval = quote.approval;
    if (!['token', 'router'].includes(approval) || approved.has(approval) || approval === 'token' && approved.has('router'))
      throw new Error('The approval did not advance this trade. Review your allowance before trying again.');
    stage(approval === 'token' ? 'token-approval' : 'router-approval');
    assertIntent(quote);
    if (quote.expiresAt <= now()) throw new Error('Your quote expired. Review a new quote before continuing.');
    await options.approve(quote);
    assertActive(); approved.add(approval);
    await refresh();
  }
  stage('swap'); assertIntent(quote);
  if (quote.expiresAt <= now()) throw new Error('Your quote expired. Review a new quote before continuing.');
  const result = await options.swap(quote);
  assertActive();
  return result;
}

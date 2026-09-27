import { computePoolId, getAddresses, quoterV2Abi, v4QuoterAbi } from '@whetstone-research/doppler-sdk/evm';
import { encodeAbiParameters, encodeFunctionData, encodePacked, isAddress, keccak256, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { LAUNCH_QUOTE_ASSETS } from './launch-quotes.ts';
import { RARE_FRIENDS_POOL } from './launch-rarefriends-price.ts';
import type { RareMarketPoolKey } from './market-catalog.ts';

export type MarketRouteLeg = Readonly<{ tokenIn: Address; tokenOut: Address; fee: number }> & (
  | Readonly<{ version: 3; poolAddress: Address }>
  | Readonly<{ version: 4; poolKey: RareMarketPoolKey; poolId: Hex }>
);
export type MarketRoute = Readonly<{ version: 3 | 4; tokenIn: Address; tokenOut: Address; legs: readonly MarketRouteLeg[] }>;
export type MarketRoutingClient = Pick<PublicClient, 'getChainId' | 'getBlock' | 'getCode' | 'readContract' | 'simulateContract'>;
export type MarketRoutingDependencies = Readonly<{ client: MarketRoutingClient; fetcher?: typeof fetch; timeoutMs?: number;
  /** Test seam. The production path always checks exact deployments. */
  verifyInfrastructure?: (client: MarketRoutingClient, route: MarketRoute, blockNumber: bigint) => Promise<void> }>;
export const MARKET_ROUTING_DEPLOYMENT = Object.freeze({
  router: '0x8876789976decbfcbbbe364623c63652db8c0904' as Address,
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as Address,
  v3Quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7' as Address,
  v4Manager: RARE_FRIENDS_POOL.manager as Address,
  v4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' as Address,
  stateView: RARE_FRIENDS_POOL.stateView as Address,
});
const HASHES = Object.freeze({
  router: '0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde',
  permit2: '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca',
  v3Factory: '0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739',
  v3Quoter: '0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28',
  v4Manager: RARE_FRIENDS_POOL.managerCodeHash,
  v4Quoter: '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6',
  stateView: RARE_FRIENDS_POOL.stateViewCodeHash,
});
const READ_ABI = parseAbi(['function getPool(address,address,uint24) view returns(address)', 'function factory() view returns(address)',
  'function poolManager() view returns(address)', 'function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)',
  'function getLiquidity(bytes32) view returns(uint128)', 'function decimals() view returns(uint8)']);
const ROUTER_ABI = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const canonical = new Map(LAUNCH_QUOTE_ASSETS.map(asset => [asset.address.toLowerCase(), asset]));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const address = (v: unknown): v is Address => typeof v === 'string' && isAddress(v, { strict: false }) && !same(v, zeroAddress);
const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v);
const numeric = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'string' && /^(?:0|[1-9]\d{0,7})$/.test(v) ? Number(v) : NaN;
function currency(v: unknown): Address {
  if (!address(v) || !canonical.has(v.toLowerCase())) throw new Error('Choose tokens from the canonical Robinhood catalog.');
  return canonical.get(v.toLowerCase())!.address;
}
function amount(v: bigint) { if (typeof v !== 'bigint' || v <= 0n || v >= 1n << 128n) throw new Error('The trade amount is outside the supported range.'); }
function freezeRoute(route: MarketRoute): MarketRoute {
  return Object.freeze({ ...route, legs: Object.freeze(route.legs.map(leg => Object.freeze(leg.version === 4 ? { ...leg, poolKey: Object.freeze({ ...leg.poolKey }) } : { ...leg }))) });
}
function validateRoute(route: MarketRoute) {
  currency(route.tokenIn); currency(route.tokenOut);
  if (same(route.tokenIn, route.tokenOut) || ![3, 4].includes(route.version) || !Array.isArray(route.legs) || !route.legs.length || route.legs.length > 3) throw new Error('This route is unsupported.');
  let previous = route.tokenIn;
  const visited = new Set([previous.toLowerCase()]);
  for (const leg of route.legs) {
    currency(leg.tokenIn); currency(leg.tokenOut);
    if (leg.version !== route.version || !same(previous, leg.tokenIn) || visited.has(leg.tokenOut.toLowerCase())
      || !Number.isInteger(leg.fee) || leg.fee < 0 || leg.fee > 0xffffff) throw new Error('The route is mixed, discontinuous or cyclic.');
    if (leg.version === 3) {
      if (!address(leg.poolAddress) || leg.fee >= 1_000_000) throw new Error('Invalid V3 pool.');
    } else {
      const key = leg.poolKey, sorted = [leg.tokenIn, leg.tokenOut].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      if (!key || !same(key.currency0, sorted[0]) || !same(key.currency1, sorted[1]) || key.fee !== leg.fee
        || !Number.isInteger(key.tickSpacing) || key.tickSpacing <= 0 || key.tickSpacing > 32767 || !hash(leg.poolId)
        || !same(computePoolId(key), leg.poolId)) throw new Error('Invalid V4 pool identity.');
      const rareFriends = same(leg.poolId, RARE_FRIENDS_POOL.poolId) && same(key.hooks, RARE_FRIENDS_POOL.hook) && key.fee === 8388608 && key.tickSpacing === 60;
      if (!rareFriends && (!same(key.hooks, zeroAddress) || key.fee >= 1_000_000)) throw new Error('This pool uses an unverified hook or fee policy.');
    }
    visited.add(leg.tokenOut.toLowerCase()); previous = leg.tokenOut;
  }
  if (!same(previous, route.tokenOut)) throw new Error('The route output differs from your selection.');
}

/** Provider responses are discovery hints only. Reject splits, mixed protocols,
 * unknown currencies, arbitrary hooks and path changes; ignore provider calldata/amounts.
 * Server response: { routes: [ classicQuote.route, ... ] }.
 */
export function parseMarketRouteCandidates(response: unknown, expected: { tokenIn: Address; tokenOut: Address }): readonly MarketRoute[] {
  const tokenIn = currency(expected.tokenIn), tokenOut = currency(expected.tokenOut), raw = object(response).routes;
  if (!Array.isArray(raw) || raw.length > 4) throw new Error('The route service returned an invalid response.');
  const routes: MarketRoute[] = [], seen = new Set<string>();
  for (const candidate of raw) {
    try {
      if (!Array.isArray(candidate) || candidate.length !== 1 || !Array.isArray(candidate[0]) || !candidate[0].length || candidate[0].length > 3) continue;
      const legs: MarketRouteLeg[] = candidate[0].map((value: unknown) => {
        const row = object(value), input = object(row.tokenIn), output = object(row.tokenOut);
        const a = currency(input.address), b = currency(output.address), fee = numeric(row.fee);
        if (numeric(input.chainId) !== 4663 || numeric(output.chainId) !== 4663
          || numeric(input.decimals) !== canonical.get(a.toLowerCase())!.decimals || numeric(output.decimals) !== canonical.get(b.toLowerCase())!.decimals) throw new Error('The route currency metadata differs from the catalog.');
        if (row.type === 'v3-pool' && address(row.address)) return { version: 3, tokenIn: a, tokenOut: b, poolAddress: row.address, fee };
        if (row.type !== 'v4-pool' || !hash(row.address) || typeof row.hooks !== 'string' || !isAddress(row.hooks, { strict: false })) throw new Error('Unsupported pool type.');
        const sorted = [a, b].sort((x, y) => BigInt(x) < BigInt(y) ? -1 : 1);
        return { version: 4, tokenIn: a, tokenOut: b, poolId: row.address, fee,
          poolKey: { currency0: sorted[0], currency1: sorted[1], fee, tickSpacing: numeric(row.tickSpacing), hooks: row.hooks as Address } };
      });
      const route = freezeRoute({ version: legs[0].version, tokenIn, tokenOut, legs }); validateRoute(route);
      const key = JSON.stringify(route).toLowerCase();
      if (!seen.has(key)) { seen.add(key); routes.push(route); }
    } catch { /* An unsupported provider path never becomes a wallet request. */ }
  }
  return Object.freeze(routes);
}

export async function verifyMarketRoutingInfrastructure(client: MarketRoutingClient, route: MarketRoute, blockNumber: bigint) {
  const d = MARKET_ROUTING_DEPLOYMENT, sdk = getAddresses(4663);
  if (!same(sdk.universalRouter, d.router) || !same(sdk.permit2, d.permit2) || !same(sdk.uniswapV3Factory!, d.v3Factory)
    || !same(sdk.v3Quoter, d.v3Quoter) || !same(sdk.poolManager, d.v4Manager) || !same(sdk.uniswapV4Quoter!, d.v4Quoter)) throw new Error('The configured swap infrastructure changed.');
  const names = route.version === 3 ? ['router', 'permit2', 'v3Factory', 'v3Quoter'] as const : ['router', 'permit2', 'v4Manager', 'v4Quoter', 'stateView'] as const;
  for (const name of names) {
    const code = await client.getCode({ address: d[name], blockNumber });
    if (!code || keccak256(code) !== HASHES[name]) throw new Error('A routing contract does not match its verified deployment.');
  }
  const binding = route.version === 3
    ? await client.readContract({ address: d.v3Quoter, abi: READ_ABI, functionName: 'factory', blockNumber })
    : await client.readContract({ address: d.v4Quoter, abi: READ_ABI, functionName: 'poolManager', blockNumber });
  if (!same(binding, route.version === 3 ? d.v3Factory : d.v4Manager)) throw new Error('The quoter uses a different pool deployment.');
  if (route.legs.some(leg => leg.version === 4 && same(leg.poolId, RARE_FRIENDS_POOL.poolId))) {
    for (const name of ['market', 'hook'] as const) {
      const code = await client.getCode({ address: RARE_FRIENDS_POOL[name], blockNumber });
      if (!code || keccak256(code) !== RARE_FRIENDS_POOL[`${name}CodeHash`]) throw new Error('The canonical RareFriends market changed.');
    }
  }
}

function v3Path(route: MarketRoute): Hex {
  return `0x${route.tokenIn.slice(2)}${route.legs.map(leg => `${encodePacked(['uint24'], [leg.fee]).slice(2)}${leg.tokenOut.slice(2)}`).join('')}`.toLowerCase() as Hex;
}
/** Reuses the reviewed path, verifies its contracts again, and quotes at one block. */
export async function recheckMarketRoute(route: MarketRoute, amountIn: bigint, blockNumber: bigint,
  client: MarketRoutingClient, verifier = verifyMarketRoutingInfrastructure): Promise<{ route: MarketRoute; amountOut: bigint }> {
  validateRoute(route); amount(amountIn);
  if (await client.getChainId() !== 4663) throw new Error('Routing requires Robinhood mainnet (4663).');
  const before = await client.getBlock({ blockNumber });
  if (!hash(before.hash)) throw new Error('The route block could not be verified.');
  await verifier(client, route, blockNumber);
  const d = MARKET_ROUTING_DEPLOYMENT;
  let amountOut = amountIn;
  if (route.version === 3) {
    for (const leg of route.legs) {
      if (leg.version !== 3) throw new Error('Mixed protocol route.');
      const pool = await client.readContract({ address: d.v3Factory, abi: READ_ABI, functionName: 'getPool', args: [leg.tokenIn, leg.tokenOut, leg.fee], blockNumber });
      if (!same(pool, leg.poolAddress)) throw new Error('The V3 pool is not registered by the canonical factory.');
    }
    const quoted = await client.simulateContract({ address: d.v3Quoter, abi: quoterV2Abi, functionName: 'quoteExactInput', args: [v3Path(route), amountIn], blockNumber });
    amountOut = quoted.result[0];
  } else {
    for (const leg of route.legs) {
      if (leg.version !== 4) throw new Error('Mixed protocol route.');
      const [slot, liquidity] = await Promise.all([
        client.readContract({ address: d.stateView, abi: READ_ABI, functionName: 'getSlot0', args: [leg.poolId], blockNumber }),
        client.readContract({ address: d.stateView, abi: READ_ABI, functionName: 'getLiquidity', args: [leg.poolId], blockNumber }),
      ]);
      if (slot[0] <= 0n || liquidity <= 0n) throw new Error('A V4 route pool is not initialized or has no active liquidity.');
      const quoted = await client.simulateContract({ address: d.v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle',
        args: [{ poolKey: leg.poolKey, zeroForOne: same(leg.tokenIn, leg.poolKey.currency0), exactAmount: amountOut, hookData: '0x' }], blockNumber });
      amountOut = quoted.result[0]; amount(amountOut);
    }
  }
  amount(amountOut);
  if ((await client.getBlock({ blockNumber })).hash !== before.hash || await client.getChainId() !== 4663) throw new Error('The route block changed. Refresh your quote.');
  return { route: freezeRoute(route), amountOut };
}

function rareFriendsRoute(tokenIn: Address, tokenOut: Address): MarketRoute | null {
  if (![tokenIn, tokenOut].every(token => same(token, RARE_FRIENDS_POOL.token) || same(token, RARE_FRIENDS_POOL.weth))) return null;
  const poolKey = { currency0: RARE_FRIENDS_POOL.token, currency1: RARE_FRIENDS_POOL.weth, fee: 8388608, tickSpacing: 60, hooks: RARE_FRIENDS_POOL.hook } as const;
  return freezeRoute({ version: 4, tokenIn, tokenOut, legs: [{ version: 4, tokenIn, tokenOut, fee: poolKey.fee, poolId: RARE_FRIENDS_POOL.poolId, poolKey }] });
}
async function responseJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (!response.ok) throw new Error('The route discovery service is unavailable. Retry shortly.');
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Invalid route response.');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); }; signal?.addEventListener('abort', abort, { once: true });
  try { for (;;) { signal?.throwIfAborted(); const part = await reader.read(); signal?.throwIfAborted(); if (part.done) break; size += part.value.length; if (size > 200_000) throw new Error('Route response exceeds its size limit.'); parts.push(part.value); } }
  finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function readMarketRoute(input: { tokenIn: Address; tokenOut: Address; amountIn: bigint; account: Address; blockNumber: bigint; signal?: AbortSignal },
  deps: MarketRoutingDependencies): Promise<{ route: MarketRoute; amountOut: bigint }> {
  const tokenIn = currency(input.tokenIn), tokenOut = currency(input.tokenOut); amount(input.amountIn);
  if (same(tokenIn, tokenOut) || !address(input.account)) throw new Error('Choose two different tokens and a valid trading wallet.');
  input.signal?.throwIfAborted();
  const fallback = rareFriendsRoute(tokenIn, tokenOut), candidates: MarketRoute[] = [];
  const controller = new AbortController(), abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Route discovery timed out. Retry shortly.')), Math.max(1, Math.min(20_000, deps.timeoutMs ?? 20_000)));
  try {
    const response = await (deps.fetcher ?? fetch)('/api/market-routing', { method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ tokenIn, tokenOut, amount: input.amountIn.toString(), swapper: input.account }) });
    candidates.push(...parseMarketRouteCandidates(await responseJson(response, controller.signal), { tokenIn, tokenOut }));
  } catch (cause) { input.signal?.throwIfAborted(); if (!fallback) throw cause; }
  finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); }
  if (fallback && !candidates.some(route => route.legs.length === 1 && route.legs[0].version === 4 && same(route.legs[0].poolId, RARE_FRIENDS_POOL.poolId))) candidates.push(fallback);
  let best: { route: MarketRoute; amountOut: bigint } | null = null, failure: unknown;
  for (const route of candidates) {
    input.signal?.throwIfAborted();
    try {
      const checked = await recheckMarketRoute(route, input.amountIn, input.blockNumber, deps.client, deps.verifyInfrastructure);
      if (!best || checked.amountOut > best.amountOut) best = checked;
    } catch (cause) { failure = cause; }
  }
  input.signal?.throwIfAborted();
  if (!best) throw new Error(candidates.length && failure instanceof Error ? failure.message : 'No supported liquid route was found for this pair. Try another token or amount.');
  return best;
}

/** Standard Universal Router 2.1.1 encoding. No provider calldata, custom router,
 * split recipient, extra fee or arbitrary command can enter this call.
 */
export function buildMarketRouteCall(input: { route: MarketRoute; amountIn: bigint; minimumAmountOut: bigint; deadline: bigint }) {
  const { route, amountIn, minimumAmountOut, deadline } = input;
  validateRoute(route); amount(amountIn); amount(minimumAmountOut);
  if (typeof deadline !== 'bigint' || deadline <= 0n) throw new Error('A swap deadline is required.');
  let commands: Hex, inputs: readonly Hex[];
  if (route.version === 3) {
    commands = '0x00'; inputs = [encodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'),
      ['0x0000000000000000000000000000000000000001', amountIn, minimumAmountOut, v3Path(route), true, []])];
  } else {
    const path = route.legs.map(leg => {
      if (leg.version !== 4) throw new Error('Mixed protocol route.');
      return { intermediateCurrency: leg.tokenOut, fee: BigInt(leg.fee), tickSpacing: leg.poolKey.tickSpacing, hooks: leg.poolKey.hooks, hookData: '0x' as Hex };
    });
    const swap = encodeAbiParameters(parseAbiParameters('(address currencyIn,(address intermediateCurrency,uint256 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint256[] minHopPriceX36,uint128 amountIn,uint128 amountOutMinimum)'),
      [{ currencyIn: route.tokenIn, path, minHopPriceX36: [], amountIn, amountOutMinimum: minimumAmountOut }]);
    const settle = encodeAbiParameters(parseAbiParameters('address,uint256'), [route.tokenIn, amountIn]);
    const take = encodeAbiParameters(parseAbiParameters('address,uint256'), [route.tokenOut, minimumAmountOut]);
    commands = '0x10'; inputs = [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x070c0f', [swap, settle, take]])];
  }
  const args = [commands, inputs, deadline] as const;
  return { address: MARKET_ROUTING_DEPLOYMENT.router, abi: ROUTER_ABI, functionName: 'execute' as const, args, value: 0n,
    data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'execute', args }) };
}

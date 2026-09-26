import { encodeAbiParameters, keccak256, parseAbi, parseAbiItem, type Hex, type PublicClient } from 'viem';

/** Canonical Rare Friends market (official contracts docs + Sourcify matched source),
 * independently checked at Robinhood block 73285693. Its permanent position spans
 * ticks -887220..887220, salt 0. No third-party market price or spot fallback is used.
 * https://rarefriends.com/docs/contracts
 * https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663
 */
export const RARE_FRIENDS_POOL = Object.freeze({
  token: '0x0779369854d3EcdEA927206718FFD7730C67B71f',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  market: '0x99930E551b6f849bAabC4B491053eF28a700C4F2',
  hook: '0x7A65d0194e6Cc43971C31CE7D1471Da01D42A0cC',
  manager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  poolId: '0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240',
  marketCodeHash: '0x92596cc4fe9c9c28e241160ef46ef4f638f82432e17946f7710813699214e808',
  hookCodeHash: '0x019f1278b7bd5fd4475f59598760d83a04dbc06e23ee84e31941ba4782bd115b',
  managerCodeHash: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626',
  stateViewCodeHash: '0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6',
  windowSeconds: 1800, maxSwapAgeSeconds: 3600, minimumWethDepthWei: 10n * 10n ** 18n,
} as const);
export type RareFriendsPoolPrice = Readonly<{
  poolId: Hex; windowStart: number; windowEnd: number; windowSeconds: 1800;
  lastSwapAt: number; wethPerTokenE18: bigint; spotWethPerTokenE18: bigint; permanentWethDepthWei: bigint;
}>;
type Client = Pick<PublicClient, 'getBlock' | 'getCode' | 'readContract' | 'getLogs'>;
type Block = { number: bigint; timestamp: bigint; hash: Hex };
const ABI = parseAbi([
  'function poolKey() view returns(address,address,uint24,int24,address)',
  'function poolId() view returns(bytes32)', 'function poolManager() view returns(address)',
  'function seedComplete() view returns(bool)', 'function decimals() view returns(uint8)', 'function symbol() view returns(string)',
  'function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)',
  'function getLiquidity(bytes32) view returns(uint128)',
  'function getPositionInfo(bytes32,address,int24,int24,bytes32) view returns(uint128,uint256,uint256)',
]);
const SWAP = parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const ZERO = `0x${'0'.repeat(64)}` as Hex, WAD = 10n ** 18n, Q96 = 1n << 96n;
// TickMath.getSqrtPriceAtTick(-887220), the canonical permanent position's lower bound.
const MIN_POSITION_SQRT = 4306310044n;
const LOOKBACK_BLOCKS = 72_000n, MAX_LOGS = 500;
const equal = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
function fail(message: string): never { throw new Error(`RAREFRIENDS pool price: ${message} Retry before launching.`); }
const price = (sqrt: bigint) => sqrt * sqrt * WAD / (Q96 * Q96);
const depth = (liquidity: bigint, sqrt: bigint) => liquidity * (sqrt - MIN_POSITION_SQRT) / Q96;

/** Arithmetic, time-weighted RF/WETH pool midprice reconstructed from every Swap
 * event over 30 minutes. This is a pool-derived launch seed, not an independent
 * oracle or executable swap quote. The trusted RPC must return complete logs;
 * anchors, event bounds, canonical hashes and latest state catch missing edges,
 * reorgs and common truncation, not a malicious RPC's omitted middle events.
 */
export async function readRareFriendsPoolPrice(client: Client, block: Block, signal: AbortSignal): Promise<RareFriendsPoolPrice> {
  signal.throwIfAborted(); const p = RARE_FRIENDS_POOL;
  if (block.number < LOOKBACK_BLOCKS || block.timestamp > BigInt(Number.MAX_SAFE_INTEGER)) fail('insufficient chain history.');
  const read = (address: Hex, functionName: string, args: readonly unknown[] = []) => client.readContract({ address, abi: ABI, functionName, args, blockNumber: block.number } as Parameters<Client['readContract']>[0]);
  const [codes, key, marketManager, hookManager, hookId, seeded, wethDecimals, wethSymbol, slot, active, position] = await Promise.all([
    Promise.all((['market', 'hook', 'manager', 'stateView'] as const).map(async name => {
      const code = await client.getCode({ address: p[name], blockNumber: block.number });
      if (!code || code === '0x' || keccak256(code) !== p[`${name}CodeHash`]) fail('canonical contract code changed.');
    })),
    read(p.market, 'poolKey'), read(p.market, 'poolManager'), read(p.hook, 'poolManager'), read(p.hook, 'poolId'),
    read(p.market, 'seedComplete'), read(p.weth, 'decimals'), read(p.weth, 'symbol'),
    read(p.stateView, 'getSlot0', [p.poolId]), read(p.stateView, 'getLiquidity', [p.poolId]),
    read(p.stateView, 'getPositionInfo', [p.poolId, p.market, -887220, 887220, ZERO]),
  ]);
  void codes; signal.throwIfAborted();
  if (!Array.isArray(key) || key.length !== 5 || !equal(key[0], p.token) || !equal(key[1], p.weth) || key[2] !== 8388608 || key[3] !== 60 || !equal(key[4], p.hook)
    || !equal(marketManager, p.manager) || !equal(hookManager, p.manager) || !equal(hookId, p.poolId) || seeded !== true || wethDecimals !== 18 || wethSymbol !== 'WETH') fail('canonical pool identity does not match.');
  const expectedId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [p.token, p.weth, 8388608, 60, p.hook]));
  if (expectedId !== p.poolId || !Array.isArray(slot) || slot.length !== 4 || typeof slot[0] !== 'bigint' || slot[0] <= MIN_POSITION_SQRT || slot[0] >= 1n << 160n
    || !Number.isInteger(slot[1]) || slot[1] <= -887220 || slot[1] >= 887220 || slot[2] !== 0 || slot[3] !== 0
    || typeof active !== 'bigint' || !Array.isArray(position) || typeof position[0] !== 'bigint' || position[0] <= 0n || position[0] > active) fail('pool state or permanent liquidity is invalid.');
  const currentSqrt = slot[0] as bigint, permanentLiquidity = position[0] as bigint;
  let minimumDepth = depth(permanentLiquidity, currentSqrt);
  if (minimumDepth < p.minimumWethDepthWei) fail('permanent WETH liquidity is below the 10 WETH minimum.');
  const fromBlock = block.number - LOOKBACK_BLOCKS;
  const [startBlock, logs] = await Promise.all([
    client.getBlock({ blockNumber: fromBlock }),
    client.getLogs({ address: p.manager, event: SWAP, args: { id: p.poolId }, fromBlock, toBlock: block.number, strict: true }),
  ]);
  signal.throwIfAborted();
  const windowEnd = Number(block.timestamp), windowStart = windowEnd - p.windowSeconds;
  if (!startBlock.hash || !/^0x[0-9a-f]{64}$/i.test(startBlock.hash) || startBlock.number !== fromBlock || typeof startBlock.timestamp !== 'bigint' || startBlock.timestamp <= 0n || startBlock.timestamp > BigInt(windowStart)) fail('history does not cover the full 30-minute window.');
  if (!logs.length || logs.length >= MAX_LOGS) fail('complete bounded swap history is unavailable.');
  // Resolve each unique event block once, at bounded concurrency.
  const headers = new Map<bigint, Block>([[block.number, block], [fromBlock, { number: startBlock.number, hash: startBlock.hash, timestamp: startBlock.timestamp }]]);
  let previousNumber = fromBlock, previousIndex = -1;
  for (const log of logs) {
    if (log.removed || !equal(log.address, p.manager) || !equal(log.args.id, p.poolId) || !log.blockHash || !log.transactionHash
      || !/^0x[0-9a-f]{64}$/i.test(log.blockHash) || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash)
      || typeof log.blockNumber !== 'bigint' || log.blockNumber < fromBlock || log.blockNumber > block.number || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0
      || log.blockNumber < previousNumber || (log.blockNumber === previousNumber && log.logIndex <= previousIndex)
      || typeof log.args.sqrtPriceX96 !== 'bigint' || log.args.sqrtPriceX96 <= MIN_POSITION_SQRT || log.args.sqrtPriceX96 >= 1n << 160n
      || typeof log.args.liquidity !== 'bigint' || log.args.liquidity < permanentLiquidity || !Number.isInteger(log.args.tick)
      || log.args.tick! <= -887220 || log.args.tick! >= 887220 || log.args.fee !== 0) fail('malformed or incomplete swap history.');
    previousIndex = log.logIndex; previousNumber = log.blockNumber;
  }
  const numbers = [...new Set(logs.map(log => log.blockNumber))].filter(number => !headers.has(number)); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, numbers.length) }, async () => {
    for (;;) {
      signal.throwIfAborted(); const number = numbers[cursor++]; if (number === undefined) return;
      const header = await client.getBlock({ blockNumber: number });
      if (header.number !== number || !header.hash || !/^0x[0-9a-f]{64}$/i.test(header.hash) || typeof header.timestamp !== 'bigint' || header.timestamp < startBlock.timestamp || header.timestamp > block.timestamp) fail('swap block timestamp is invalid.');
      headers.set(number, { number, hash: header.hash, timestamp: header.timestamp });
    }
  }));
  let anchor: { sqrt: bigint; at: number } | undefined, weightedPrice = 0n, lastAt = Number(startBlock.timestamp), lastSwapAt = 0;
  for (const log of logs) {
    const header = headers.get(log.blockNumber)!;
    if (!equal(header.hash, log.blockHash)) fail('swap block changed.');
    const at = Number(header.timestamp), sqrt = log.args.sqrtPriceX96!;
    if (at < lastAt) fail('swap timestamps are out of order.'); lastAt = at; lastSwapAt = at;
    if (at <= windowStart) anchor = { sqrt, at: windowStart };
    else {
      if (!anchor) fail('a preceding swap anchor is missing.');
      const observedDepth = depth(permanentLiquidity, anchor.sqrt); if (observedDepth < minimumDepth) minimumDepth = observedDepth;
      weightedPrice += price(anchor.sqrt) * BigInt(at - anchor.at); anchor = { sqrt, at };
    }
  }
  if (!anchor || lastSwapAt < windowEnd - p.maxSwapAgeSeconds) fail('swap history is stale or missing its anchor.');
  if (anchor.sqrt !== currentSqrt || logs.at(-1)!.args.tick !== slot[1]) fail('latest swap does not match the current pool state.');
  const finalDepth = depth(permanentLiquidity, anchor.sqrt); if (finalDepth < minimumDepth) minimumDepth = finalDepth;
  if (minimumDepth < p.minimumWethDepthWei) fail('permanent WETH liquidity was below the 10 WETH minimum.');
  weightedPrice += price(anchor.sqrt) * BigInt(windowEnd - anchor.at);
  const wethPerTokenE18 = weightedPrice / BigInt(p.windowSeconds), spotWethPerTokenE18 = price(currentSqrt);
  if (wethPerTokenE18 <= 0n || spotWethPerTokenE18 <= 0n) fail('computed price is invalid.');
  const deviation = spotWethPerTokenE18 > wethPerTokenE18 ? spotWethPerTokenE18 - wethPerTokenE18 : wethPerTokenE18 - spotWethPerTokenE18;
  if (deviation * 100n > wethPerTokenE18 * 20n) fail('current spot differs from the 30-minute average by more than 20%.');
  const end = await client.getBlock({ blockNumber: block.number }); signal.throwIfAborted();
  if (end.hash !== block.hash || end.timestamp !== block.timestamp) fail('verification block changed.');
  return Object.freeze({ poolId: p.poolId, windowStart, windowEnd, windowSeconds: p.windowSeconds, lastSwapAt, wethPerTokenE18, spotWethPerTokenE18, permanentWethDepthWei: minimumDepth });
}

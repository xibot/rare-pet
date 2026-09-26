import code from './rarefriends-pool-code.json' with { type: 'json' };

// Public canonical deployed bytecode, read at Robinhood block 73285693. The
// production reader independently pins its keccak hashes; tests never use RPC.
export const POOL_NOW = 1_790_000_000;
export const POOL_ID = '0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240';
export const POOL_SQRT = 61166820912278383824321488n;
export const POOL_LIQUIDITY = 147865847752143433133351n;
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const poolHash = (number: bigint) => `0x${number.toString(16).padStart(64, '0')}`;
export function poolFixture() {
  const headers = new Map([
    [100000n, { number: 100000n, timestamp: BigInt(POOL_NOW - 1), hash: poolHash(100000n) }],
    [28000n, { number: 28000n, timestamp: BigInt(POOL_NOW - 7201), hash: poolHash(28000n) }],
    [81000n, { number: 81000n, timestamp: BigInt(POOL_NOW - 1901), hash: poolHash(81000n) }],
    [91000n, { number: 91000n, timestamp: BigInt(POOL_NOW - 901), hash: poolHash(91000n) }],
    [97000n, { number: 97000n, timestamp: BigInt(POOL_NOW - 301), hash: poolHash(97000n) }],
  ]);
  const logs = [81000n, 91000n, 97000n].map((number, index) => ({
    address: POOL_MANAGER, blockNumber: number, blockHash: poolHash(number), logIndex: index,
    transactionHash: `0x${'cd'.repeat(32)}`, removed: false,
    args: { id: POOL_ID, sender: POOL_MANAGER, amount0: 1n, amount1: -1n,
      sqrtPriceX96: index === 1 ? POOL_SQRT * 1001n / 1000n : POOL_SQRT,
      liquidity: POOL_LIQUIDITY, tick: -143337, fee: 0 },
  }));
  const values: Record<string, unknown> = {
    poolKey: ['0x0779369854d3EcdEA927206718FFD7730C67B71f', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 8388608, 60, '0x7A65d0194e6Cc43971C31CE7D1471Da01D42A0cC'],
    poolManager: POOL_MANAGER, poolId: POOL_ID, seedComplete: true, decimals: 18, symbol: 'WETH',
    getSlot0: [POOL_SQRT, -143337, 0, 0], getLiquidity: POOL_LIQUIDITY, getPositionInfo: [POOL_LIQUIDITY, 0n, 0n],
  };
  const client = {
    getBlock: async ({ blockNumber = 100000n } = {}) => headers.get(blockNumber),
    getCode: async ({ address }) => code[address.toLowerCase()],
    readContract: async ({ functionName }) => values[functionName],
    getLogs: async () => logs,
  };
  return { client, headers, logs, values, block: headers.get(100000n)! };
}

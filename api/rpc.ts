import type { IncomingMessage, ServerResponse } from 'node:http';
import { getPrivateRpcUrl } from '../server/rarepet-rpc.ts';

export const RPC_LIMITS = Object.freeze({ batch: 20, inputBytes: 256 * 1024, outputBytes: 4 * 1024 * 1024,
  dataBytes: 64 * 1024, timeoutMs: 12_000, concurrency: 64, requestsPerMinute: 1200 });
type Request = IncomingMessage & { body?: unknown };
type Reply = Pick<ServerResponse, 'setHeader' | 'end'> & { statusCode: number };
type Id = number | string;
type RpcCall = { jsonrpc: '2.0'; id: Id; method: string; params: unknown[] };
type Dependencies = { fetcher?: typeof fetch; rpcUrl?: () => string; origins?: readonly string[]; environment?: NodeJS.ProcessEnv; now?: () => number;
  timeoutMs?: number; maxConcurrent?: number; requestsPerMinute?: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const quantity = (value: unknown): value is string => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
const address = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const hex = (value: unknown, maxBytes = RPC_LIMITS.dataBytes): value is string => typeof value === 'string' && value.length <= 2 + maxBytes * 2 && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const block = (value: unknown) => quantity(value) || typeof value === 'string' && ['latest', 'pending', 'earliest', 'safe', 'finalized'].includes(value);
const identifier = (value: unknown): value is Id => typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string' && value.length > 0 && value.length <= 100;
const NO_PARAMS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas']);
const METHODS = new Set([...NO_PARAMS, 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBalance', 'eth_getCode', 'eth_getLogs',
  'eth_call', 'eth_estimateGas', 'eth_feeHistory', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getTransactionCount']);
class RpcFailure extends Error {
  readonly status: number; readonly code: number;
  constructor(status: number, code: number, message: string) { super(message); this.status = status; this.code = code; }
}
const invalid = () => new RpcFailure(400, -32602, 'Invalid RPC parameters.');

function callObject(value: unknown) {
  if (!object(value) || !keys(value, ['to', 'from', 'data', 'input', 'value', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'type', 'accessList'])) return false;
  // viem uses an eth_call without `to` for deployless ERC-6492 signature verification.
  if (value.to !== undefined ? !address(value.to) : !hex(value.data ?? value.input) || String(value.data ?? value.input).length <= 2) return false;
  if (value.from !== undefined && !address(value.from) || value.data !== undefined && !hex(value.data) || value.input !== undefined && !hex(value.input)
    || value.data !== undefined && value.input !== undefined && value.data !== value.input) return false;
  for (const key of ['value', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'type']) if (value[key] !== undefined && !quantity(value[key])) return false;
  if (value.accessList !== undefined && (!Array.isArray(value.accessList) || value.accessList.length > 64 || !value.accessList.every(entry =>
    object(entry) && keys(entry, ['address', 'storageKeys']) && address(entry.address) && Array.isArray(entry.storageKeys) && entry.storageKeys.length <= 64 && entry.storageKeys.every(hash)))) return false;
  return true;
}
function logFilter(value: unknown) {
  if (!object(value) || !keys(value, ['address', 'fromBlock', 'toBlock', 'blockHash', 'topics'])) return false;
  if (value.blockHash !== undefined && (!hash(value.blockHash) || value.fromBlock !== undefined || value.toBlock !== undefined)) return false;
  if (value.fromBlock !== undefined && !block(value.fromBlock) || value.toBlock !== undefined && !block(value.toBlock)) return false;
  if (value.address !== undefined && !address(value.address) && !(Array.isArray(value.address) && value.address.length > 0 && value.address.length <= 20 && value.address.every(address))) return false;
  if (value.topics !== undefined && !(Array.isArray(value.topics) && value.topics.length <= 4 && value.topics.every(topic => topic === null || hash(topic) ||
    Array.isArray(topic) && topic.length > 0 && topic.length <= 20 && topic.every(item => item === null || hash(item))))) return false;
  // Inventory reads omit an address but always constrain transfer events and the recipient wallet.
  return value.address !== undefined || Array.isArray(value.topics) && value.topics.some(topic => hash(topic) ||
    Array.isArray(topic) && topic.length > 0 && topic.every(hash));
}
function validateCall(value: unknown): RpcCall {
  if (!object(value) || !keys(value, ['jsonrpc', 'id', 'method', 'params']) || value.jsonrpc !== '2.0' || !identifier(value.id) || typeof value.method !== 'string') {
    throw new RpcFailure(400, -32600, 'Invalid RPC request.');
  }
  if (!METHODS.has(value.method)) throw new RpcFailure(400, -32601, 'RPC method is not allowed.');
  const params = value.params === undefined ? [] : value.params;
  if (!Array.isArray(params)) throw invalid();
  let valid = false;
  if (NO_PARAMS.has(value.method)) valid = params.length === 0;
  else if (['eth_getBalance', 'eth_getCode', 'eth_getTransactionCount'].includes(value.method)) valid = params.length === 2 && address(params[0]) && block(params[1]);
  else if (value.method === 'eth_getBlockByNumber') valid = params.length === 2 && block(params[0]) && typeof params[1] === 'boolean';
  else if (value.method === 'eth_getBlockByHash') valid = params.length === 2 && hash(params[0]) && typeof params[1] === 'boolean';
  else if (['eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(value.method)) valid = params.length === 1 && hash(params[0]);
  else if (value.method === 'eth_getLogs') valid = params.length === 1 && logFilter(params[0]);
  else if (value.method === 'eth_call' || value.method === 'eth_estimateGas') valid = params.length >= 1 && params.length <= 2 && callObject(params[0]) && (params.length === 1 || block(params[1]));
  else if (value.method === 'eth_feeHistory') valid = params.length === 3 && quantity(params[0]) && BigInt(params[0]) > 0n && BigInt(params[0]) <= 1024n && block(params[1]) &&
    Array.isArray(params[2]) && params[2].length <= 16 && params[2].every((item, index, list) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100 && (index === 0 || item >= list[index - 1]));
  if (!valid) throw invalid();
  return { jsonrpc: '2.0', id: value.id, method: value.method, params };
}
function validatePayload(value: unknown) {
  const batch = Array.isArray(value);
  if (batch && (value.length === 0 || value.length > RPC_LIMITS.batch)) throw new RpcFailure(400, -32600, 'Invalid RPC batch.');
  const calls = (batch ? value : [value]).map(validateCall);
  if (new Set(calls.map(call => JSON.stringify(call.id))).size !== calls.length) throw new RpcFailure(400, -32600, 'RPC request IDs must be unique.');
  return { calls, batch };
}
async function readBody(request: Request, signal: AbortSignal) {
  if (request.body !== undefined) {
    const encoded = typeof request.body === 'string' ? request.body : Buffer.isBuffer(request.body) ? request.body.toString('utf8') : JSON.stringify(request.body);
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > RPC_LIMITS.inputBytes) throw new RpcFailure(413, -32600, 'RPC request is too large.');
    return JSON.parse(encoded);
  }
  const parts: Buffer[] = []; let size = 0;
  for await (const part of request) {
    signal.throwIfAborted(); const bytes = Buffer.from(part); size += bytes.length;
    if (size > RPC_LIMITS.inputBytes) throw new RpcFailure(413, -32600, 'RPC request is too large.');
    parts.push(bytes);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function deadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new RpcFailure(504, -32000, 'RPC request timed out.')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
async function readResponse(response: Response, signal: AbortSignal) {
  if (response.status === 429) { void response.body?.cancel().catch(() => {}); throw new RpcFailure(429, -32005, 'RPC rate limit exceeded. Retry shortly.'); }
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new RpcFailure(502, -32000, 'RPC service is unavailable.');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > RPC_LIMITS.outputBytes)) { void response.body.cancel().catch(() => {}); throw new RpcFailure(502, -32000, 'RPC response size limit exceeded.'); }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > RPC_LIMITS.outputBytes) throw new RpcFailure(502, -32000, 'RPC response size limit exceeded.');
      parts.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
}
type Validator = (value: unknown) => boolean;
const bytes: Validator = value => hex(value, RPC_LIMITS.outputBytes);
const nullable = (check: Validator): Validator => value => value === null || check(value);
const ratio: Validator = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const list = (check: Validator, max: number): Validator => value => Array.isArray(value) && value.length <= max && value.every(check);
function project(value: unknown, schema: Record<string, Validator>, required: readonly string[] = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key))) throw new Error();
  const clean: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) continue;
    if (!check(value[key])) throw new Error();
    clean[key] = value[key];
  }
  return clean;
}
function cleanAccessList(value: unknown) {
  if (!Array.isArray(value) || value.length > 1024) throw new Error();
  return value.map(entry => project(entry, { address, storageKeys: list(hash, 1024) }, ['address', 'storageKeys']));
}
function cleanTransaction(value: unknown) {
  const clean = project(value, {
    hash, from: address, to: nullable(address), input: bytes, value: quantity,
    blockHash: nullable(hash), blockNumber: nullable(quantity), transactionIndex: nullable(quantity),
    chainId: quantity, gas: quantity, gasPrice: quantity, maxFeePerGas: quantity, maxPriorityFeePerGas: quantity,
    maxFeePerBlobGas: quantity, nonce: quantity, type: quantity, v: quantity, r: quantity, s: quantity, yParity: quantity,
    blobVersionedHashes: list(hash, 64), sourceHash: hash, mint: nullable(quantity), isSystemTx: value => typeof value === 'boolean',
  }, ['hash', 'from', 'to', 'input', 'value']);
  const source = value as Record<string, unknown>;
  if (source.accessList !== undefined) clean.accessList = cleanAccessList(source.accessList);
  if (source.authorizationList !== undefined) {
    if (!Array.isArray(source.authorizationList) || source.authorizationList.length > 1024) throw new Error();
    clean.authorizationList = source.authorizationList.map(item => project(item,
      { address, chainId: quantity, nonce: quantity, yParity: quantity, r: quantity, s: quantity }, ['address', 'chainId', 'nonce', 'yParity', 'r', 's']));
  }
  return clean;
}
function cleanLogs(value: unknown) {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error();
  return value.map(item => project(item, {
    address, topics: list(hash, 4), data: bytes, transactionHash: nullable(hash), blockHash: nullable(hash), blockNumber: nullable(quantity),
    transactionIndex: nullable(quantity), logIndex: nullable(quantity), removed: value => typeof value === 'boolean',
  }, ['address', 'topics', 'data', 'transactionHash', 'blockHash', 'blockNumber']));
}
/** Only typed standard chain fields leave the server; provider metadata is discarded at every level. */
function cleanResult(method: string, value: unknown): unknown {
  if (NO_PARAMS.has(method) || ['eth_getBalance', 'eth_getTransactionCount', 'eth_estimateGas'].includes(method)) {
    if (!quantity(value)) throw new Error(); return value;
  }
  if (method === 'eth_call' || method === 'eth_getCode') { if (!bytes(value)) throw new Error(); return value; }
  if (method === 'eth_getLogs') return cleanLogs(value);
  if (method === 'eth_feeHistory') return project(value, {
    oldestBlock: quantity, baseFeePerGas: list(quantity, 1025), gasUsedRatio: list(ratio, 1024),
    reward: list(list(quantity, 16), 1024), baseFeePerBlobGas: list(quantity, 1025), blobGasUsedRatio: list(ratio, 1024),
  }, ['oldestBlock', 'baseFeePerGas', 'gasUsedRatio']);
  if (value === null) return null;
  if (method === 'eth_getTransactionByHash') return cleanTransaction(value);
  if (method === 'eth_getTransactionReceipt') {
    const clean = project(value, {
      transactionHash: hash, blockHash: hash, blockNumber: quantity, transactionIndex: quantity, from: address, to: nullable(address),
      contractAddress: nullable(address), cumulativeGasUsed: quantity, effectiveGasPrice: quantity, gasUsed: quantity, logsBloom: bytes,
      status: value => value === '0x0' || value === '0x1', root: hash, type: quantity, blobGasUsed: quantity, blobGasPrice: quantity,
      gasUsedForL1: quantity, l1Fee: quantity, l1GasPrice: quantity, l1GasUsed: quantity,
    }, ['transactionHash', 'blockHash', 'blockNumber']);
    clean.logs = cleanLogs((value as Record<string, unknown>).logs); return clean;
  }
  const clean = project(value, {
    hash: nullable(hash), number: nullable(quantity), timestamp: quantity, parentHash: hash, nonce: nullable(bytes), sha3Uncles: hash,
    logsBloom: nullable(bytes), transactionsRoot: hash, stateRoot: hash, receiptsRoot: hash, miner: address,
    difficulty: quantity, totalDifficulty: quantity, extraData: bytes, size: quantity, gasLimit: quantity, gasUsed: quantity,
    baseFeePerGas: quantity, mixHash: hash, uncles: list(hash, 1024), withdrawalsRoot: hash, blobGasUsed: quantity,
    excessBlobGas: quantity, parentBeaconBlockRoot: hash, requestsHash: hash, l1BlockNumber: quantity, sendRoot: hash, sendCount: quantity,
  }, ['hash', 'number', 'timestamp']);
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.transactions) || source.transactions.length > 100_000) throw new Error();
  clean.transactions = source.transactions.map(transaction => hash(transaction) ? transaction : cleanTransaction(transaction));
  if (source.withdrawals !== undefined) {
    if (!Array.isArray(source.withdrawals) || source.withdrawals.length > 10_000) throw new Error();
    clean.withdrawals = source.withdrawals.map(item => project(item, { index: quantity, validatorIndex: quantity, address, amount: quantity }, ['index', 'validatorIndex', 'address', 'amount']));
  }
  return clean;
}
function revertData(value: unknown): string | undefined {
  if (hex(value)) return value;
  if (object(value)) {
    if (hex(value.data)) return value.data;
    if (object(value.originalError) && hex(value.originalError.data)) return value.originalError.data;
  }
  return undefined;
}
function providerMessage(error: Record<string, unknown>, method: string, data: string | undefined) {
  if (data !== undefined || error.code === 3) return 'Execution reverted.';
  const message = typeof error.message === 'string' ? error.message.slice(0, 2000) : '';
  if (error.code === 429 || /rate.?limit|too many requests|throttl/i.test(message)) return 'RPC rate limit exceeded. Retry shortly.';
  if (method === 'eth_getLogs' && /range|too many|response size|query.*timeout|limit|exceed/i.test(message)) return 'RPC block range limit exceeded. Retry a smaller range.';
  return 'RPC request failed.';
}
function validateResponse(value: unknown, calls: RpcCall[], batch: boolean) {
  if (batch !== Array.isArray(value)) throw new Error();
  const responses = batch ? value as unknown[] : [value];
  if (responses.length !== calls.length) throw new Error();
  const remaining = new Map(calls.map(call => [JSON.stringify(call.id), call]));
  const clean = responses.map(response => {
    if (!object(response) || response.jsonrpc !== '2.0' || !identifier(response.id)) throw new Error();
    const key = JSON.stringify(response.id), call = remaining.get(key);
    if (!call || Object.hasOwn(response, 'result') === Object.hasOwn(response, 'error')) throw new Error();
    remaining.delete(key);
    if (Object.hasOwn(response, 'result')) {
      return { jsonrpc: '2.0', id: call.id, result: cleanResult(call.method, response.result) };
    }
    if (!object(response.error) || !Number.isSafeInteger(response.error.code)) throw new Error();
    const data = revertData(response.error.data);
    return { jsonrpc: '2.0', id: call.id, error: { code: response.error.code,
      message: providerMessage(response.error, call.method, data), ...(data !== undefined ? { data } : {}) } };
  });
  return batch ? clean : clean[0];
}
function errorReply(value: unknown, code: number, message: string) {
  const error = (item: unknown) => ({ jsonrpc: '2.0', id: object(item) && identifier(item.id) ? item.id : null, error: { code, message } });
  return Array.isArray(value) && value.length > 0 && value.length <= RPC_LIMITS.batch ? value.map(error) : error(value);
}
function configuredOrigins(environment: NodeJS.ProcessEnv) {
  return ['https://rarepet.app', 'https://www.rarepet.app', 'https://rarepet.vercel.app', 'https://rarepet-xibot.vercel.app', ...[environment.VERCEL_URL, environment.VERCEL_BRANCH_URL]
    .filter((host): host is string => typeof host === 'string' && /^[a-z0-9.-]+\.vercel\.app$/i.test(host)).map(host => `https://${host}`)];
}
function developmentOrigin(origin: string, environment: NodeJS.ProcessEnv) {
  if (environment.VERCEL === '1' || environment.NODE_ENV === 'production') return false;
  try { const url = new URL(origin); return url.origin === origin && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
  catch { return false; }
}

/** Fixed-destination, read-only proxy. Limits are per warm function instance, not a global quota. */
export function createRpcHandler({ fetcher = fetch, rpcUrl = getPrivateRpcUrl, origins, environment = process.env, now = Date.now, timeoutMs = RPC_LIMITS.timeoutMs,
  maxConcurrent = RPC_LIMITS.concurrency, requestsPerMinute = RPC_LIMITS.requestsPerMinute }: Dependencies = {}) {
  let active = 0, windowStart = now(), requests = 0;
  return async (request: Request, response: Reply) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    let payload: unknown;
    const send = (status: number, value: unknown) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    try {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new RpcFailure(405, -32600, 'Use POST.'); }
      const origin = request.headers.origin, site = request.headers['sec-fetch-site'];
      if (typeof origin === 'string' ? !(origins ?? configuredOrigins(environment)).includes(origin) && !developmentOrigin(origin, environment) : origin !== undefined || site !== 'same-origin') throw new RpcFailure(403, -32600, 'Use the RarePet app for RPC requests.');
      if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] ?? '')) || request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new RpcFailure(415, -32600, 'Use JSON RPC requests.');
      const length = request.headers['content-length'];
      if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > RPC_LIMITS.inputBytes)) throw new RpcFailure(413, -32600, 'RPC request is too large.');
      try { payload = await deadline(signal => readBody(request, signal), Math.min(timeoutMs, 3_000)); }
      catch (cause) { if (cause instanceof RpcFailure) throw cause; throw new RpcFailure(400, -32700, 'Invalid JSON.'); }
      const { calls, batch } = validatePayload(payload);
      if (now() - windowStart >= 60_000) { windowStart = now(); requests = 0; }
      if (active + calls.length > maxConcurrent || requests + calls.length > requestsPerMinute) { response.setHeader('Retry-After', '2'); throw new RpcFailure(429, -32005, 'RPC capacity is busy. Retry shortly.'); }
      let endpoint: string;
      try { endpoint = rpcUrl(); } catch { throw new RpcFailure(503, -32000, 'Private RPC is not configured correctly.'); }
      active += calls.length; requests += calls.length;
      try {
        const output = await deadline(async signal => {
          const upstream = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(batch ? calls : calls[0]), redirect: 'error', signal });
          return validateResponse(await readResponse(upstream, signal), calls, batch);
        }, timeoutMs);
        if (Buffer.byteLength(JSON.stringify(output)) > RPC_LIMITS.outputBytes) throw new RpcFailure(502, -32000, 'RPC response size limit exceeded.');
        send(200, output);
      } finally { active -= calls.length; }
    } catch (cause) {
      const failure = cause instanceof RpcFailure ? cause : new RpcFailure(502, -32000, 'RPC service is unavailable.');
      send(failure.status, errorReply(payload, failure.code, failure.message));
    }
  };
}
export default createRpcHandler();

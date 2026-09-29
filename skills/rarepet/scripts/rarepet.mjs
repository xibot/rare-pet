#!/usr/bin/env node
/** RarePet reads and unsigned plans. Node 22+, no dependencies, keys, signing or broadcasts. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const protocol = JSON.parse(await readFile(new URL('../references/protocol.json', import.meta.url), 'utf8'));
const ACTIONS = ['pet', 'feed', 'play', 'poop'];
const ZERO = '0x' + '0'.repeat(40);
const ALLOWED_RPC = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
const uint = value => {
  const s = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(s) || BigInt(s) >= 1n << 256n) throw new Error('Expected a decimal uint256.');
  return BigInt(s);
};
const address = value => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || value.toLowerCase() === ZERO) throw new Error('Expected a nonzero public wallet address.');
  return value.toLowerCase();
};
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
const word = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
  ? value.slice(2).toLowerCase().padStart(64, '0') : uint(value).toString(16).padStart(64, '0');
export function calldata(name, args = []) {
  const selector = protocol.selectors[name];
  if (!selector) throw new Error('Unknown contract method.');
  return selector + args.map(word).join('');
}
function words(raw, length) {
  if (typeof raw !== 'string' || !/^0x(?:[0-9a-fA-F]{64})*$/.test(raw)) throw new Error('Invalid ABI response.');
  const result = raw.slice(2).match(/.{64}/g) ?? [];
  if (length !== undefined && result.length !== length) throw new Error('Unexpected ABI response length.');
  return result;
}
const n = value => BigInt('0x' + value);
const dec = value => n(value).toString();
const flag = value => { const v = n(value); if (v > 1n) throw new Error('Invalid ABI boolean.'); return v === 1n; };
const addr = value => { if (!/^0{24}[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid ABI address.'); return '0x' + value.slice(24).toLowerCase(); };
function record(keys, values) { return Object.fromEntries(keys.map((key, i) => [key, dec(values[i])])); }
function digest(code) {
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error('Contract code is missing.');
  return createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
}
export function decodeRules(raw) {
  const w = words(raw, 26);
  const actions = Object.fromEntries(ACTIONS.map((action, i) => [action, {
    ...record(['points', 'secondaryPoints', 'cooldown', 'dailyLimit'], w.slice(i * 5)), enabled: flag(w[i * 5 + 4]),
  }]));
  for (const rule of Object.values(actions)) {
    if (BigInt(rule.points) > 1_000_000n || BigInt(rule.secondaryPoints) > 1_000_000n || BigInt(rule.cooldown) > 30n * 86400n || BigInt(rule.dailyLimit) < 1n || BigInt(rule.dailyLimit) > 32n) throw new Error('Unsupported action policy.');
  }
  if (actions.pet.cooldown !== '86400' || actions.pet.dailyLimit !== '1') throw new Error('Pet policy mismatch.');
  return { actions, ...record(['petGrace', 'decayInterval', 'decayPoints', 'rarityEvery', 'rarityPoints'], w.slice(20)), playSigner: addr(w[25]) };
}
export function decodePet(raw) {
  const w = words(raw);
  // One dynamic tuple: outer offset, nineteen fields, then its playTimes array.
  if (w.length < 21 || n(w[0]) !== 32n || n(w[13]) !== 608n) throw new Error('Unsupported care tuple.');
  const count = n(w[20]);
  if (count > 32n || count !== n(w[14]) || w.length !== 21 + Number(count)) throw new Error('Invalid play history.');
  const care = record(['kinship', 'strength', 'stamina', 'health', 'experience', 'unusedCareBrain', 'streak', 'rarity', 'lastPetAt', 'lastFeedAt', 'lastPoopAt', 'unusedCareLastLaunchAt'], w.slice(1));
  delete care.unusedCareBrain; delete care.unusedCareLastLaunchAt;
  return { ...care, playTimes: w.slice(21).map(dec), decayApplied: dec(w[15]), hasPet: flag(w[16]), hasFed: flag(w[17]), hasPooped: flag(w[18]) };
}
export function makeRpc(endpoint = process.env.RAREPET_RPC_URL || protocol.publicRpc) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('RAREPET_RPC_URL is invalid.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS RPC URL.');
  let id = 0;
  return async (method, params = []) => {
    if (!ALLOWED_RPC.has(method)) throw new Error('RPC method forbidden by read-only helper.');
    if (!Array.isArray(params) || (method === 'eth_call' && params.length !== 2)) throw new Error('State overrides and malformed RPC parameters are forbidden.');
    const requestId = ++id;
    let response;
    try {
      response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(20_000) });
    } catch { throw new Error('RPC request failed or timed out. The endpoint was not logged.'); }
    if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('RPC response body is missing.');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw new Error('RPC response exceeds the size limit.'); }
        chunks.push(value);
      }
    } catch { throw new Error('RPC response could not be read within the time/size limit.'); }
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = JSON.parse(raw); } catch { throw new Error('RPC returned invalid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== requestId) throw new Error('RPC response identity mismatch.');
    if (body.error || !Object.hasOwn(body, 'result')) throw new Error(`RPC ${method} failed${Number.isSafeInteger(body.error?.code) ? ` (${body.error.code})` : ''}. No plan was completed.`);
    return body.result;
  };
}
function blockValue(block) {
  if (!block || !/^0x[0-9a-f]+$/i.test(block.number) || !/^0x[0-9a-f]{64}$/i.test(block.hash) || !/^0x[0-9a-f]+$/i.test(block.timestamp)) throw new Error('Expected a mined snapshot block.');
  return block;
}
export async function inspect({ collection, tokenId, owner, action }, rpc = makeRpc()) {
  if (!Object.hasOwn(protocol.collections, collection)) throw new Error('Collection must be genesis or generations.');
  const id = uint(tokenId);
  if (id < 1n) throw new Error('Token ID must be positive.');
  if (action && !['pet', 'feed', 'poop'].includes(action)) throw new Error('Unsigned plans support pet, feed and poop only.');
  if (action && !owner) throw new Error('An unsigned plan requires --owner with the public owner address.');
  const expectedOwner = owner ? address(owner) : null;
  const chainId = await rpc('eth_chainId');
  if (chainId !== '0x1237' && BigInt(chainId) !== BigInt(protocol.chainId)) throw new Error('RPC is not Robinhood mainnet (4663).');
  const block = blockValue(await rpc('eth_getBlockByNumber', ['latest', false]));
  const contract = protocol.collections[collection];
  const call = async (to, method, args = [], from) => rpc('eth_call', [{ to, data: calldata(method, args), ...(from ? { from } : {}) }, block.number]);
  const fixed = (method, args = []) => call(protocol.care, method, args);
  const args = [contract, id];
  const [code, careChain, genesis, generations, ownerRaw, versionRaw] = await Promise.all([
    rpc('eth_getCode', [protocol.care, block.number]), fixed('CHAIN_ID'), fixed('GENESIS'), fixed('GENERATIONS'),
    call(contract, 'ownerOf', [id]), fixed('currentRuleVersion'),
  ]);
  if (digest(code) !== protocol.careRuntimeSha256) throw new Error('Care runtime differs from the reviewed deployment. Update/review the skill before proceeding.');
  if (n(words(careChain, 1)[0]) !== 4663n || !eq(addr(words(genesis, 1)[0]), protocol.collections.genesis) || !eq(addr(words(generations, 1)[0]), protocol.collections.generations)) throw new Error('Care deployment identity mismatch.');
  const canonicalOwner = address(addr(words(ownerRaw, 1)[0]));
  if (expectedOwner && !eq(expectedOwner, canonicalOwner)) throw new Error('The supplied owner does not currently own this Rare Friend.');
  const version = n(words(versionRaw, 1)[0]);
  if (version < 1n) throw new Error('No valid care rule version.');
  const [policy, petRaw, totalRaw, scheduleRaw, countRaw, availabilityRaw, generationRaw] = await Promise.all([
    fixed('rules', [version]), fixed('getPet', args), fixed('getLifetime', args), fixed('getPetSchedule', args), fixed('actionCount', args),
    Promise.all(ACTIONS.map((_, index) => fixed('actionAvailability', [...args, index]))),
    collection === 'generations' ? call(contract, 'generation', [id]) : null,
  ]);
  const rules = decodeRules(policy), care = decodePet(petRaw);
  const generation = generationRaw === null ? null : n(words(generationRaw, 1)[0]);
  if (generation !== null && generation > 255n) throw new Error('Invalid generation.');
  const walletAddress = generation === 0n ? null : address(addr(words(await call(contract, 'tokenBoundAccount', [id]), 1)[0]));
  const lifetime = record(['kinship', 'strength', 'stamina', 'health', 'experience', 'rarity', 'bestStreak', 'petCount', 'feedCount', 'playCount', 'poopCount'], words(totalRaw, 11));
  const petSchedule = record(['nextAvailableAt', 'graceDeadline', 'decayInterval', 'decayPoints', 'nextRarityAt', 'nextRarityPoints'], words(scheduleRaw, 6));
  const availability = Object.fromEntries(ACTIONS.map((name, index) => {
    const w = words(availabilityRaw[index], 3), remaining = n(w[0]), readyAt = n(w[1]), enabled = flag(w[2]);
    if (remaining > BigInt(rules.actions[name].dailyLimit) || ((!enabled || !rules.actions[name].enabled) && remaining > 0n)) throw new Error('Inconsistent care availability.');
    return [name, { remaining: remaining.toString(), readyAt: readyAt.toString(), waitSeconds: (readyAt > BigInt(block.timestamp) ? readyAt - BigInt(block.timestamp) : 0n).toString(), enabled }];
  }));
  const actionCount = n(words(countRaw, 1)[0]);
  const history = await Promise.all(Array.from({ length: Number(actionCount > 8n ? 8n : actionCount) }, async (_, index) => {
    const sequence = actionCount - (actionCount > 8n ? 8n : actionCount) + BigInt(index) + 1n;
    const w = words(await fixed('actionRecord', [...args, sequence]), 7), actionIndex = n(w[0]);
    if (actionIndex > 3n || n(w[3]) < 1n || n(w[3]) > version || n(w[1]) > BigInt(block.timestamp)) throw new Error('Invalid care history.');
    return { sequence: sequence.toString(), action: ACTIONS[Number(actionIndex)], timestamp: dec(w[1]), owner: addr(w[2]), ...record(['ruleVersion', 'points', 'secondaryPoints', 'rarityPoints'], w.slice(3)) };
  }));
  // Brain lives in launch routers. Never use the care tuple's legacy Brain field.
  const launchRecords = await Promise.all([protocol.launchRouter, ...protocol.archivedLaunchRouters].map(async router => {
    if (digest(await rpc('eth_getCode', [router, block.number])) !== (eq(router, protocol.launchRouter) ? protocol.launchRuntimeSha256 : protocol.archivedLaunchRuntimeSha256[router.toLowerCase()])) throw new Error('Launch runtime differs from the reviewed deployment.');
    const w = words(await call(router, 'getLaunch', args), 3);
    return { router, brain: dec(w[0]), lastLaunchAt: dec(w[1]), hasLaunched: flag(w[2]) };
  }));
  const launchReadyAt = launchRecords[0].hasLaunched ? BigInt(launchRecords[0].lastLaunchAt) + 86400n : BigInt(block.timestamp);
  const output = {
    schemaVersion: 1, mode: action ? 'unsigned-plan' : 'status', chainId: protocol.chainId,
    snapshot: { blockNumber: BigInt(block.number).toString(), blockHash: block.hash, timestamp: BigInt(block.timestamp).toString() },
    friend: { collection, collectionAddress: contract, tokenId: id.toString(), owner: canonicalOwner, walletAddress, generation: generation?.toString() ?? null },
    careContract: protocol.care, ruleVersion: version.toString(), rules, current: care, lifetime, petSchedule, availability, actionCount: actionCount.toString(), recentHistory: history,
    launch: { brain: launchRecords[0].brain, totalAcrossRouters: launchRecords.reduce((sum, entry) => sum + BigInt(entry.brain), 0n).toString(), currentRouter: protocol.launchRouter, records: launchRecords,
      currentRouterReadyAt: launchReadyAt.toString(), currentRouterWaitSeconds: (launchReadyAt > BigInt(block.timestamp) ? launchReadyAt - BigInt(block.timestamp) : 0n).toString() },
    playXp: 'This skill does not prepare Play claims. The app completion verifier is not integrated.',
  };
  if (action) {
    if (!availability[action].enabled || availability[action].remaining === '0' || availability[action].waitSeconds !== '0') throw new Error(`${action} is paused or cooling down; no transaction plan was produced.`);
    const data = calldata(action, [...args, version]);
    const result = await rpc('eth_call', [{ from: canonicalOwner, to: protocol.care, data, value: '0x0' }, block.number]);
    if (result !== '0x') throw new Error('Unexpected care simulation result.');
    output.action = action;
    output.simulation = 'passed at snapshot block; no transaction was sent';
    output.transaction = { chainId: '0x1237', from: canonicalOwner, to: protocol.care, value: '0x0', data };
    output.beforeSigning = 'Refresh ownership, chain, active rule version and availability; simulate again. Gas/nonce/fees are deliberately absent. This plan is not authorization or a signed transaction.';
  }
  const canonical = blockValue(await rpc('eth_getBlockByNumber', [block.number, false]));
  if (!eq(canonical.hash, block.hash) || canonical.timestamp !== block.timestamp) throw new Error('Snapshot changed. Discard this result and read again.');
  return output;
}
export function parseArguments(args) {
  const [command, ...rest] = args;
  if (!['status', 'plan'].includes(command)) throw new Error('Use status or plan. Run --help for examples.');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--collection', '--token-id', '--owner', '--action'].includes(key) || !rest[i + 1] || options[key]) throw new Error('Unknown, duplicate or missing argument.');
    options[key] = rest[i + 1];
  }
  if (!options['--collection'] || !options['--token-id']) throw new Error('Provide --collection and --token-id.');
  if (command === 'plan' && (!options['--action'] || !options['--owner'])) throw new Error('Plan requires --action and --owner.');
  if (command === 'status' && options['--action']) throw new Error('Status cannot contain an action.');
  return { collection: options['--collection'], tokenId: options['--token-id'], owner: options['--owner'], action: options['--action'] };
}
const HELP = `RarePet agent helper · Node 22+ · reads and unsigned plans only

node scripts/rarepet.mjs status --collection generations --token-id 68356
node scripts/rarepet.mjs plan --collection generations --token-id 68356 --action pet --owner 0xYOUR_PUBLIC_OWNER_ADDRESS

Collections: genesis, generations. Plan actions: pet, feed, poop.
No installation, wallet connection, keys, signing or broadcasts.
Optional RAREPET_RPC_URL selects your HTTPS RPC locally; its value is never printed.
JSON integer quantities are decimal strings. An unsigned plan requires fresh review before signing.
`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).includes('--help')) console.log(HELP);
    else console.log(JSON.stringify(await inspect(parseArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Read failed.', transactionProduced: false }));
    process.exitCode = 1;
  }
}

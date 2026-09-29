import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const site = 'https://rarepet.app';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// A small, portable ZIP writer: stored entries, fixed timestamp, no system binary.
// The package is text-only and small; ZIP64 and compression are unnecessary.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function skillZip(files) {
  const entries = [], directory = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    if (!/^rarepet\/(?:[a-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(name) || name.includes('..') || bytes.length > 2_000_000) throw new Error('Invalid skill archive entry.');
    const filename = Buffer.from(name), checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    entries.push(local, filename, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, filename); offset += local.length + filename.length + bytes.length;
  }
  if (files.length > 100 || offset > 5_000_000) throw new Error('Skill package is unexpectedly large.');
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, central, end]);
}

async function skillFiles(root, relative = '') {
  const files = [];
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || !/^[A-Za-z0-9_.-]+$/.test(entry.name)) throw new Error(`Unsupported skill resource: ${name}`);
    if (entry.isDirectory()) {
      if (!['agents', 'references', 'scripts'].includes(name)) throw new Error(`Unsupported skill directory: ${name}`);
      files.push(...await skillFiles(root, name));
    } else {
      if (!entry.isFile() || !/\.(?:md|mjs|json|yaml)$/.test(name)) throw new Error(`Unsupported skill resource: ${name}`);
      files.push({ name: `rarepet/${name}`, bytes: await readFile(path.join(root, name)) });
    }
  }
  if (!relative && !files.some(file => file.name === 'rarepet/SKILL.md')) throw new Error('The RarePet skill entrypoint is missing.');
  return files;
}

export async function buildAgentResources(project, outdir, { careAddress = '', launchAddress = '' } = {}) {
  const [files, care, launch] = await Promise.all([
    skillFiles(path.join(project, 'skills/rarepet')),
    readFile(path.join(project, 'contracts/rare-pet/deployments/4663.json'), 'utf8').then(JSON.parse),
    readFile(path.join(project, 'contracts/rare-launchpad/deployments/4663-0xc6a4b2d4d369747b26e4ff805a79a57da2505dc3.json'), 'utf8').then(JSON.parse),
  ]);
  const zip = skillZip(files);
  const protocolFile = files.find(file => file.name === 'rarepet/references/protocol.json');
  if (!protocolFile) throw new Error('The skill protocol metadata is missing.');
  const protocol = JSON.parse(protocolFile.bytes.toString());
  if (protocol.chainId !== care.chainId || protocol.chainId !== launch.chainId
    || protocol.care.toLowerCase() !== care.address.toLowerCase()
    || protocol.launchRouter.toLowerCase() !== launch.address.toLowerCase()
    || protocol.careRuntimeKeccak256 !== care.runtimeCodeHash
    || protocol.launchRuntimeKeccak256 !== launch.integrity.runtimeCodeHash
    || protocol.collections.genesis.toLowerCase() !== launch.configuration.getters.GENESIS.toLowerCase()
    || protocol.collections.generations.toLowerCase() !== launch.configuration.getters.GENERATIONS.toLowerCase()) {
    throw new Error('The skill protocol metadata does not match the tracked deployments.');
  }
  const manifest = {
    schemaVersion: 1, name: 'rarepet', version: '1.0.0', title: 'RarePet agent skill',
    description: 'Read your Rare Friend’s care, prepare unsigned care transactions, and use RarePet with your agent.',
    website: site, page: `${site}/agent/`, documentation: `${site}/docs/`, discovery: `${site}/llms.txt`,
    skill: { entrypoint: `${site}/skills/rarepet/SKILL.md`, archive: `${site}/skills/rarepet.zip`, sha256: sha256(zip),
      files: files.map(file => ({ path: file.name, url: `${site}/skills/${file.name}`, sha256: sha256(file.bytes), bytes: file.bytes.length })) },
    runtime: { helper: 'Node.js 22 or later', dependencies: 'none', signsTransactions: false, broadcastsTransactions: false, storesKeys: false },
    chain: { id: protocol.chainId, name: 'Robinhood Chain', nativeCurrency: 'ETH', publicRpc: protocol.publicRpc, explorer: protocol.explorer },
    collections: { genesis: launch.configuration.getters.GENESIS, generations: launch.configuration.getters.GENERATIONS },
    deployments: {
      care: { address: care.address, runtimeCodeHash: care.runtimeCodeHash, sourceVerification: care.sourceVerification.match, deploymentBlock: care.receipt.blockNumber },
      launch: { address: launch.address, runtimeCodeHash: launch.integrity.runtimeCodeHash, sourceVerification: launch.sourceVerification?.match ?? 'partial', deploymentBlock: launch.deployedAt.blockNumber },
    },
    appBuild: { careConfigured: careAddress.toLowerCase() === care.address.toLowerCase(), launchConfigured: launchAddress.toLowerCase() === launch.address.toLowerCase() },
    capabilities: {
      careStatus: 'Read-only helper: ownership, traits, active rules, cooldowns and care history.',
      carePlan: 'Unsigned owner transactions for Pet, Feed and Poop. Recheck current rules and simulate before signing.',
      preview: 'Browser demo; local progress only.',
      share: 'Browser PNG/GIF export; no care transaction.',
      rareWallet: 'App-guided balances, transfers and fee claims. Eligible canonical RF wallets only.',
      launch: 'App-guided launch as yourself or your Friend, through the Daily Care LAUNCH button.',
      trade: 'App-guided Buy / Sell with owner or RF wallet assets. Liquidity required.',
      playXp: 'Not active for owned Friends. Preview XP stays on the device.',
    },
    authority: 'Installing a skill grants no wallet authority. Current NFT ownership is required for care. An authorized wallet must sign transactions; the helper only reads and prepares.',
    scheduling: 'No hosted scheduler or session keys. Use your agent platform’s scheduler only when requested, with an explicit scope and signing policy.',
    rpc: 'The standalone helper uses the public RPC or your locally configured trusted RPC. The app’s /api/rpc and routing/image services are app integrations, not a public agent execution API.',
    verification: 'Source verification and tests are not an independent security audit. Reverify live state; this manifest is discovery metadata, not transaction authorization.',
  };
  await mkdir(path.join(outdir, 'agent'), { recursive: true });
  await rm(path.join(outdir, 'skills/rarepet'), { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(outdir, 'skills', file.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  await writeFile(path.join(outdir, 'skills/rarepet.zip'), zip);
  await writeFile(path.join(outdir, 'agent/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(outdir, 'llms.txt'), `# RarePet\n\n> Your Rare Friend, every day. A daily-care app for Genesis and Generations on Robinhood Chain (4663).\n\n## Start here\n\n- [RarePet agent page](${site}/agent/): Human setup, capabilities, example prompts and downloads.\n- [rarepet skill](${site}/skills/rarepet/SKILL.md): Agent entrypoint. Read it before operating RarePet.\n- [Complete skill ZIP](${site}/skills/rarepet.zip): Includes the instructions, references and zero-dependency Node.js helper.\n- [Machine-readable manifest](${site}/agent/manifest.json): Resources, file checksums, contracts and capability boundaries.\n- [Care guide](${site}/docs/): Product guide.\n- [App](${site}/): Preview, wallet care, Rare Wallet, launches, swaps and media exports.\n\n## What works\n\nThe helper reads live care and prepares unsigned Pet, Feed and Poop transactions. It never signs or broadcasts. Installing the skill grants no wallet access. Care is authorized by the current NFT owner and recorded against the collection and token ID. Read live rules, ownership and availability before every action. Unknown transaction status requires receipt recovery, not blind resubmission.\n\nLaunch, trade, transfers and fee claims use the app’s review and wallet flows. Launch is opened only through the LAUNCH action. Brain belongs to the separate launch router. Preview is local; PLAY does not yet award onchain XP to owned Friends.\n\nAgents use the public Robinhood RPC or their own trusted provider. The app’s private relay and routing/image endpoints are not a public agent execution API. No hosted agent, custody, scheduler, delegated care authority or session key is created by downloading this skill.\n`);
  return manifest;
}

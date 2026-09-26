import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

/** Verified deployment 4663.json. Read-only history policy; never a launch fallback. */
export const ARCHIVED_LAUNCH_ROUTERS = Object.freeze([Object.freeze({
  address: '0x8c46baA63079B8648b1cd5689058E0AAB33DF063' as Address,
  fromBlock: 72744001n,
  runtimeCodeHash: '0xaceed1b3c1e28af617fe78ca850a4b29c391aec09a90fd05258261637c183149' as Hex,
  quoteCount: 196,
  quoteSetHash: '0xb5a5abf6bf4a964fb0d90b2f6675d0153c2736fa567f0d42855b9231657808dd' as Hex,
})]);

export function archivedLaunchRouter(address: Address) {
  return ARCHIVED_LAUNCH_ROUTERS.find(router => router.address.toLowerCase() === address.toLowerCase());
}

export function verifyArchivedLaunchPolicy(address: Address, code: Hex, quotes: readonly Address[]) {
  const archived = archivedLaunchRouter(address);
  if (!archived || keccak256(code) !== archived.runtimeCodeHash || quotes.length !== archived.quoteCount
    || keccak256(encodeAbiParameters([{ type: 'address[]' }], [[...quotes].map(quote => quote.toLowerCase() as Address).sort()])) !== archived.quoteSetHash) {
    throw new Error('The previous launch router does not match its verified deployment.');
  }
}

export function launchHistoryRouters(current: Address): readonly Address[] {
  return [current, ...ARCHIVED_LAUNCH_ROUTERS.map(router => router.address).filter(address => address.toLowerCase() !== current.toLowerCase())];
}

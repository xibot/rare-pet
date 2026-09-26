import { isAddress, zeroAddress, type Address } from 'viem';
type CommonAuthorization = { origin: string; owner: Address; imageSha256: string; issuedAt: number; expiresAt: number };
export type LaunchImageAuthorization = Readonly<CommonAuthorization & (
  { mode: 'friend'; collection: Address; tokenId: string; wallet: Address } | { mode: 'self' }
)>;
export function launchImageMessage(value: LaunchImageAuthorization): string {
  if (value.mode !== 'friend' && value.mode !== 'self') throw new Error('Choose a valid image creator mode.');
  const url = new URL(value.origin);
  if (url.origin !== value.origin || !['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid upload origin.');
  const addresses = value.mode === 'friend' ? [value.collection, value.wallet, value.owner] : [value.owner];
  for (const address of addresses) if (!isAddress(address) || address.toLowerCase() === zeroAddress) throw new Error('Invalid upload identity.');
  if (value.mode === 'friend' && (typeof value.tokenId !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value.tokenId) || BigInt(value.tokenId) >= 2n ** 256n)) throw new Error('Invalid image authorization.');
  if (typeof value.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.imageSha256)) throw new Error('Invalid image authorization.');
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || value.issuedAt < 0 || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 300) throw new Error('Invalid upload expiry.');
  return [
    'RarePet token image upload / v2', `Origin: ${value.origin}`, 'Chain ID: 4663', `Creator mode: ${value.mode}`,
    ...(value.mode === 'friend' ? [`Collection: ${value.collection.toLowerCase()}`, `Token ID: ${value.tokenId}`, `Rare Wallet: ${value.wallet.toLowerCase()}`] : []),
    `Owner: ${value.owner.toLowerCase()}`,
    `Image SHA-256: ${value.imageSha256}`, `Issued at: ${value.issuedAt}`, `Expires at: ${value.expiresAt}`,
    'Publish this image as public token artwork. This signature does not transfer assets or approve spending.',
  ].join('\n');
}

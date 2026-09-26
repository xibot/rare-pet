import { createWalletClient, custom, isAddress, zeroAddress, type Address } from 'viem';
import { RARE_PET_CHAIN, verifyPet, type PetIdentity, type PetWalletSession } from './wallet';
import { launchImageMessage, type LaunchImageAuthorization } from './launch-upload-message';
import type { LaunchImage } from './launch-image';

function base64(bytes: Uint8Array): string {
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
type PublishedImage = Readonly<{ url: string; sha256: string }>;
function validatedImageURL(image: PublishedImage, prefix: string) {
  const url = new URL(image.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com') || url.username || url.password || url.port || url.search || url.hash
    || !/^[a-f0-9]{64}$/.test(image.sha256) || url.pathname !== `${prefix}/images/${image.sha256}.png`) throw new Error('The token image was not published for this RarePet creator.');
}
function metadataURI(value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  const uri = `data:application/json;base64,${base64(new TextEncoder().encode(json))}`;
  if (uri.length > 4096) throw new Error('Token metadata is too large. Shorten the name.');
  return uri;
}
export function tokenMetadataURI(name: string, symbol: string, image: PublishedImage, pet: PetIdentity) {
  if (!pet.walletAddress) throw new Error('This Friend needs an active Rare Wallet.');
  validatedImageURL(image, `/rare-launchpad/4663/${pet.contract.toLowerCase()}/${pet.tokenId}`);
  return metadataURI({ name, symbol, description: `Launched by ${pet.label} on Rare Launchpad.`, image: image.url, image_sha256: image.sha256, external_url: 'https://rarepet.app', creator: pet.walletAddress, creator_mode: 'friend', chain_id: 4663 });
}
export function selfTokenMetadataURI(name: string, symbol: string, image: PublishedImage, owner: Address) {
  if (!isAddress(owner) || owner.toLowerCase() === zeroAddress) throw new Error('Connect a valid creator wallet.');
  validatedImageURL(image, `/rare-launchpad/4663/self/${owner.toLowerCase()}`);
  return metadataURI({ name, symbol, description: 'Launched on Rare Launchpad.', image: image.url, image_sha256: image.sha256, external_url: 'https://rarepet.app', creator: owner, creator_mode: 'self', chain_id: 4663 });
}
type UploadContext = { session: PetWalletSession; owner: Address; revision: number; signal?: AbortSignal; assertActive?: () => void };
function uploadContext({ session, owner, revision, signal, assertActive = () => {} }: UploadContext) {
  const provider = session.getProvider();
  const check = () => {
    signal?.throwIfAborted(); assertActive();
    const snapshot = session.getSnapshot();
    if (!isAddress(owner) || owner.toLowerCase() === zeroAddress || !provider || session.getProvider() !== provider || snapshot.revision !== revision || snapshot.status !== 'connected'
      || snapshot.chainId !== 4663 || snapshot.account?.toLowerCase() !== owner.toLowerCase()) throw new Error('Your wallet or Friend changed. Open Launch again.');
  };
  check();
  return { check, client: createWalletClient({ chain: RARE_PET_CHAIN, account: owner, transport: custom(provider!) }) };
}
async function publishImage(context: ReturnType<typeof uploadContext>, authorization: LaunchImageAuthorization, image: LaunchImage, signal?: AbortSignal) {
  const { client, check } = context;
  const [chain, accounts] = await Promise.all([client.getChainId(), client.getAddresses()]); check();
  if (chain !== 4663 || accounts[0]?.toLowerCase() !== authorization.owner.toLowerCase()) throw new Error('Use the owner wallet on Robinhood Chain.');
  const signature = await client.signMessage({ account: authorization.owner, message: launchImageMessage(authorization) }); check();
  const bytes = new Uint8Array(await image.blob.arrayBuffer()); check();
  const response = await fetch('/api/launch-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...authorization, signature, image: base64(bytes) }), signal });
  check();
  const result = await response.json(); check();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The token image could not be published.');
  if (typeof result.url !== 'string' || result.sha256 !== image.sha256) throw new Error('The uploaded image did not match your selection.');
  const prefix = authorization.mode === 'friend'
    ? `/rare-launchpad/4663/${authorization.collection.toLowerCase()}/${authorization.tokenId}`
    : `/rare-launchpad/4663/self/${authorization.owner.toLowerCase()}`;
  validatedImageURL(result, prefix);
  return { url: result.url as string, sha256: image.sha256 };
}
export async function uploadLaunchImage({ session, pet, revision, image, signal, assertActive = () => {} }: {
  session: PetWalletSession; pet: PetIdentity; revision: number; image: LaunchImage; signal?: AbortSignal; assertActive?: () => void;
}) {
  if (!pet.walletAddress) throw new Error('This Friend needs an active Rare Wallet.');
  const context = uploadContext({ session, owner: pet.owner, revision, signal, assertActive });
  const fresh = await verifyPet(pet.collection, pet.tokenId, pet.owner, signal); context.check();
  if (fresh.walletAddress?.toLowerCase() !== pet.walletAddress!.toLowerCase()) throw new Error('The Friend’s wallet changed. Select it again.');
  const issuedAt = Math.floor(Date.now() / 1000);
  const authorization: LaunchImageAuthorization = { mode: 'friend', origin: location.origin, collection: pet.contract, tokenId: pet.tokenId, owner: pet.owner, wallet: pet.walletAddress!, imageSha256: image.sha256, issuedAt, expiresAt: issuedAt + 300 };
  return publishImage(context, authorization, image, signal);
}
export async function uploadSelfLaunchImage({ session, owner, revision, image, signal, assertActive }: UploadContext & { image: LaunchImage }) {
  const context = uploadContext({ session, owner, revision, signal, assertActive });
  const issuedAt = Math.floor(Date.now() / 1000);
  const authorization: LaunchImageAuthorization = { mode: 'self', origin: location.origin, owner, imageSha256: image.sha256, issuedAt, expiresAt: issuedAt + 300 };
  return publishImage(context, authorization, image, signal);
}

/** Shared public configuration integrity checks; no RPC, signer or broadcast. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getAddress, getContractAddress, isAddress, keccak256, zeroAddress } from 'viem';

export const CATALOG_PATH = new URL('../../../games/rare-pet/launch-quote-catalog.json', import.meta.url);
export const RAREFRIENDS_QUOTE = getAddress('0x0779369854d3EcdEA927206718FFD7730C67B71f');
export const USDG_QUOTE = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
export const CBBTC_QUOTE = getAddress('0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4');
export const PREVIOUS_ROUTER = getAddress('0x8c46baA63079B8648b1cd5689058E0AAB33DF063');
export function validateQuoteCatalog(catalog) {
  if (catalog?.version !== 1 || catalog.chainId !== 4663 || !Array.isArray(catalog.assets) || catalog.assets.length < 2 || catalog.assets.length > 256) throw new Error('Invalid Robinhood quote catalog.');
  const addresses = new Set(), symbols = new Set();
  let weth = 0, rarefriends = 0, usdg = 0, cbbtc = 0, stocks = 0;
  const quotes = catalog.assets.map(asset => {
    if (asset.chainId !== 4663 || asset.decimals !== (asset.kind === 'usdg' ? 6 : asset.kind === 'cbbtc' ? 8 : 18) || typeof asset.symbol !== 'string' || !asset.symbol || !isAddress(asset.address) || getAddress(asset.address) === zeroAddress) throw new Error('Invalid quote identity or decimals.');
    const address = getAddress(asset.address);
    if (addresses.has(address) || symbols.has(asset.symbol)) throw new Error('Duplicate quote identity.');
    addresses.add(address); symbols.add(asset.symbol);
    if (asset.kind === 'weth' && asset.symbol === 'WETH' && address === getAddress('0x0bd7d308f8e1639fab988df18a8011f41eacad73')) weth++;
    else if (asset.kind === 'rarefriends' && asset.id === 'rarefriends' && asset.symbol === 'RAREFRIENDS' && address === RAREFRIENDS_QUOTE) rarefriends++;
    else if (asset.kind === 'usdg' && asset.id === 'usdg' && asset.symbol === 'USDG' && address === USDG_QUOTE) usdg++;
    else if (asset.kind === 'cbbtc' && asset.id === 'cbbtc' && asset.symbol === 'cbBTC' && address === CBBTC_QUOTE) cbbtc++;
    else if (asset.kind === 'stock' && typeof asset.assetId === 'string' && asset.assetId) stocks++;
    else throw new Error('Unsupported quote kind or missing issuer asset identity.');
    return Object.freeze({ symbol: asset.symbol, address });
  });
  if (weth !== 1 || rarefriends !== 1 || usdg !== 1 || cbbtc !== 1 || stocks !== catalog.coverage?.activeStocks || quotes[0].symbol !== 'WETH' || quotes[1].address !== RAREFRIENDS_QUOTE || quotes[2].address !== USDG_QUOTE || quotes[3].address !== CBBTC_QUOTE) throw new Error('Quote catalog coverage does not match its assets.');
  return Object.freeze(quotes);
}
export function readDeploymentCatalog() {
  const raw = readFileSync(CATALOG_PATH, 'utf8'), catalog = JSON.parse(raw);
  return { quotes: validateQuoteCatalog(catalog), catalogHash: `0x${createHash('sha256').update(raw).digest('hex')}`, catalog };
}
export function rehearsalMatches(rehearsal, review) {
  return rehearsal?.status === 'READ-ONLY eth_call PASSED — no contracts deployed or transactions sent'
    && rehearsal.creationBytecodeHash === review.creationBytecodeHash
    && rehearsal.deploymentDataHash === review.deploymentDataHash
    && review.deploymentDataHash === keccak256(review.unsignedTransaction.data)
    && rehearsal.catalogHash === review.catalogHash
    && rehearsal.quoteCount === review.quotes.length
    && rehearsal.deployer?.toLowerCase() === review.config.deployer.toLowerCase()
    && rehearsal.prospectiveRouter?.toLowerCase() === review.deploymentAddressRead?.prospectiveRouter?.toLowerCase()
    && Number.isSafeInteger(rehearsal.deployerNonceAtRead)
    && rehearsal.deployerNonceAtRead === review.deploymentAddressRead?.deployerNonce
    && (!review.quotes.some(quote => quote.address.toLowerCase() === RAREFRIENDS_QUOTE.toLowerCase())
      || rehearsal.rarefriends?.quote?.toLowerCase() === RAREFRIENDS_QUOTE.toLowerCase()
        && [rehearsal.rarefriends?.friendAsset, rehearsal.rarefriends?.selfAsset].every(asset => isAddress(asset ?? '') && getAddress(asset) !== zeroAddress))
    && rehearsal.usdg?.quote?.toLowerCase() === USDG_QUOTE.toLowerCase()
    && rehearsal.usdg?.decimals === 6
    && [rehearsal.usdg?.friendAsset, rehearsal.usdg?.selfAsset].every(asset => isAddress(asset ?? '') && getAddress(asset) !== zeroAddress)
    && rehearsal.cbbtc?.quote?.toLowerCase() === CBBTC_QUOTE.toLowerCase()
    && rehearsal.cbbtc?.decimals === 8
    && [rehearsal.cbbtc?.friendAsset, rehearsal.cbbtc?.selfAsset].every(asset => isAddress(asset ?? '') && getAddress(asset) !== zeroAddress);
}

/** The reviewed nonce identifies this CREATE deployment; a changed nonce needs a fresh review. */
export function reviewedDeploymentAddress(review) {
  const nonce = review?.deploymentAddressRead?.deployerNonce;
  if (!Number.isSafeInteger(nonce) || nonce < 0 || !isAddress(review?.config?.deployer ?? '')) throw new Error('Missing reviewed deployer nonce.');
  const expected = getContractAddress({ from: review.config.deployer, nonce: BigInt(nonce) });
  if (expected.toLowerCase() !== review.deploymentAddressRead?.prospectiveRouter?.toLowerCase()) throw new Error('Reviewed deployment address does not match its deployer and nonce.');
  if (review.unsignedTransaction?.nonce !== undefined && BigInt(review.unsignedTransaction.nonce) !== BigInt(nonce)) throw new Error('Unsigned deployment nonce differs from the review.');
  return expected;
}

/** This replacement reuses the reviewed implementation; never silently accept a different predecessor. */
export function validatePreviousManifest(manifest, { sourceHash, creationBytecodeHash, treasury, totalSupply }) {
  if (manifest?.version !== 1 || manifest.chainId !== 4663 || manifest.address?.toLowerCase() !== PREVIOUS_ROUTER.toLowerCase()
    || manifest.transactionHash !== '0x0cd33c88b3f34a17299d19c47a2a96f4682420397543fbb856ddb349ba2dd57f'
    || manifest.source?.sourceHash !== sourceHash || manifest.integrity?.creationBytecodeHash !== creationBytecodeHash
    || manifest.integrity?.runtimeCodeHash !== '0xaceed1b3c1e28af617fe78ca850a4b29c391aec09a90fd05258261637c183149'
    || manifest.configuration?.treasury?.toLowerCase() !== treasury.toLowerCase() || manifest.configuration?.totalSupply !== totalSupply
    || manifest.configuration?.quoteCount !== 196 || manifest.configuration?.quotes?.length !== 196
    || manifest.configuration?.feePercent?.creator !== 85 || manifest.configuration?.feePercent?.treasury !== 10 || manifest.configuration?.feePercent?.protocol !== 5) throw new Error('The previous deployment manifest does not match the known reviewed router.');
  return manifest;
}

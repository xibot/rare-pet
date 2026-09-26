/** Shared public configuration integrity checks; no RPC, signer or broadcast. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getAddress, isAddress, keccak256, zeroAddress } from 'viem';

export const CATALOG_PATH = new URL('../../../games/rare-pet/launch-quote-catalog.json', import.meta.url);
export function validateQuoteCatalog(catalog) {
  if (catalog?.version !== 1 || catalog.chainId !== 4663 || !Array.isArray(catalog.assets) || catalog.assets.length < 2 || catalog.assets.length > 256) throw new Error('Invalid Robinhood quote catalog.');
  const addresses = new Set(), symbols = new Set();
  let weth = 0, stocks = 0;
  const quotes = catalog.assets.map(asset => {
    if (asset.chainId !== 4663 || asset.decimals !== 18 || typeof asset.symbol !== 'string' || !asset.symbol || !isAddress(asset.address) || getAddress(asset.address) === zeroAddress) throw new Error('Invalid quote identity or decimals.');
    const address = getAddress(asset.address);
    if (addresses.has(address) || symbols.has(asset.symbol)) throw new Error('Duplicate quote identity.');
    addresses.add(address); symbols.add(asset.symbol);
    if (asset.kind === 'weth' && asset.symbol === 'WETH' && address === getAddress('0x0bd7d308f8e1639fab988df18a8011f41eacad73')) weth++;
    else if (asset.kind === 'stock' && typeof asset.assetId === 'string' && asset.assetId) stocks++;
    else throw new Error('Unsupported quote kind or missing issuer asset identity.');
    return Object.freeze({ symbol: asset.symbol, address });
  });
  if (weth !== 1 || stocks !== catalog.coverage?.activeStocks || quotes[0].symbol !== 'WETH') throw new Error('Quote catalog coverage does not match its assets.');
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
    && rehearsal.deployer?.toLowerCase() === review.config.deployer.toLowerCase();
}

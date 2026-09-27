import { isAddress, zeroAddress, type Address } from 'viem';
import { LAUNCH_QUOTE_ASSETS, type LaunchQuoteAsset } from './launch-quotes.ts';
import type { RareMarketToken } from './market-catalog.ts';

type AssetDisplay = Readonly<{
  address: Address; name: string; symbol: string; decimals: number; imageUrl: string | null;
}>;
/** Ecosystem membership identifies a canonical token, not an available RarePet pool. */
export type MarketAsset = AssetDisplay & (
  | Readonly<{ source: 'ecosystem'; category: 'crypto' | 'stocks'; quoteAsset: LaunchQuoteAsset; launch?: never }>
  | Readonly<{ source: 'launch'; category: 'launch'; launch: RareMarketToken; quoteAsset?: never }>
);
export type MarketAssetCategory = 'all' | MarketAsset['category'];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const canonicalByAddress = new Map(LAUNCH_QUOTE_ASSETS.map(asset => [asset.address.toLowerCase(), asset]));
const canonicalAssets: readonly MarketAsset[] = Object.freeze(LAUNCH_QUOTE_ASSETS.map(quoteAsset => Object.freeze({
  address: quoteAsset.address, name: quoteAsset.name, symbol: quoteAsset.symbol, decimals: quoteAsset.decimals,
  imageUrl: null, source: 'ecosystem' as const, category: quoteAsset.kind === 'stock' ? 'stocks' as const : 'crypto' as const, quoteAsset,
})));

/** Merge verified launch reads with the entire canonical ecosystem directory.
 * Canonical identity wins any address collision; metadata cannot relabel a stock as a launch.
 */
export function buildMarketAssets(launches: readonly RareMarketToken[]): readonly MarketAsset[] {
  const assets = new Map(canonicalAssets.map(asset => [asset.address.toLowerCase(), asset]));
  for (const launch of launches) {
    if (!isAddress(launch.asset) || same(launch.asset, zeroAddress) || launch.decimals !== 18
      || !canonicalByAddress.has(launch.quote.address.toLowerCase())) throw new Error('Use a verified RarePet launch when building the market directory.');
    const key = launch.asset.toLowerCase();
    if (assets.has(key)) continue;
    assets.set(key, Object.freeze({ address: launch.asset, name: launch.name, symbol: launch.symbol, decimals: launch.decimals,
      imageUrl: launch.imageUrl, source: 'launch' as const, category: 'launch' as const, launch }));
  }
  return Object.freeze([...assets.values()]);
}

/** Search applies to the combined directory without inventing pools for ecosystem assets. */
export function filterMarketAssets(assets: readonly MarketAsset[], input: { query?: string; category?: MarketAssetCategory } = {}): readonly MarketAsset[] {
  const query = (input.query ?? '').trim().toLowerCase(), ticker = query.replace(/^\$/, '');
  return assets.filter(asset => (!input.category || input.category === 'all' || asset.category === input.category)
    && (!query || asset.name.toLowerCase().includes(query) || asset.symbol.toLowerCase().includes(ticker) || asset.address.toLowerCase().includes(query)));
}

/** Launches retain their verified actual pair. Ecosystem routing starts against
 * WETH, except WETH itself uses USDG. A route still needs verified onchain liquidity before trading.
 */
export function marketAssetQuote(asset: MarketAsset): LaunchQuoteAsset {
  if (!isAddress(asset.address) || same(asset.address, zeroAddress)) throw new Error('Choose a valid market asset.');
  if (asset.source === 'ecosystem') {
    const canonical = canonicalByAddress.get(asset.address.toLowerCase());
    if (!canonical || !same(canonical.address, asset.quoteAsset.address)) throw new Error('Choose an asset from the canonical ecosystem directory.');
    return LAUNCH_QUOTE_ASSETS.find(quote => quote.id === (canonical.kind === 'weth' ? 'usdg' : 'weth'))!;
  }
  if (asset.source !== 'launch' || !same(asset.address, asset.launch.asset)) throw new Error('Choose a verified RarePet launch.');
  const quote = canonicalByAddress.get(asset.launch.quote.address.toLowerCase());
  if (!quote || same(quote.address, asset.address)) throw new Error('The launch does not have a supported quote token.');
  return quote;
}

/** Contract addresses come from canonical directory/verified launch reads, never token metadata links. */
export function marketAssetSwapUrl(asset: MarketAsset, side: 'buy' | 'sell'): string {
  if (side !== 'buy' && side !== 'sell') throw new Error('Choose Buy or Sell.');
  const quote = marketAssetQuote(asset);
  const base = asset.source === 'ecosystem' ? canonicalByAddress.get(asset.address.toLowerCase())!.address : asset.launch.asset;
  const url = new URL('https://app.uniswap.org/swap');
  url.searchParams.set('chain', 'robinhood');
  url.searchParams.set('inputCurrency', side === 'buy' ? quote.address : base);
  url.searchParams.set('outputCurrency', side === 'buy' ? base : quote.address);
  return url.href;
}

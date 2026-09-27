import assert from 'node:assert/strict';
import test from 'node:test';
import { computePoolId } from '@whetstone-research/doppler-sdk/evm';
import { getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { buildMarketAssets, filterMarketAssets, marketAssetQuote, marketAssetSwapUrl, type MarketAsset } from '../games/rare-pet/market-assets.ts';
import { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset } from '../games/rare-pet/launch-quotes.ts';
import { RARE_MARKET_ROUTERS, type RareMarketToken } from '../games/rare-pet/market-catalog.ts';
import { RARE_LAUNCH_DOPPLER } from '../games/rare-pet/launch-doppler.ts';

const TOKEN = '0x6666666666666666666666666666666666666666' as Address;
function launch(quoteId = 'usdg', address = TOKEN): RareMarketToken {
  const quote = getLaunchQuoteAsset(quoteId);
  const [currency0, currency1] = [address, quote.address].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const poolKey = { currency0, currency1, fee: 3000, tickSpacing: 200, hooks: RARE_LAUNCH_DOPPLER.initializer };
  return { asset: address, name: 'Rare Cat', symbol: 'RCAT', decimals: 18, imageUrl: null, router: RARE_MARKET_ROUTERS[0].address,
    creator: '0x1111111111111111111111111111111111111111', mode: 'self', collection: null, tokenId: null,
    quote, fee: 3000, poolKey, poolId: computePoolId(poolKey), hash: `0x${'a'.repeat(64)}` as Hex, timestamp: 1800000000n, blockNumber: 73524000n };
}
const selected = (id: string) => buildMarketAssets([]).find(asset => asset.source === 'ecosystem' && asset.quoteAsset.id === id)!;

test('directory covers all 199 canonical tokens, preserving decimals and stock identities without inventing native ETH', () => {
  const assets = buildMarketAssets([]);
  assert.equal(assets.length, 199);
  assert.equal(new Set(assets.map(asset => asset.address.toLowerCase())).size, 199);
  assert.deepEqual(assets.map(asset => [asset.address, asset.name, asset.symbol, asset.decimals]),
    LAUNCH_QUOTE_ASSETS.map(asset => [asset.address, asset.name, asset.symbol, asset.decimals]));
  assert.equal(assets.filter(asset => asset.category === 'stocks').length, 195);
  assert.equal(assets.filter(asset => asset.category === 'crypto').length, 4);
  assert.equal(selected('usdg').decimals, 6); assert.equal(selected('cbbtc').decimals, 8);
  assert.equal(selected('weth').decimals, 18); assert.equal(selected('rarefriends').decimals, 18);
  assert.ok(!assets.some(asset => asset.address === zeroAddress || asset.symbol === 'ETH'));
  assert.ok(Object.isFrozen(assets)); assert.ok(assets.every(Object.isFrozen));
});

test('ecosystem rows are not labelled as verified RarePet launch pools', () => {
  for (const asset of buildMarketAssets([])) {
    assert.equal(asset.source, 'ecosystem'); assert.equal(asset.launch, undefined);
    if (asset.source === 'ecosystem') assert.equal(asset.quoteAsset.address, asset.address);
    assert.notEqual(asset.category, 'launch');
    assert.ok(!Object.hasOwn(asset, 'poolId')); assert.ok(!Object.hasOwn(asset, 'poolKey'));
  }
});

test('verified launches append once and retain their actual pool, quote, identity and image', () => {
  const original = launch();
  const assets = buildMarketAssets([original, { ...original, name: 'Duplicate cannot relabel it' }]);
  assert.equal(assets.length, 200);
  const row = assets.at(-1)!;
  assert.equal(row.source, 'launch'); assert.equal(row.category, 'launch'); assert.equal(row.address, TOKEN); assert.equal(row.name, 'Rare Cat');
  assert.equal(row.launch, original); assert.equal(row.quoteAsset, undefined);
  assert.equal(marketAssetQuote(row), getLaunchQuoteAsset('usdg'));
});

test('case-insensitive collisions preserve the canonical ecosystem identity', () => {
  const weth = getLaunchQuoteAsset('weth');
  const collision = { ...launch('usdg', weth.address.toLowerCase() as Address), name: 'Malicious rename', symbol: 'FAKE', imageUrl: 'https://evil.example/a.png' };
  const assets = buildMarketAssets([collision]);
  assert.equal(assets.length, 199);
  const row = assets.find(asset => asset.address.toLowerCase() === weth.address.toLowerCase())!;
  assert.equal(row.name, weth.name); assert.equal(row.symbol, 'WETH'); assert.equal(row.imageUrl, null); assert.equal(row.source, 'ecosystem');
  const token = getAddress(`0x${'abcd'.padEnd(40, '0')}`);
  const lower = launch('weth', token.toLowerCase() as Address);
  assert.equal(buildMarketAssets([lower, { ...lower, asset: token }]).length, 200);
});

test('search and category filters work across canonical and launch rows', () => {
  const assets = buildMarketAssets([launch()]);
  assert.equal(filterMarketAssets(assets, { category: 'all' }).length, 200);
  assert.equal(filterMarketAssets(assets, { category: 'stocks' }).length, 195);
  assert.equal(filterMarketAssets(assets, { category: 'crypto' }).length, 4);
  assert.deepEqual(filterMarketAssets(assets, { category: 'launch' }).map(asset => asset.symbol), ['RCAT']);
  assert.deepEqual(filterMarketAssets(assets, { query: ' $cbbtc ' }).map(asset => asset.symbol), ['cbBTC']);
  assert.deepEqual(filterMarketAssets(assets, { query: 'rare cat' }).map(asset => asset.symbol), ['RCAT']);
  assert.deepEqual(filterMarketAssets(assets, { query: TOKEN.toUpperCase() }).map(asset => asset.symbol), ['RCAT']);
  assert.deepEqual(filterMarketAssets(assets, { query: 'Rare Cat', category: 'stocks' }), []);
});

test('every canonical asset routes against WETH, except WETH against USDG, with both directions explicit', () => {
  for (const asset of buildMarketAssets([])) {
    const expectedQuote = getLaunchQuoteAsset(asset.symbol === 'WETH' ? 'usdg' : 'weth');
    assert.equal(marketAssetQuote(asset).address, expectedQuote.address);
    const buy = new URL(marketAssetSwapUrl(asset, 'buy')), sell = new URL(marketAssetSwapUrl(asset, 'sell'));
    assert.equal(buy.origin, 'https://app.uniswap.org'); assert.equal(buy.pathname, '/swap'); assert.equal(buy.searchParams.get('chain'), 'robinhood');
    assert.equal(buy.searchParams.get('inputCurrency'), expectedQuote.address); assert.equal(buy.searchParams.get('outputCurrency'), asset.address);
    assert.equal(sell.searchParams.get('inputCurrency'), asset.address); assert.equal(sell.searchParams.get('outputCurrency'), expectedQuote.address);
    assert.notEqual(buy.searchParams.get('inputCurrency'), buy.searchParams.get('outputCurrency'));
  }
});

test('launch URLs preserve real USDG, cbBTC, WETH and stock pairs rather than suggesting an invented WETH pool', () => {
  const stock = LAUNCH_QUOTE_ASSETS.find(asset => asset.kind === 'stock')!;
  for (const id of ['usdg', 'cbbtc', 'weth', stock.id]) {
    const row = buildMarketAssets([launch(id)]).at(-1)!;
    const url = new URL(marketAssetSwapUrl(row, 'buy'));
    assert.equal(url.searchParams.get('inputCurrency'), getLaunchQuoteAsset(id).address);
    assert.equal(url.searchParams.get('outputCurrency'), TOKEN);
  }
});

test('metadata never controls the swap domain or token targets', () => {
  const malicious = { ...launch(), name: 'https://evil.example/?inputCurrency=0xBAD', symbol: 'ETH&chain=mainnet', imageUrl: 'javascript:alert(1)' };
  const row = buildMarketAssets([malicious]).at(-1)!;
  const url = new URL(marketAssetSwapUrl(row, 'buy'));
  assert.equal(url.origin, 'https://app.uniswap.org'); assert.equal(url.searchParams.size, 3);
  assert.equal(url.searchParams.get('inputCurrency'), getLaunchQuoteAsset('usdg').address); assert.equal(url.searchParams.get('outputCurrency'), TOKEN);
  const alteredDisplay = { ...selected('cbbtc'), name: malicious.name, symbol: malicious.symbol };
  assert.equal(new URL(marketAssetSwapUrl(alteredDisplay, 'sell')).searchParams.get('inputCurrency'), getLaunchQuoteAsset('cbbtc').address);
});

test('unknown ecosystem addresses, mismatched launch identities and unsupported quote addresses cannot produce a swap link', () => {
  assert.throws(() => marketAssetSwapUrl({ ...selected('weth'), address: TOKEN }, 'buy'), /canonical ecosystem/);
  const row = buildMarketAssets([launch()]).at(-1)!;
  assert.throws(() => marketAssetSwapUrl({ ...row, address: '0x8888888888888888888888888888888888888888' }, 'buy'), /verified RarePet launch/);
  assert.throws(() => marketAssetSwapUrl({ ...row, address: zeroAddress }, 'buy'), /valid market asset/);
  assert.throws(() => marketAssetSwapUrl(row, 'other' as 'buy'), /Buy or Sell/);
  assert.throws(() => buildMarketAssets([{ ...launch(), quote: { ...getLaunchQuoteAsset('weth'), address: TOKEN } }]), /verified RarePet launch/);
  assert.throws(() => marketAssetSwapUrl({ ...row, source: 'unknown' } as unknown as MarketAsset, 'buy'), /verified RarePet launch/);
});

import { useRef, useState } from 'react';
import { LAUNCH_QUOTE_ASSETS, getLaunchQuoteAsset, type LaunchQuoteId } from './launch-quotes';

const stocks = LAUNCH_QUOTE_ASSETS.filter(asset => asset.kind === 'stock')
  .sort((a, b) => a.symbol.localeCompare(b.symbol));

export function LaunchStockPicker({ value, onChange }: { value: LaunchQuoteId; onChange: (id: LaunchQuoteId) => void }) {
  const [search, setSearch] = useState('');
  const select = useRef<HTMLSelectElement>(null);
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = stocks.filter(asset => terms.every(term => `${asset.symbol} ${asset.name}`.toLowerCase().includes(term)));
  const selected = getLaunchQuoteAsset(value);
  const selectedMatches = matches.some(asset => asset.id === value);

  return <div className="launch-stock-picker">
    <label htmlFor="launch-stock-search">FIND A STOCK OR ETF
      <input id="launch-stock-search" type="search" placeholder="Search ticker or company" value={search} autoComplete="off" spellCheck={false}
        aria-controls="launch-stock" aria-describedby="launch-stock-count"
        onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); select.current?.focus(); } }}/>
    </label>
    <div className="launch-stock-results"><span id="launch-stock-count" role="status">{terms.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : `${stocks.length} stock & ETF tokens`}</span>{search && <button type="button" onClick={() => setSearch('')}>CLEAR SEARCH ×</button>}</div>
    <label htmlFor="launch-stock">STOCK TOKEN
      <select ref={select} id="launch-stock" value={value} onChange={event => onChange(event.target.value as LaunchQuoteId)}>
        {!selectedMatches && <optgroup label="Current selection"><option value={selected.id}>{selected.symbol} — {selected.name}</option></optgroup>}
        {matches.map(asset => <option key={asset.id} value={asset.id}>{asset.symbol} — {asset.name}</option>)}
      </select>
    </label>
    {matches.length === 0 && <p className="launch-fine">No matches. Your selected pair stays {selected.symbol}. Try another ticker or company.</p>}
    <p className="launch-fine">Robinhood Chain stock & ETF tokens. Each launch requires a current, verified price.</p>
  </div>;
}

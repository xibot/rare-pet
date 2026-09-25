import { TokenCoin } from './CanonicalArt';

/** One lockup for the landing page and the playable arcade. */
export function BrandMark({ attribution = false }: { attribution?: boolean } = {}) {
  return <><svg className="brand-icon" viewBox="0 0 30 30" aria-hidden="true"><TokenCoin size={30}/></svg><span className="brand-name">RARE<span>RUSH</span>{attribution && <small>BY XIBOT</small>}</span></>;
}

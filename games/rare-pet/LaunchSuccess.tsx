import { useEffect, useId, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import { PET_DEPLOYMENT } from './wallet';
import './launch-success.css';

/** Display data supplied only after the launch receipt, ledger and liquidity are verified. */
export type LaunchSuccessData = Readonly<{
  name: string; symbol: string; asset: Address; hash: Hex; imageUrl: string | null; mode: 'friend' | 'self';
}>;

export function LaunchSuccess({ launch, onDismiss }: { launch: LaunchSuccessData; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId(), descriptionId = useId();
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false), [imageFailed, setImageFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    return () => { alive.current = false; element?.close(); };
  }, []);
  async function copyAddress() {
    try { await navigator.clipboard.writeText(launch.asset); if (alive.current) { setCopied(true); setCopyError(false); } }
    catch { if (alive.current) setCopyError(true); }
  }
  return <dialog ref={dialog} className="pet-dialog launch-success-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onDismiss(); }}
    onClick={event => { event.stopPropagation(); if (event.target === dialog.current) onDismiss(); }}>
    <div className="launch-success-top"><span><span aria-hidden="true">✓</span> LAUNCH CONFIRMED</span><button type="button" aria-label="Close launch confirmation" onClick={onDismiss}>×</button></div>
    <div className="launch-success-body">
      <div className="launch-success-art">{launch.imageUrl && !imageFailed ? <img src={launch.imageUrl} alt={`${launch.name} token artwork`} referrerPolicy="no-referrer" onError={() => setImageFailed(true)}/> : <span aria-hidden="true">✦</span>}</div>
      <h2 id={titleId} ref={heading} tabIndex={-1}>YOUR TOKEN <span>${launch.symbol}</span> WAS LAUNCHED SUCCESSFULLY!</h2>
      <p id={descriptionId}><b>{launch.name}</b> is live on Robinhood Chain.</p>
      {launch.mode === 'friend' && <p className="launch-success-brain"><span aria-hidden="true">+</span> 1 BRAIN FOR YOUR RARE FRIEND</p>}
      <div className="launch-success-contract"><span>TOKEN CONTRACT</span><code>{launch.asset}</code><button type="button" onClick={() => void copyAddress()}>{copied ? 'COPIED ✓' : 'COPY ADDRESS ⧉'}</button>{copyError && <small role="status">Copy is unavailable. Select the address above to copy it.</small>}</div>
      <div className="launch-success-links"><a href={`${PET_DEPLOYMENT.explorer}/token/${launch.asset}`} target="_blank" rel="noreferrer">VIEW TOKEN <span aria-hidden="true">↗</span></a><a href={`${PET_DEPLOYMENT.explorer}/tx/${launch.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION <span aria-hidden="true">↗</span></a></div>
      <button className="launch-success-done" type="button" onClick={onDismiss}>DONE <span aria-hidden="true">✓</span></button>
    </div>
  </dialog>;
}

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { formatUnits } from 'viem';
import type { MarketTransaction } from './market-swap';
import { PET_DEPLOYMENT } from './wallet';
import './swap-success.css';

const DISPLAY_MS = 9_000;
type Props = { transaction: MarketTransaction; onDismiss: () => void };

function exactAmount(amount: bigint, decimals: number) {
  const [whole, fraction] = formatUnits(amount, decimals).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

function ConfirmedSwap({ transaction, onDismiss }: Props) {
  const card = useRef<HTMLElement>(null), dismiss = useRef(onDismiss);
  const elapsed = useRef(0), finished = useRef(false);
  const [progress, setProgress] = useState(0);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [placement, setPlacement] = useState<CSSProperties>();
  const paused = hovered || focused || hidden;
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useLayoutEffect(() => {
    const dialog = card.current?.closest('dialog');
    if (!dialog) return;
    const heading = dialog.querySelector('.dialog-heading');
    const update = () => {
      const bounds = dialog.getBoundingClientRect();
      const headerBottom = heading?.getBoundingClientRect().bottom ?? bounds.top + 64;
      setPlacement({ top: Math.max(bounds.top + 12, headerBottom + 12),
        right: Math.max(16, window.innerWidth - bounds.right + 16),
        width: Math.min(380, Math.max(0, bounds.width - 32)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dialog);
    if (heading) observer.observe(heading);
    window.addEventListener('resize', update);
    dialog.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('resize', update); dialog.removeEventListener('scroll', update); };
  }, []);
  useEffect(() => {
    if (paused || finished.current) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      elapsed.current = Math.min(DISPLAY_MS, elapsed.current + now - previous);
      previous = now;
      setProgress(elapsed.current / DISPLAY_MS);
      if (elapsed.current >= DISPLAY_MS) {
        finished.current = true;
        window.clearInterval(timer);
        dismiss.current();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [paused]);

  const outcome = transaction.outcome!;
  return <aside ref={card} className="swap-success" style={placement} aria-label="Swap successful"
    onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <div className="swap-success-copy" role="status" aria-live="polite" aria-atomic="true">
      <strong><span aria-hidden="true">✓</span> SWAP SUCCESSFUL</strong>
      <p>Swapped <b>{exactAmount(outcome.amountIn, transaction.tokenIn.decimals)} {transaction.tokenIn.symbol}</b> for <b>{exactAmount(outcome.amountOut, transaction.tokenOut.decimals)} {transaction.tokenOut.symbol}</b>.</p>
    </div>
    <button className="swap-success-close" type="button" aria-label="Dismiss swap confirmation" onClick={onDismiss}>×</button>
    <div className="swap-success-footer"><a href={`${PET_DEPLOYMENT.explorer}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION <span aria-hidden="true">↗</span></a><span>{paused ? 'PAUSED' : 'AUTO CLOSE'}</span></div>
    <div className="swap-success-countdown" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }}/></div>
  </aside>;
}

/** A receipt-confirmed result only. Quote estimates must never appear as completed swaps. */
export function SwapSuccess(props: Props) {
  const { transaction } = props;
  if (transaction.kind !== 'swap' || transaction.status !== 'confirmed' || !transaction.hash || !transaction.outcome) return null;
  return <ConfirmedSwap key={transaction.requestId} {...props}/>;
}

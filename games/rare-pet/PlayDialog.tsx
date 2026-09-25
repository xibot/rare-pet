import { useEffect, useId, useRef, type ReactNode } from 'react';
import './play-dialog.css';

/** A content-sized arcade cabinet keeps the world's pixels in their original proportions. */
export function PlayDialog({ title, summary, children, close }: { title: string; summary: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(), summaryId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className="pet-play-dialog" aria-labelledby={titleId} aria-describedby={summaryId}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === dialog.current) close(); }}>
    <header className="pet-play-heading"><h2 id={titleId}>{title}</h2><p id={summaryId}>{summary}</p><button type="button" aria-label="Close Rare Rush" onClick={close} autoFocus>×</button></header>
    <div className="pet-play-cabinet"><div className="pet-rush">{children}</div></div>
  </dialog>;
}

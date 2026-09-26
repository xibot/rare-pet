import { useEffect, useRef, useState } from 'react';
import { Icon } from './art';
import { renderShareImage, type ShareAction, type ShareFriend } from './share-image';
import type { Island } from './islands';
import './share.css';

export function XIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933ZM17.61 20.644h2.039L6.486 3.24H4.298L17.61 20.644Z"/></svg>;
}
const moments: { action: ShareAction; name: string }[] = [{ action: 'pet', name: 'Pet' }, { action: 'feed', name: 'Feed' }, { action: 'poop', name: 'Poop' }];
function postText(label: string, action: ShareAction) {
  const line = { pet: `A little love for ${label}.`, feed: `Rare food. Good mood. Snack time with ${label}.`, poop: `${label} is feeling lighter. Staying rare.` }[action];
  return `${line}\n\nEvery Rare Friend is a Rare Pet.\nTake care. Play. Stay rare.`;
}

export function ShareDialog({ friend, island, bodyId, initialAction, initialVariant, close }: {
  friend: ShareFriend; island: Island; bodyId: string; initialAction: ShareAction; initialVariant: number; close: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState(initialAction);
  const [variant, setVariant] = useState(initialVariant);
  const [post, setPost] = useState(() => postText(friend.label, initialAction));
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [retry, setRetry] = useState(0);
  const key = `${friend.collection}:${friend.tokenId}:${island}:${bodyId}:${action}:${variant}:${retry}`;
  const ready = image?.key === key ? image : null;
  const filename = `rarepet-${friend.collection}-${friend.tokenId}-${island}-${action}-2000.png`;
  const intent = `https://x.com/intent/tweet?${new URLSearchParams({ text: post, url: 'https://rarepet.app' })}`;
  useEffect(() => {
    const dialog = dialogRef.current!; dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let active = true, url: string | undefined;
    setError(''); setStatus('');
    renderShareImage({ friend, island, bodyId, action, variant }).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob); setImage({ key, url });
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Your image could not be prepared. Try again.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [friend, island, bodyId, action, variant, retry, key]);
  function choose(next: ShareAction) { setAction(next); setPost(postText(friend.label, next)); }
  function download() {
    if (!ready) return;
    const link = document.createElement('a'); link.href = ready.url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setStatus('Image downloaded. Add it to your post on X.');
  }
  return <dialog ref={dialogRef} className="pet-dialog share-dialog" aria-labelledby="share-heading" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialogRef.current) close(); }}>
    <div className="dialog-heading"><h2 id="share-heading">A moment worth sharing.</h2><button aria-label="Close sharing" onClick={close}>×</button></div>
    <div className="share-content">
      <div className="share-moments" role="group" aria-label="Image action">{moments.map(moment => <button key={moment.action} aria-pressed={action === moment.action} onClick={() => choose(moment.action)}><Icon name={moment.action}/>{moment.name}</button>)}</div>
      <div className="share-image" aria-busy={!ready && !error}>{ready ? <img src={ready.url} alt={`${friend.label} on the ${island} island, ${action === 'pet' ? 'receiving love' : action === 'feed' ? 'enjoying a meal' : 'taking a healthy break'}, with a speech bubble.`} width="2000" height="2000"/> : <p role="status">{error ? 'Let’s try that again.' : 'Making your rare moment…'}</p>}</div>
      <div className="share-image-meta"><span>2000 × 2000 PNG</span><button onClick={() => setVariant(value => (value + 1) % 3)}>ANOTHER POSE <span aria-hidden="true">↻</span></button></div>
      {error && <div className="share-error" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>TRY AGAIN</button></div>}
      <label className="share-caption">YOUR POST<textarea value={post} onChange={event => setPost(event.target.value)} maxLength={230} rows={3}/></label>
      <div className="share-buttons"><button className="share-download" disabled={!ready} onClick={download}>DOWNLOAD PNG <span aria-hidden="true">↓</span></button>{ready ? <a href={intent} target="_blank" rel="noopener noreferrer" className="share-x" onClick={download}><XIcon/> DOWNLOAD + SHARE ON X</a> : <button className="share-x" disabled><XIcon/> DOWNLOAD + SHARE ON X</button>}</div>
      <p className="share-hint" role="status">{status || 'Pick a moment. Download the image, then attach it to your post on X.'}</p>
    </div>
  </dialog>;
}

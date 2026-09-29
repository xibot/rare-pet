export type ShareAction = 'pet' | 'feed' | 'play' | 'launch' | 'poop' | 'talk';

export const SHARE_SPEECH: Readonly<Record<ShareAction, string>> = {
  pet: '♡ right back at you.', feed: 'rare food. good mood.',
  play: 'one more rare run?', launch: '3, 2, 1… liftoff!', poop: 'ahh. much better.',
  talk: 'gm, let’s talk rare.',
};
export const SHARE_SPEECH_MAX_LENGTH = Math.max(...Object.values(SHARE_SPEECH).map(text => Array.from(text).length));

/** Single-line text, limited without splitting an emoji's surrogate pair. */
export function limitShareSpeech(text: string): string {
  return Array.from(text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')).slice(0, SHARE_SPEECH_MAX_LENGTH).join('');
}

export function resolveShareSpeech(action: ShareAction, custom?: string): string {
  return limitShareSpeech(custom ?? '').trim() || SHARE_SPEECH[action];
}

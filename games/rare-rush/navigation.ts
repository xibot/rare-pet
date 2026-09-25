export type ArcadeDestination = 'home' | 'friends';

/** Fixed site destinations only: the game cannot provide a URL to its host. */
export function parseArcadeNavigation(value: unknown): ArcadeDestination | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  return message.type === 'rarerush:navigate' && (message.destination === 'home' || message.destination === 'friends')
    ? message.destination : null;
}

/** Ask the trusted outer host to navigate; the iframe keeps its original sandbox. */
export function requestArcadeNavigation(destination: ArcadeDestination): void {
  if (window.parent === window) return;
  // The SDK's classic-script bundle runs in an opaque-origin iframe. This carries
  // no private data; the host checks the exact active frame and fixed destination.
  window.parent.postMessage({ type: 'rarerush:navigate', destination }, '*');
}

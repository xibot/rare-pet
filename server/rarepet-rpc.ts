/** Server-only configuration. Never include this module or its values in a browser bundle. */
export function getPrivateRpcUrl(environment: { RAREPET_RPC_URL?: string; RAREPET_SNAPSHOT_RPC_URL?: string } = process.env): string {
  const value = environment.RAREPET_RPC_URL?.trim() || environment.RAREPET_SNAPSHOT_RPC_URL?.trim();
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch {
    // Configuration errors must never contain the private endpoint or provider credentials.
    throw new Error('Private RPC is not configured correctly.');
  }
}

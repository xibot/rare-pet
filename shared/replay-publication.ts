import { keccak256, toHex, type Address, type Hex } from 'viem';

export const PUBLIC_RUNS_SITE = 'https://rarerush.app';
export const PUBLICATION_TTL_SECONDS = 300;
export type PublicRunActor = 'human' | 'autopilot' | 'agentic';
export type PublicReplay = {
  version: 'rare-rush-agent-local-v1'; finalTick: number;
  inputs: { version: 'rare-rush-input-v2'; frames: { tick: number; jump: boolean; slide: boolean; pace: -1 | 0 | 1 }[] };
};
export type PublicRunArt = {
  collection: 0 | 1; tokenId: string; owner: Address; chainId: 4663; blockNumber?: string;
  label: string; portraitUrl?: string; bodyId?: string;
  sprites?: { familyId: number; seed: number; frames: string[] };
};
export type ReplayPublication = {
  source: 'arcade' | 'testnet'; collection: 0 | 1; tokenId: string;
  difficulty: 'easy' | 'normal' | 'degen'; seed: string; replay: PublicReplay; player: Address;
  actor: PublicRunActor; runId?: string; art?: PublicRunArt;
};
export type PublicRunPayload = ReplayPublication;
export type PublicationAuthorization = { expiresAt: string; signature: Hex };
export type AuthorizedReplayPublication = ReplayPublication & { authorization: PublicationAuthorization };

/** A stable JSON digest binds every published field, including saved artwork.
 * It does not include authorization, so retries retain the same content identity.
 */
function canonical(value: unknown, depth = 0): string {
  if (depth > 12) throw new Error('Replay publication is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`).join(',')}}`;
  throw new Error('Replay publication must contain JSON values.');
}

export function publicationPayloadHash(payload: ReplayPublication): Hex {
  const { authorization: _authorization, ...unsigned } = payload as ReplayPublication & { authorization?: unknown };
  return keccak256(toHex(canonical(unsigned)));
}

export function publicationTypedData(payload: ReplayPublication, expiresAt: string | number | bigint) {
  const expiry = String(expiresAt);
  if (!/^[1-9][0-9]{0,11}$/.test(expiry)) throw new Error('Invalid publication expiry.');
  return {
    domain: { name: 'RareRushPublicReplay', version: '1', chainId: payload.source === 'arcade' ? 4663 : 46630 },
    types: { PublishReplay: [
      { name: 'player', type: 'address' }, { name: 'payloadHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint256' }, { name: 'site', type: 'string' },
    ] },
    primaryType: 'PublishReplay' as const,
    message: { player: payload.player, payloadHash: publicationPayloadHash(payload), expiresAt: BigInt(expiry), site: PUBLIC_RUNS_SITE },
  } as const;
}

/** Pass typedData to wallet.signTypedData, then POST {...payload,
 * authorization:{expiresAt,signature}}. This authorizes public publication only.
 */
export function prepareReplayPublication(payload: ReplayPublication, now = Date.now()) {
  const expiresAt = String(Math.floor(now / 1000) + PUBLICATION_TTL_SECONDS);
  return { expiresAt, typedData: publicationTypedData(payload, expiresAt) };
}

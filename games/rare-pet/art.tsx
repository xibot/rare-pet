import { decodeGenerationSprites, spriteFrame, type GenerationSpriteManifest, type GenerationSprites } from '@rarefriends/friendsdk/sprites';
import cachedArt from '../rare-rush/landing/preview-art.json';
import cachedGenesis from './preview-genesis.json';
import { TokenCoin } from '../rare-rush/CanonicalArt';
import { GenesisRunnerSprite, type GenesisRunnerSpriteProps } from '../rare-rush/genesis/GenesisRunnerSprite';

export { GENESIS_BODIES, DEFAULT_BODY_ID, pickGenesisBody } from '../rare-rush/genesis/bodies';

type PreviewIdentity = Readonly<{ tokenId: string; label: string; image: string }>;
export type PreviewFriend = PreviewIdentity & (
  | Readonly<{ collection: 'generations'; sprites: GenerationSprites }>
  | Readonly<{ collection: 'genesis' }>
);

const generationPreviews: PreviewFriend[] = cachedArt.friends.map(friend => {
  const sprites = decodeGenerationSprites(BigInt(friend.tokenId), friend.familyId, friend.seed, friend.frames.map(BigInt), cachedArt.provenance.manifest as GenerationSpriteManifest);
  const rows = spriteFrame(sprites, 'down', false, 0).frame.rows;
  const paths = rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '#' ? [`M${x} ${y}h1v1h-1z`] : [])).join('');
  return { collection: 'generations', tokenId: friend.tokenId, label: `${friend.familyName} #${friend.tokenId}`, sprites,
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path d="${paths}" fill="black"/></svg>`)}` };
});

/** Public artwork samples only; these entries never confer ownership or care permission. */
export const previewFriends: readonly PreviewFriend[] = Object.freeze([
  ...generationPreviews,
  ...cachedGenesis.friends.map(friend => Object.freeze({ collection: 'genesis' as const,
    tokenId: friend.tokenId, label: friend.label, image: friend.image })),
]);

export function PetSprite({ sprites, frame, walking = false, direction = 'down' }: {
  sprites: GenerationSprites; frame: number; walking?: boolean; direction?: 'down' | 'up' | 'left' | 'right';
}) {
  const rows = spriteFrame(sprites, direction, walking, frame % 8).frame.rows;
  const paths = rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '#' ? [`M${x} ${y}h1v1h-1z`] : [])).join('');
  return <svg className="pet-portrait" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-label="Your Rare Friend"><path d={paths}/></svg>;
}
export function GenesisPetSprite(props: GenesisRunnerSpriteProps) {
  return <svg className="pet-portrait pet-portrait-genesis" viewBox="0 0 16 16" shapeRendering="crispEdges" role="img" aria-label="Your Genesis Rare Friend">
    <GenesisRunnerSprite {...props}/>
  </svg>;
}
export function PetBrand() { return <><svg className="brand-icon" viewBox="0 0 30 30" aria-hidden="true"><TokenCoin size={30}/></svg><span className="brand-name">RARE<span>PET</span></span></>; }
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    pet: 'M4 5h4v2h2V5h4v2h2v5h-2v2h-2v2H8v-2H6v-2H4V7H2V5z',
    feed: 'M2 9h16v3h-2v3h-3v2H7v-2H4v-3H2zM6 2v4M10 1v5M14 2v4',
    play: 'M3 5h14v2h2v9h-4v-3H5v3H1V7h2zM6 7v5M4 9h4M13 8h1M16 10h1',
    launch: 'M10 1l5 5v6h-3v5l-2-2-2 2v-5H5V6zM4 9H2v5h3M16 9h2v5h-3M9 6h2v2H9z',
    poop: 'M10 2v3h3v3h2v3h2v2h2v4H1v-4h2v-2h2V8h3V5zM6 12h1M13 12h1',
    arrow: 'M4 10h12M11 5l5 5-5 5',
  };
  return <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="miter" aria-hidden="true"><path d={paths[name] || paths.pet}/></svg>;
}

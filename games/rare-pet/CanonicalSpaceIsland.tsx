import { getWorldPreset, project, renderWorld } from '@rarefriends/friendsdk/world';

/** Official FriendSDK complete scenes, also used by Rare Rush's WorldArt.
 * Only the outer viewport is cropped; each embedded SDK export is unchanged. */
const scenes = [
  { id: '01-garden-oval-complete', crop: [329, 451, 931, 415], petAnchor: [372, 280] },
  { id: '02-circuit-courtyard-complete', crop: [225, 421, 1150, 488], petAnchor: [404, 308] },
  { id: '03-crystal-mesa-complete', crop: [288, 386, 1003, 502], petAnchor: [356, 268] },
  { id: '04-rooftop-terrace-complete', crop: [163, 404, 1274, 422], petAnchor: [224, 128] },
  { id: '05-tidal-islands-complete', crop: [381, 451, 942, 390], petAnchor: [216, 120] },
  { id: '06-orbital-hex-complete', crop: [462, 399, 824, 434], petAnchor: [412, 152] },
] as const;

export const SPACE_ISLAND_ART = scenes.map(({ id, crop, petAnchor }) => {
  const world = getWorldPreset(id);
  const [petX, petY] = project(petAnchor[0], petAnchor[1]);
  return Object.freeze({
    id, crop,
    // Reserve the canonical one-pixel halo on both sides of the 16px pet.
    petMaxWidth: `${2 * Math.min(petX - crop[0], crop[0] + crop[2] - petX) / crop[2] / 1.125 * 100}%`,
    petX: `${(petX - crop[0]) / crop[2] * 100}%`, petY: `${(petY - crop[1]) / crop[3] * 100}%`, aspectRatio: `${crop[2]} / ${crop[3]}`,
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderWorld(world))}`,
  });
});

export function CanonicalSpaceIsland({ scene }: { scene: (typeof SPACE_ISLAND_ART)[number] }) {
  return <svg className="space-island-floor" viewBox={scene.crop.join(' ')} aria-hidden="true" focusable="false" data-world-preset={scene.id}>
    <image href={scene.image} x="0" y="0" width="1600" height="1200" preserveAspectRatio="xMidYMid meet"/>
  </svg>;
}

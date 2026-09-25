import { getWorldPreset, project, renderWorld } from '@rarefriends/friendsdk/world';

/** Official FriendSDK complete scenes, also used by Rare Rush's WorldArt.
 * Only the outer viewport is cropped; each embedded SDK export is unchanged. */
const scenes = [
  { id: '01-garden-oval-complete', crop: [329, 451, 931, 415], anchor: [344, 168] },
  { id: '02-circuit-courtyard-complete', crop: [225, 421, 1150, 488], anchor: [346, 75] },
  { id: '03-crystal-mesa-complete', crop: [288, 386, 1003, 502], anchor: [286, 262] },
  { id: '04-rooftop-terrace-complete', crop: [163, 404, 1274, 422], anchor: [315, 120] },
  { id: '05-tidal-islands-complete', crop: [381, 451, 942, 390], anchor: [206, 104] },
  { id: '06-orbital-hex-complete', crop: [462, 399, 824, 434], anchor: [224, 82] },
] as const;

export const SPACE_ISLAND_ART = scenes.map(({ id, crop, anchor }) => {
  const world = getWorldPreset(id);
  const [x, y] = project(anchor[0], anchor[1]);
  return Object.freeze({
    id, crop, aspectRatio: `${crop[2]} / ${crop[3]}`,
    riderX: `${(x - crop[0]) / crop[2] * 100}%`,
    riderY: `${(y - crop[1]) / crop[3] * 100}%`,
    riderSize: `${170 / crop[2] * 100}%`,
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderWorld(world))}`,
  });
});

export function CanonicalSpaceIsland({ scene }: { scene: (typeof SPACE_ISLAND_ART)[number] }) {
  return <svg className="space-island-floor" viewBox={scene.crop.join(' ')} aria-hidden="true" focusable="false" data-world-preset={scene.id}>
    <image href={scene.image} x="0" y="0" width="1600" height="1200" preserveAspectRatio="xMidYMid meet"/>
  </svg>;
}

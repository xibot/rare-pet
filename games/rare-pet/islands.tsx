import type { CSSProperties } from 'react';
import { CanonicalSpaceIsland, SPACE_ISLAND_ART } from './CanonicalSpaceIsland';
import { ClassicIslandArt } from './ClassicIslandArt';
import { FloatingIslandArt } from './FloatingIslandArt';

export const islandFamilies = [
  { id: 'worlds', name: 'Worlds' },
  { id: 'classic', name: 'Classic' },
  { id: 'floating', name: 'Floating' },
] as const;
export type IslandFamily = (typeof islandFamilies)[number]['id'];
const classicNames = [
  { id: 'meadow', name: 'Meadow' }, { id: 'moon', name: 'Moon' },
  { id: 'arcade', name: 'Arcade' }, { id: 'beach', name: 'Beach' }, { id: 'rare', name: 'Rare' },
] as const;

const worlds = [
  { id: 'garden', name: 'Garden', scene: SPACE_ISLAND_ART[0] },
  { id: 'circuit', name: 'Circuit', scene: SPACE_ISLAND_ART[1] },
  { id: 'crystal', name: 'Crystal', scene: SPACE_ISLAND_ART[2] },
  { id: 'rooftop', name: 'Rooftop', scene: SPACE_ISLAND_ART[3] },
  { id: 'tidal', name: 'Tidal', scene: SPACE_ISLAND_ART[4] },
  { id: 'orbital', name: 'Orbital', scene: SPACE_ISLAND_ART[5] },
] as const;

export const islandOptions = [
  ...worlds.map(world => ({ ...world, family: 'worlds' as const,
    aspectRatio: world.scene.aspectRatio, petX: world.scene.petX, petY: world.scene.petY,
    maxPetRatio: parseFloat(world.scene.petMaxWidth) / 100, petRatio: .38, maxWidth: 620 })),
  ...classicNames.map(art => ({ ...art, family: 'classic' as const, art: art.id,
    aspectRatio: '320 / 104', petX: '50%', petY: `${59 / 104 * 100}%`,
    maxPetRatio: 1 / 1.125, petRatio: .49, maxWidth: 480 })),
  ...classicNames.map(art => ({ ...art, id: `floating-${art.id}` as const, family: 'floating' as const, art: art.id,
    aspectRatio: '80 / 40', petX: '50%', petY: '47.5%',
    maxPetRatio: 1 / 1.125, petRatio: .49, maxWidth: 480 })),
] as const;
export type IslandOption = (typeof islandOptions)[number];
export type Island = IslandOption['id'];
export type Background = 'all' | 'match' | IslandFamily | Island;
export function isIsland(value: unknown): value is Island { return islandOptions.some(island => island.id === value); }
export function restoreIsland(value: string): Island { return isIsland(value) ? value : 'garden'; }
export function restoreBackground(value: string): Background {
  return value === 'all' || value === 'match' || islandFamilies.some(family => family.id === value) || isIsland(value) ? value as Background : 'all';
}
export function getIsland(island: Island): IslandOption { return islandOptions.find(option => option.id === island)!; }
export function backgroundOptions(background: Background, mainIsland: Island): readonly IslandOption[] {
  if (background === 'all') return islandOptions;
  if (background === 'match') return [getIsland(mainIsland)];
  if (isIsland(background)) return [getIsland(background)];
  return islandOptions.filter(option => option.family === background);
}

/** Match the main pet's responsive 16px sprite/island ratio in every flyby. */
export function islandPetRatio(option: IslandOption, stageWidth: number): number {
  const mainWidth = Math.min((stageWidth || 660) * .94, option.maxWidth);
  return Math.min(Math.max(128, mainWidth * option.petRatio), 235, mainWidth * option.maxPetRatio) / mainWidth;
}
export function islandStyle(option: IslandOption, stageWidth: number): CSSProperties {
  return {
    aspectRatio: option.aspectRatio,
    '--pet-ground-x': option.petX,
    '--pet-ground-y': option.petY,
    '--pet-size': `${islandPetRatio(option, stageWidth) * 100}%`,
    '--island-max-width': `${option.maxWidth}px`,
  } as CSSProperties;
}
export function IslandArt({ option }: { option: IslandOption }) {
  if (option.family === 'worlds') return <CanonicalSpaceIsland scene={option.scene}/>;
  if (option.family === 'classic') return <ClassicIslandArt island={option.art}/>;
  return <FloatingIslandArt island={option.art}/>;
}

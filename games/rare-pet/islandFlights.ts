import { islandPetRatio, type IslandOption } from './islands';

const ISLAND_SPEED = 1.5;

export type IslandFlight = Readonly<{
  slot: number; width: number; top: number; start: number; travel: number;
  rest: number; duration: number; delay: number; depth: 'far' | 'middle' | 'near';
  direction: 'left' | 'right';
}>;

/** Include the 16px Friend and its one-pixel halo in every reserved rectangle. */
function footprint(option: IslandOption, width: number, ratio: number) {
  const [aspectWidth, aspectHeight] = option.aspectRatio.split('/').map(Number);
  const height = width * aspectHeight / aspectWidth;
  const pet = width * ratio;
  const ground = height * parseFloat(option.petY) / 100;
  const top = Math.min(0, ground - pet * 17 / 16);
  const bottom = Math.max(height, ground + pet / 16);
  return { height, pet, ground, top, span: bottom - top };
}

/** Separate rows and evenly spaced visitors can cross behind home without colliding. */
export function islandFlights(option: IslandOption, measuredWidth: number, measuredHeight: number) {
  const width = measuredWidth || 660;
  const compact = width < 500;
  const classic = option.family === 'classic';
  const ratio = islandPetRatio(option, width);
  const mainWidth = Math.min(width * .94, option.maxWidth);
  const main = footprint(option, mainWidth, ratio);
  // Keep the existing stage proportions around the main pet and its speech bubble.
  const mainTop = Math.min(0, main.ground - main.pet - 56, main.ground - main.pet * 17 / 16 - 30);
  const mainSpan = main.height - mainTop;
  const bottomInset = 38; // Preserve stage height while the foreground moves up five pixels.
  const skyWidth = (classic ? 52 : 84) * (compact ? .7 : 1);
  const sky = footprint(option, skyWidth, ratio);
  const skyTop = 84;
  const skyBottom = skyTop + sky.span;
  const minHeight = Math.ceil(skyBottom + 24 + mainSpan + bottomInset);
  const height = Math.max(measuredHeight, minHeight);
  const rows = [
    { slots: [0], sizes: [classic ? 52 : 84], duration: 38, phase: 13 / 38, depth: 'far', direction: 'right' },
    { slots: [1, 2], sizes: classic ? [112, 104] : [180, 168], duration: 26, phase: .3, depth: 'near', direction: 'right' },
    { slots: [3, 4], sizes: classic ? [76, 72] : [122, 116], duration: 34, phase: .15, depth: 'middle', direction: 'left' },
  ] as const;
  const rowGap = 20;
  const preferredScale = compact ? .7 : 1;
  const preferredWidths = rows.map(row => row.sizes.map(size => Math.min(size * preferredScale, width)));
  const preferredSpan = preferredWidths.reduce((sum, sizes) => sum + footprint(option, Math.max(...sizes), ratio).span, 0);
  const scale = Math.min(1, (height - skyTop - 16 - rowGap * (rows.length - 1)) / preferredSpan);
  const spareHeight = height - skyTop - 16 - rowGap * (rows.length - 1) - preferredSpan * scale;
  const flights: IslandFlight[] = [];
  let rowTop = skyTop;
  rows.forEach((row, rowIndex) => {
    const sizes = preferredWidths[rowIndex].map(size => size * scale);
    const largest = Math.max(...sizes);
    const span = footprint(option, largest, ratio).span;
    const start = row.direction === 'right' ? -largest - 16 : width + 16;
    const travel = (width + largest + 32) * (row.direction === 'right' ? 1 : -1);
    const duration = row.duration / ISLAND_SPEED;
    row.slots.forEach((slot, index) => {
      const box = footprint(option, sizes[index], ratio);
      flights.push({
        slot, width: sizes[index], top: rowTop + (span - box.span) / 2 - box.top,
        start, travel, rest: row.slots.length === 1 ? (width - sizes[index]) * .35 : start + travel * (.25 + index / 2),
        // Shared travel and timing keep paired visitors half a circuit apart, including at wrap.
        duration, delay: -duration * (row.phase + index / row.slots.length),
        depth: row.depth, direction: row.direction,
      });
    });
    rowTop += span + rowGap + spareHeight / (rows.length - 1);
  });
  return { minHeight, flights };
}

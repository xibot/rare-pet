import { islandPetRatio, type IslandOption } from './islands';

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

/** Disjoint sky/side corridors keep whole island + Friend compositions apart. */
export function islandFlights(option: IslandOption, measuredWidth: number, measuredHeight: number) {
  const width = measuredWidth || 660;
  const compact = width < 500;
  const classic = option.family === 'classic';
  const ratio = islandPetRatio(option, width);
  const mainWidth = Math.min(width * .94, option.maxWidth);
  const main = footprint(option, mainWidth, ratio);
  // Reserve the speech bubble, idle bob, halo and the largest action hop.
  const mainTop = Math.min(0, main.ground - main.pet - 56, main.ground - main.pet * 17 / 16 - 30);
  const mainSpan = main.height - mainTop;
  const bottomInset = 38; // Also covers the smaller 24px desktop inset.
  const skyWidth = (classic ? 52 : 84) * (compact ? .7 : 1);
  const sky = footprint(option, skyWidth, ratio);
  const skyTop = 84;
  const skyBottom = skyTop + sky.span;
  const minHeight = Math.ceil(skyBottom + 24 + mainSpan + bottomInset);
  const height = Math.max(measuredHeight, minHeight);
  const flights: IslandFlight[] = [{
    slot: 0, width: skyWidth, top: skyTop - sky.top,
    start: -skyWidth - 16, travel: width + skyWidth + 32,
    rest: (width - skyWidth) * .35, duration: 38, delay: -13, depth: 'far', direction: 'right',
  }];
  const mainLeft = (width - mainWidth) / 2;
  // Main artwork stays inside its frame; leave another 24px for action movement.
  const sideWidth = mainLeft - 40;
  if (sideWidth >= (classic ? 46 : 84)) {
    for (const side of ['left', 'right'] as const) {
      const sizes = classic ? (side === 'left' ? [112, 76] : [104, 72]) : (side === 'left' ? [180, 122] : [168, 116]);
      const boxes = sizes.map(size => {
        const actual = Math.min(size, sideWidth);
        return { width: actual, ...footprint(option, actual, ratio) };
      });
      const packHeight = boxes[0].span + 20 + boxes[1].span;
      let rowTop = height - bottomInset - mainSpan + Math.max(0, (mainSpan - packHeight) / 2);
      boxes.forEach((box, row) => {
        const start = side === 'left' ? -box.width - 16 : width + 16;
        const end = side === 'left' ? mainLeft - 24 - box.width : width - mainLeft + 24;
        const duration = row ? 34 : 26;
        flights.push({
          slot: (side === 'left' ? 1 : 2) + row * 2, width: box.width,
          top: rowTop - box.top, start, travel: end - start, rest: end,
          duration, delay: -duration * (side === 'left' ? .75 : .85),
          depth: row ? 'middle' : 'near', direction: side === 'left' ? 'right' : 'left',
        });
        rowTop += box.span + 20;
      });
    }
  }
  return { minHeight, flights };
}

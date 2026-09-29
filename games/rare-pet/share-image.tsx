import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import type { GenerationSprites } from '@rarefriends/friendsdk/sprites';
import { PetSprite, GenesisPetSprite } from './art';
import { Heart, Snack, Spark } from './habitat';
import { getIsland, IslandArt, islandPetRatio, type Island } from './islands';
import { resolveShareSpeech, type ShareAction } from './share-message';

export type { ShareAction } from './share-message';
/** Both the public preview and verified wallet identity are accepted unchanged. */
export type ShareFriend = Readonly<{
  collection: 'genesis' | 'generations'; tokenId: string; label: string;
  image: string; sprites?: GenerationSprites;
}>;
export type ShareImageOptions = Readonly<{
  friend: ShareFriend; island: Island; bodyId?: string; action: ShareAction; variant?: number; speech?: string;
}>;
export const SHARE_IMAGE_SIZE = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';

function Glyph({ x, y, size, color, children }: {
  x: number; y: number; size: number; color?: string; children: ReactNode;
}) {
  return <svg x={x} y={y} width={size} height={size} overflow="visible" color={color} data-share-slot="glyph">{children}</svg>;
}

/** A still from the same care reactions; canonical Friend pixels are never edited. */
function Reaction({ action, variant, size, phase }: { action: ShareAction; variant: number; size: number; phase?: number }) {
  if (action === 'talk') return null;
  const wave = (offset = 0) => phase === undefined ? 0 : Math.sin(phase * Math.PI * 2 + offset);
  if (action === 'pet') {
    const color = ['#d46d7b', '#ab82c8', '#899f27'][variant];
    return <g>{[[-.06, .23, .12], [.93, .38, .085], [.82, .04, .12], [.1, .54, .075], [.38, -.11, .09]].map(([x, y, s], index) =>
      <Glyph key={index} x={size * (x + wave(index) * .012)} y={size * (y + wave(index * .8) * .06)} size={size * s * (1 + wave(index) * .12)} color={color}><Heart/></Glyph>)}</g>;
  }
  if (action === 'feed') return <g>
    <Glyph x={size * (.73 - wave() * .05)} y={size * (.53 + wave() * .06)} size={size * .25}><Snack variant={variant}/></Glyph>
    <svg x={size * .64} y={size * .95} width={size * .32} height={size * .17} viewBox="0 0 30 16" shapeRendering="crispEdges">
      <path d="M0 2H30V6H27V10H24V14H6V10H3V6H0Z" fill="#191f16"/><path d="M3 3H27V6H24V9H6V6H3Z" fill="#ccff00"/><path d="M9 14H21V16H9Z" fill="#191f16"/>
    </svg>
    {[0, 1, 2, 3].map(i => <rect key={i} x={size * (.71 + (i % 2) * .09 + wave(i) * .02)} y={size * (.76 + i * .055 + wave(i) * .035)} width={size * .025} height={size * .025} opacity={phase === undefined ? 1 : .6 + wave(i) * .4} fill="#ac8153"/>)}
  </g>;
  if (action === 'play') {
    const [x, y, tilt] = [[.8, .6, -8], [-.15, .52, 9], [.78, .38, -5]][variant];
    return <g data-share-reaction="play">
      <g transform={`translate(${size * (x + wave() * .016)} ${size * (y + wave() * .04)}) rotate(${tilt + wave() * 4} ${size * .17} ${size * .12})`}>
        <svg width={size * .34} height={size * .255} viewBox="0 0 32 24" shapeRendering="crispEdges">
          <path d="M6 3H26V5H29V8H31V21H23V18H9V21H1V8H3V5H6Z" fill="#fff"/>
          <path d="M7 6H25V8H28V18H25V15H7V18H4V9H7Z" fill="#10110e"/>
          <path d="M8 8H11V11H14V14H11V17H8V14H5V11H8Z" fill="#ccff00"/>
          <rect x="21" y="8" width="3" height="3" fill="#ccff00" opacity={phase === undefined ? 1 : .65 + wave() * .35}/>
          <rect x="25" y="12" width="3" height="3" fill="#ccff00" opacity={phase === undefined ? 1 : .65 - wave() * .35}/>
          <path d="M15 13H18V15H15Z" fill="#fff"/>
        </svg>
      </g>
      {[[-.1, .16, .095], [.86, -.06, .085], [1.05, .3, .065], [.06, .7, .075], [.57, -.16, .065]].map(([x, y, s], index) =>
        <Glyph key={index} x={size * (x + wave(index + variant) * .025)} y={size * (y + wave(index * .8 + variant) * .045)} size={size * s * (1 + wave(index) * .2)} color={index % 2 === 0 ? '#ccff00' : '#fff'}><Spark/></Glyph>)}
      {[0, 1, 2].map(index => <rect key={index} x={size * (.25 + index * .26 + wave(index) * .025)} y={size * (.96 - index * .075 + wave(index + 1) * .04)} width={size * .024} height={size * .024} fill="#ccff00" opacity={phase === undefined ? .8 : .55 + wave(index) * .3}/>)}
    </g>;
  }
  if (action === 'launch') {
    const [x, y, tilt] = [[.94, .38, 12], [-.2, .3, -12], [.88, .15, 8]][variant];
    const lift = phase === undefined ? .5 : (1 - Math.cos(phase * Math.PI * 2)) / 2;
    const flame = phase === undefined ? 6 : 5 + Math.round(Math.sin(phase * Math.PI * 8) * 2);
    return <g data-share-reaction="launch">
      <g transform={`translate(${size * (x + wave() * .022)} ${size * (y - lift * .13)}) rotate(${tilt + wave() * 3} ${size * .12} ${size * .22})`}>
        <svg width={size * .24} height={size * .42} viewBox="0 0 24 42" shapeRendering="crispEdges">
          <path d="M11 1H13V3H15V5H17V9H19V22H22V31H17V28H7V31H2V22H5V9H7V5H9V3H11Z" fill="#fff"/>
          <path d="M11 5H13V7H15V10H17V22H7V10H9V7H11Z" fill="#10110e"/>
          <path d="M4 24H6V28H4ZM18 24H20V28H18Z" fill="#10110e"/>
          <path d="M9 11H15V17H9Z" fill="#fff"/><path d="M11 13H13V15H11Z" fill="#ccff00"/>
          <path d="M8 24H16V27H8Z" fill="#10110e"/>
          <path d="M8 29H16V33H8Z" fill="#ccff00"/>
          <rect x="10" y="33" width="4" height={flame} fill="#ccff00"/>
          <path d="M10 29H14V33H10Z" fill="#fff"/>
        </svg>
        {[0, 1, 2].map(index => <rect key={index} x={size * (.06 + index * .05 + wave(index) * .015)} y={size * (.44 + index * .045 + wave(index + 1) * .02)} width={size * .024} height={size * .024} fill="#ccff00" opacity={phase === undefined ? .75 : .55 + wave(index) * .3}/>)}
      </g>
      {[[-.08, .08, .085], [.12, .6, .075], [.76, -.09, .09], [.99, .75, .06]].map(([x, y, s], index) =>
        <Glyph key={index} x={size * (x + wave(index + variant) * .02)} y={size * (y + wave(index) * .04)} size={size * s * (1 + wave(index) * .18)} color={index % 2 === 0 ? '#ccff00' : '#fff'}><Spark/></Glyph>)}
    </g>;
  }
  const side = variant === 1 ? -.12 : .79;
  return <g>
    <svg x={size * (side - .11 + wave() * .015)} y={size * (.7 - wave() * .06)} width={size * .4} height={size * .3} viewBox="0 0 34 26" shapeRendering="crispEdges" opacity={phase === undefined ? .85 : .6 + wave() * .25}>
      <path d="M9 2H21V5H27V10H32V20H27V24H7V20H2V11H6V6H9Z" fill="#e4e8d9"/><path d="M12 7H22V11H27V17H23V21H12V18H7V11H12Z" fill="#f5f7ee"/>
    </svg>
    <svg x={size * side} y={size * .92} width={size * .17} height={size * .17} viewBox="0 0 20 20" shapeRendering="crispEdges">
      <path d="M10 1H13V5H15V8H17V12H19V17H1V12H3V9H6V6H9V4H10Z" fill="#8b7157"/><path d="M5 11H14V13H5ZM3 16H17V18H3Z" fill="#614c39"/><path d="M6 12H8V14H6ZM12 12H14V14H12Z" fill="#fff7e8"/>
    </svg>
    {[[-.05, .78, .08], [.19, .65, .06], [.24, 1.02, .06]].map(([x, y, s], index) => <Glyph key={index} x={size * (side + x)} y={size * (y + wave(index) * .025)} size={size * s * (1 + wave(index) * .25)} color="#91ad31"><Spark/></Glyph>)}
  </g>;
}

function pose(action: ShareAction, variant: number, size: number): string {
  if (action === 'talk') return '';
  const [dx, dy, angle] = action === 'pet'
    ? [[0, -5, -5], [0, -32, 3], [-9, -5, -4]][variant]
    : action === 'feed' ? [[0, 6, 2], [8, 6, 4], [0, -3, -4]][variant]
    : action === 'play' ? [[-8, -12, -6], [8, -18, 6], [0, -28, -2]][variant]
    : action === 'launch' ? [[-3, -10, -3], [7, -18, 4], [-5, -25, -4]][variant]
    : [[0, 7, -3], [12, 5, 2], [0, -20, 3]][variant];
  return `translate(${dx * size / 235} ${dy * size / 235}) rotate(${angle} ${size / 2} ${size * .92})`;
}

function decodeSvgUrl(url: string): string {
  const comma = url.indexOf(',');
  if (comma < 0 || !/^data:image\/svg\+xml(?:;[^,]*)?,/i.test(url)) throw new Error('This Friend’s artwork could not be prepared for sharing.');
  return /;base64/i.test(url.slice(0, comma))
    ? new TextDecoder().decode(Uint8Array.from(atob(url.slice(comma + 1)), char => char.charCodeAt(0)))
    : decodeURIComponent(url.slice(comma + 1));
}

/** Flatten canonical inline SVGs so nested image loading cannot leave blank art in a PNG. */
function inlineArtwork(svg: SVGSVGElement): void {
  for (const image of [...svg.querySelectorAll('image')]) {
    const parsed = new DOMParser().parseFromString(decodeSvgUrl(image.getAttribute('href') || ''), 'image/svg+xml');
    const source = parsed.documentElement;
    if (source.localName !== 'svg' || parsed.querySelector('parsererror, script, foreignObject, iframe, image, use, animate, set')) {
      throw new Error('This Friend’s artwork could not be prepared for sharing.');
    }
    const nested = document.createElementNS(SVG_NS, 'svg');
    for (const attribute of [...source.attributes]) if (!['x', 'y', 'width', 'height', 'xmlns'].includes(attribute.name)) nested.setAttribute(attribute.name, attribute.value);
    for (const name of ['x', 'y', 'width', 'height', 'preserveAspectRatio']) {
      const value = image.getAttribute(name); if (value !== null) nested.setAttribute(name, value);
    }
    for (const child of [...source.childNodes]) nested.append(document.importNode(child, true));
    image.replaceWith(nested);
  }
}

async function drawSvg(context: CanvasRenderingContext2D, markup: string, signal?: AbortSignal): Promise<void> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = image.onerror = null; };
      const abort = () => { cleanup(); image.src = ''; reject(new DOMException('Export cancelled', 'AbortError')); };
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('The share image took too long to load. Please try again.')); }, 15_000);
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('Could not render this share image. Please try again.')); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    context.drawImage(image, 0, 0, SHARE_IMAGE_SIZE, SHARE_IMAGE_SIZE);
  } finally { URL.revokeObjectURL(url); }
}

/** Local, fixed-resolution export. No wallet request, care update or social post occurs here. */
export async function renderShareCanvas({ friend, island, bodyId, action, variant = 0, speech }: ShareImageOptions, { size = SHARE_IMAGE_SIZE, phase, signal }: { size?: number; phase?: number; signal?: AbortSignal } = {}): Promise<HTMLCanvasElement> {
  signal?.throwIfAborted();
  if (friend.collection === 'generations' && !friend.sprites) throw new Error('Your Friend’s sprites are still loading. Please try again.');
  const option = getIsland(island);
  const safeVariant = ((Math.trunc(variant) % 3) + 3) % 3;
  await Promise.all([document.fonts.load('48px "Sometype Mono Variable"'), document.fonts.load('56px Silkscreen')]);
  signal?.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create an image. Please try again.');
  context.imageSmoothingEnabled = false;
  context.scale(size / SHARE_IMAGE_SIZE, size / SHARE_IMAGE_SIZE);
  const mono = '"Sometype Mono Variable", "Courier New", monospace';
  context.font = `500 46px ${mono}`;
  const words = resolveShareSpeech(action, speech), bubbleWidth = Math.min(1640, Math.ceil(context.measureText(words).width + 102)), bubbleHeight = 132;
  // Keep exactly the same relative island / Friend proportions as the main habitat.
  const floorWidth = 1640;
  const [aspectWidth, aspectHeight] = option.aspectRatio.split('/').map(Number);
  const floorHeight = floorWidth * aspectHeight / aspectWidth;
  const petSize = floorWidth * islandPetRatio(option, 1000);
  const petCenter = floorWidth * parseFloat(option.petX) / 100;
  const petBottom = floorHeight * parseFloat(option.petY) / 100;
  const petLeft = petCenter - petSize / 2, petTop = petBottom - petSize;
  const bubbleX = Math.max(0, Math.min(floorWidth - bubbleWidth, petCenter - bubbleWidth / 2));
  const bubbleY = petTop - bubbleHeight - (action === 'talk' || action === 'launch' ? 200 : action === 'play' ? 155 : 130);
  const top = Math.min(0, bubbleY - 8, petTop - petSize * .2), bottom = Math.max(floorHeight, petBottom + petSize * .13);
  const scale = Math.min(1, 1370 / (bottom - top));
  const offsetX = (SHARE_IMAGE_SIZE - floorWidth * scale) / 2;
  const offsetY = 1050 - (top + bottom) * scale / 2;
  const host = document.createElement('div');
  const root = createRoot(host);
  let markup: string;
  const wave = phase === undefined ? 0 : Math.sin(phase * Math.PI * 2);
  const bounce = phase === undefined ? 0 : (1 - Math.cos(phase * Math.PI * 4)) / 2;
  // One gentle orbit per GIF loop; keep the island and speech still for readability.
  // The PNG captures the Friend halfway up the same hovering motion.
  const hover = phase === undefined ? .5 : (1 - Math.cos(phase * Math.PI * 2)) / 2;
  const motion = action === 'talk'
    ? `translate(${petSize * wave * .015} ${-petSize * (.025 + hover * .065)}) rotate(${wave * 2} ${petSize / 2} ${petSize * .92})`
    : action === 'play'
      ? `translate(${petSize * wave * .023} ${-petSize * bounce * .045}) rotate(${wave * 4} ${petSize / 2} ${petSize * .92})`
    : action === 'launch'
      ? `translate(${petSize * wave * .012} ${-petSize * (.018 + hover * .075)}) rotate(${wave * 2.5} ${petSize / 2} ${petSize * .92})`
    : `translate(0 ${-petSize * bounce * (action === 'pet' ? .025 : action === 'feed' ? .012 : .018)}) rotate(${wave * (action === 'feed' ? 3 : 2)} ${petSize / 2} ${petSize * .92})`;
  const frame = phase === undefined ? (action === 'talk' ? 0 : safeVariant * 2) : Math.floor(phase * 16) % 8;
  try {
    flushSync(() => root.render(<svg xmlns={SVG_NS} width={size} height={size} viewBox="0 0 2000 2000">
      <rect width="2000" height="2000" fill="#000"/>
      <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
        <svg width={floorWidth} height={floorHeight} overflow="visible" data-share-slot="island"><IslandArt option={option}/></svg>
        <g transform={`translate(${petLeft} ${petTop})`}>
          <g transform={motion}><g transform={pose(action, safeVariant, petSize)}><svg width={petSize} height={petSize} overflow="visible" data-share-slot="friend">
            {friend.collection === 'genesis' ? <GenesisPetSprite portraitUrl={friend.image} bodyId={bodyId} frame={frame}/>
              : <PetSprite sprites={friend.sprites!} frame={frame}/>}
          </svg></g></g>
          <Reaction action={action} variant={safeVariant} size={petSize} phase={phase}/>
        </g>
        <g transform={`translate(${bubbleX} ${bubbleY})`}>
          <path d={`M9 9H${bubbleWidth + 9}V${bubbleHeight + 9}H${bubbleWidth / 2 + 40}L${bubbleWidth / 2 + 9} ${bubbleHeight + 42}L${bubbleWidth / 2 - 22} ${bubbleHeight + 9}H9Z`} fill="#414735"/>
          <path d={`M0 0H${bubbleWidth}V${bubbleHeight}H${bubbleWidth / 2 + 31}L${bubbleWidth / 2} ${bubbleHeight + 33}L${bubbleWidth / 2 - 31} ${bubbleHeight}H0Z`} fill="#fff" stroke="#000" strokeWidth="4"/>
        </g>
      </g>
    </svg>));
    const svg = host.querySelector('svg')!;
    for (const child of svg.querySelectorAll('[data-share-slot] > svg')) {
      child.setAttribute('width', '100%'); child.setAttribute('height', '100%'); child.setAttribute('overflow', 'visible');
    }
    inlineArtwork(svg);
    markup = new XMLSerializer().serializeToString(svg);
  } finally { root.unmount(); }
  await drawSvg(context, markup, signal);
  signal?.throwIfAborted();
  context.save();
  context.translate(offsetX, offsetY); context.scale(scale, scale);
  context.fillStyle = '#10110e'; context.font = `500 46px ${mono}`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(words, bubbleX + bubbleWidth / 2, bubbleY + bubbleHeight / 2 + 1, bubbleWidth - 102);
  context.restore();
  context.fillStyle = '#fff'; context.font = '400 58px Silkscreen, "Courier New", monospace';
  context.textAlign = 'left'; context.textBaseline = 'middle';
  context.fillText('RARE', 120, 138);
  const rareWidth = context.measureText('RARE').width;
  context.fillStyle = '#ccff00'; context.fillText('PET', 120 + rareWidth, 138);
  context.font = `500 30px ${mono}`; context.textAlign = 'right';
  if (action !== 'talk') { context.fillStyle = '#ccff00'; context.fillText(action.toUpperCase(), 1880, 138); }
  context.fillStyle = '#fff'; context.textAlign = 'left'; context.font = `500 31px ${mono}`;
  const label = `${friend.label} · ${option.name}`;
  // Token IDs are unbounded metadata; fitting the label must never distort the art.
  let labelSize = 31;
  while (context.measureText(label).width > 1260 && labelSize > 16) { context.font = `500 ${--labelSize}px ${mono}`; }
  context.fillText(label, 120, 1870, 1260);
  context.textAlign = 'right'; context.font = `500 31px ${mono}`;
  context.fillStyle = '#ccff00'; context.fillText('RAREPET.APP', 1880, 1870);
  return canvas;
}

export async function renderShareImage(options: ShareImageOptions, signal?: AbortSignal): Promise<Blob> {
  const canvas = await renderShareCanvas(options, { signal });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not save the image. Please try again.')), 'image/png'));
  signal?.throwIfAborted();
  return blob;
}

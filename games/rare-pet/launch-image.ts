export const MAX_LAUNCH_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_STORED_IMAGE_BYTES = 1024 * 1024;
export const MAX_LAUNCH_IMAGE_EDGE = 8192;
export const MAX_LAUNCH_IMAGE_PIXELS = 4096 * 4096;
export type LaunchImage = Readonly<{ blob: Blob; previewUrl: string; sha256: string; width: 512; height: 512 }>;

export function validateLaunchImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('This image has invalid dimensions. Choose another PNG, JPG or WebP.');
  if (width > MAX_LAUNCH_IMAGE_EDGE || height > MAX_LAUNCH_IMAGE_EDGE) throw new Error(`Your image is too large (${width} × ${height} px). Maximum: 8192 px per side. Try 2000 × 2000 px.`);
  if (width * height > MAX_LAUNCH_IMAGE_PIXELS) throw new Error(`Your image is too large (${width} × ${height} px). For a square image, the maximum is 4096 × 4096 px. Try 2000 × 2000 px.`);
}

/** Decode raster bytes locally; upload only after an owner explicitly reviews a launch. */
export async function prepareLaunchImage(file: File): Promise<LaunchImage> {
  if (!file.size) throw new Error('This file is empty. Choose a PNG, JPG or WebP up to 5 MB.');
  if (file.size > MAX_LAUNCH_IMAGE_BYTES) throw new Error('Your image file is too large. Maximum file size: 5 MB. Compress it or export a smaller image.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length > 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('Use a PNG, JPG or WebP image.');
  // Reject large PNGs from their dimensions before allocating the decoded pixels.
  // Still validate the browser's decoded dimensions for every supported format.
  if (png && bytes.length >= 24 && new DataView(bytes.buffer).getUint32(8) === 13 && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR') {
    const header = new DataView(bytes.buffer);
    validateLaunchImageDimensions(header.getUint32(16), header.getUint32(20));
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp' })); }
  catch { throw new Error('This image could not be read. Try exporting it again as PNG, JPG or WebP, ideally 2000 × 2000 px.'); }
  try {
    validateLaunchImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image preview is unavailable in this browser.');
    const side = Math.min(bitmap.width, bitmap.height);
    context.imageSmoothingEnabled = bitmap.width > 512 || bitmap.height > 512;
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('This image could not be prepared.')), 'image/png'));
    if (blob.size > MAX_STORED_IMAGE_BYTES) throw new Error('This image is too large after resizing. Try a simpler image.');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return { blob, previewUrl: URL.createObjectURL(blob), sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''), width: 512, height: 512 };
  } finally { bitmap.close(); }
}

export function validateLaunchName(value: string): string {
  const name = value.trim().normalize('NFC');
  if (name.length < 2 || name.length > 40 || new TextEncoder().encode(name).length > 64 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(name)) throw new Error('Use a token name between 2 and 40 characters (up to 64 bytes).');
  return name;
}
export function validateLaunchTicker(value: string): string {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error('Use 2–10 letters or numbers for the ticker.');
  return ticker;
}

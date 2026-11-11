/** Saving and copying, in the browser. Nothing here makes export content: texts come from the core; PNG is the one browser-side export. */

export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function saveText(filename: string, mime: string, text: string): void {
  saveBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** Copies text; the Clipboard API where it exists and is allowed, else a hidden text area and `execCommand`. Resolves with success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the fallback.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Browsers limit the size of a canvas (Chromium: 16 384 px per side, about 268 million px in all); Safari is stricter. */
const MAX_SIDE = 16_384;
const MAX_AREA = 100_000_000;

export function pngSizeAllowed(width: number, height: number, scale: number): boolean {
  const w = width * scale;
  const h = height * scale;
  return w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_AREA;
}

/** Rasterises SVG markup to a PNG (FA-26) through a `blob:` URL; no network. */
export async function svgToPng(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

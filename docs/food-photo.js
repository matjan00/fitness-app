// Photo handling (weekly review progress photos): compress a local file into a small saved JPEG data URL.

const MAX_SIDE = 800;
const QUALITY = 0.72;
const TARGET_BYTES = 120 * 1024;

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Could not load the image.'));
    im.src = src;
  });
}

// Draw a loaded <img> onto a canvas, scaled to at most MAX_SIDE on the long side, and export a compressed
// JPEG data URL. A couple of extra passes at lower quality if it's still big (photos from a phone camera).
export function drawCompressed(imgEl, { maxSide = MAX_SIDE, quality = QUALITY, targetBytes = TARGET_BYTES } = {}) {
  const w = imgEl.naturalWidth || imgEl.width;
  const h = imgEl.naturalHeight || imgEl.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, cw, ch);
  let q = quality;
  let out = canvas.toDataURL('image/jpeg', q);
  for (let i = 0; i < 3 && out.length * 0.75 > targetBytes && q > 0.35; i++) {
    q -= 0.15;
    out = canvas.toDataURL('image/jpeg', q);
  }
  return out;
}

// Compress a File/Blob (from "choose photo" / camera) into a saved data URL.
export async function compressFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    return drawCompressed(im);
  } finally {
    URL.revokeObjectURL(url);
  }
}

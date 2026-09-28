// Recipe photo handling: compress a local file or a remote https image into a small saved JPEG data URL,
// so a recipe photo never expires (TikTok/CDN image URLs expire) and never needs a network request to show.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as store from './store.js';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const imageEndpoint = () => (isLocal ? 'http://localhost:5191' : SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/fetch-recipe` : null);

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

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (!isLocal) {
    let token = SUPABASE_KEY;
    try { const s = await store.client?.auth.getSession(); if (s?.data?.session?.access_token) token = s.data.session.access_token; } catch { /* offline */ }
    headers.apikey = SUPABASE_KEY;
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// Fetch a remote https image through the edge function (server-side — a remote image can't be drawn to a
// canvas cross-origin) and compress it the same way. Returns null on any failure (caller shows a small hint).
export async function compressRemote(url) {
  const ep = imageEndpoint();
  if (!ep || !url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch(ep, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ image: url }), signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
  let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok || !j?.dataUrl) return null;
  try {
    const im = await loadImg(j.dataUrl);
    return drawCompressed(im);
  } catch {
    return null;
  }
}

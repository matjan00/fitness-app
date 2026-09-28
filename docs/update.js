// App updates. version.js travels with the (cached) app; version.json is always fetched fresh from the website
// (the service worker never caches it). When the website has a newer number, the app offers an update that
// drops the saved copy and reloads. Used by the Home card (app.js) and the Me tab.

import { APP_VERSION } from './version.js';

export { APP_VERSION };
let latest = null;

// Returns the newer version number, or null when up to date. Throws when offline.
export async function checkForUpdate() {
  const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { v } = await res.json();
  latest = Number(v) > APP_VERSION ? Number(v) : null;
  return latest;
}

export const newerVersion = () => latest;

export async function applyUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== 'fit-images').map((k) => caches.delete(k)));
  } catch { /* reload anyway */ }
  location.reload();
}

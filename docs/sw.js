// Offline support. The app files are served "stale-while-revalidate": the saved copy opens instantly
// (also with no signal at the gym) and a fresh copy is fetched in the background for next time.
// Exercise pictures are cached the first time they are shown. Supabase/Strava calls are never cached.
const VERSION = 'fit-v12';
const CORE = ['./', 'index.html', 'style.css', 'gym.css', 'food.css', 'run.css', 'app.js', 'version.js', 'update.js', 'util.js', 'store.js', 'nav.js',
  'charts.js', 'config.js', 'me.js', 'gym.js', 'gym-calc.js', 'gym-data.js', 'gym-lib.js', 'gym-workout.js', 'gym-routines.js',
  'food.js', 'food-parse.js', 'food-db.js', 'food-calc.js', 'food-cats.js', 'food-ui.js', 'food-recipes.js', 'food-photo.js', 'food-learn.js',
  'data/foods.json', 'data/lessons.json',
  'run.js', 'run-coach.js', 'run-detail.js', 'run-strava.js', 'run-demo.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
  'vendor/supabase.js', 'vendor/chart.umd.min.js', 'data/exercises.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'fit-images').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // The update check must always ask the website, never the saved copy.
  if (url.pathname.endsWith('/version.json')) return;

  // Exercise pictures: cache first, they never change.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('free-exercise-db')) {
    e.respondWith(caches.open('fit-images').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // App files and fonts: stale-while-revalidate.
  if (url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    if (url.origin === location.origin && url.search.includes('share_')) {
      // Opened from Android "Share" — serve the app shell.
      e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
      return;
    }
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req, url.origin === location.origin ? { cache: 'no-cache' } : undefined).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

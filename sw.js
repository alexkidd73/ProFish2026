/* Service worker : application utilisable hors ligne */
const V = 'v1';
const SHELL = 'peche-shell-' + V, TILES = 'peche-tiles-' + V, API = 'peche-api-' + V;
const LEAFLET = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
const OWN = ['./', 'index.html', 'style.css', 'weather.css', 'conditions.js', 'app.js', 'maps.js',
  'insights.js', 'forecast.js', 'backup.js', 'offline.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com', 'tiles.openseamap.org'];
const API_HOSTS = ['api.open-meteo.com', 'marine-api.open-meteo.com', 'ows.emodnet-bathymetry.eu'];
const MAX_TILES = 3000, MAX_API = 300;
// PNG transparent 1x1
const BLANK = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(OWN.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(LEAFLET.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('peche-') && ![SHELL, TILES, API].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
}
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function shell(req) {
  const c = await caches.open(SHELL);
  try {
    const r = await Promise.race([fetch(req), timeout(3000)]);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch {
    return (await c.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await c.match('index.html') || await c.match('./') : null) ||
      Response.error();
  }
}
async function leaflet(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req);
  if (hit) return hit;
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch { return Response.error(); }
}
async function tile(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req.url);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.ok || r.type === 'opaque') { c.put(req.url, r.clone()); if (Math.random() < 0.02) trim(TILES, MAX_TILES); }
    return r;
  } catch {
    return new Response(BLANK, { headers: { 'Content-Type': 'image/png' } });
  }
}
async function api(req) {
  const c = await caches.open(API);
  try {
    const r = await fetch(req);
    if (r.ok) { c.put(req.url, r.clone()); if (Math.random() < 0.05) trim(API, MAX_API); }
    return r;
  } catch {
    const hit = await c.match(req.url);
    if (!hit) return Response.error();
    const h = new Headers(hit.headers);
    h.set('X-From-Cache', '1');
    return new Response(await hit.blob(), { status: hit.status, headers: h });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) return e.respondWith(shell(req));
  if (u.hostname === 'unpkg.com') return e.respondWith(leaflet(req));
  if (TILE_HOSTS.includes(u.hostname)) return e.respondWith(tile(req));
  if (API_HOSTS.includes(u.hostname)) return e.respondWith(api(req));
});

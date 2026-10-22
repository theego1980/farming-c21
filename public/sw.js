/* Service worker: permite instalar la app y abrirla sin señal.
   - Archivos de la app: primero la red (así siempre llega la última versión); sin señal, la copia guardada.
   - Librerías y tipografías: copia guardada.
   - Mapa (tiles de OpenStreetMap): se guardan los que ya se vieron, para que el mapa de la zona se vea sin señal.
   - Datos (Supabase, /api): nunca se guardan acá; los maneja la app. */
const VERSION = 'farming-v3';
const APP = 'app-' + VERSION, LIBS = 'libs-v1', TILES = 'tiles-v1';
const SHELL = ['/', '/index.html', '/app.js', '/data.js', '/geo.js', '/styles.css', '/logo.png', '/icono.png', '/icono-192.png', '/manifest.webmanifest'];
const MAX_TILES = 800;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('app-') && k !== APP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function redPrimero(req, cache, fallback) {
  try {
    const r = await fetch(req);
    if (r && r.ok) (await caches.open(cache)).put(req, r.clone());
    return r;
  } catch (e) {
    const c = await caches.match(req, { ignoreSearch: true });
    if (c) return c;
    if (fallback) { const f = await caches.match(fallback); if (f) return f; }
    throw e;
  }
}
async function copiaPrimero(req, cache) {
  const c = await caches.match(req);
  if (c) return c;
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) (await caches.open(cache)).put(req, r.clone());
  return r;
}
async function tile(req) {
  const cache = await caches.open(TILES);
  const c = await cache.match(req);
  const red = fetch(req).then(async r => {
    if (r && (r.ok || r.type === 'opaque')) {
      await cache.put(req, r.clone());
      const ks = await cache.keys();
      if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES)) await cache.delete(k);
    }
    return r;
  }).catch(() => c);
  return c || red;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return;            // datos: siempre en vivo
    if (req.mode === 'navigate') { e.respondWith(redPrimero(req, APP, '/index.html')); return; }
    e.respondWith(redPrimero(req, APP));
    return;
  }
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)) { e.respondWith(tile(req)); return; }
  if (/^(unpkg\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) { e.respondWith(copiaPrimero(req, LIBS)); return; }
  // Supabase, OpenStreetMap (Overpass), servicio de direcciones: pasan directo
});

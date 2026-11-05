/* Mode hors ligne : service worker, installation, téléchargement de cartes */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const TILE_URL = {
    osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    sat: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
  };
  const MAX_TILES = 500, MAX_ZOOM = { osm: 17, sat: 17 };
  const pill = $('offline-pill'), status = $('off-status'), btn = $('off-dl'), bar = $('off-bar'),
    clear = $('off-clear'), install = $('off-install'), hint = $('off-hint');

  function setPill() { if (pill) pill.classList.toggle('hidden', navigator.onLine); }
  window.addEventListener('online', setPill); window.addEventListener('offline', setPill); setPill();

  const swOk = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  if (swOk) {
    navigator.serviceWorker.register('sw.js').then(() => {
      if (status) status.textContent = 'Application disponible hors ligne. Les cartes déjà consultées sont conservées automatiquement.';
    }).catch(() => { if (status) status.textContent = 'Mode hors ligne indisponible sur ce navigateur.'; });
  } else if (status) {
    status.textContent = 'Le mode hors ligne nécessite HTTPS (GitHub Pages) ou localhost.';
    if (btn) btn.disabled = true;
  }

  // Installation sur l'écran d'accueil
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (install) install.classList.remove('hidden'); });
  if (install) install.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; install.classList.add('hidden');
  });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  if (hint && ios) { hint.textContent = 'iPhone : Partager → « Sur l’écran d’accueil » pour installer l’application.'; hint.classList.remove('hidden'); }

  function base() {
    let b = 'plan'; try { b = JSON.parse(localStorage.getItem('peche.base.v1')) || 'plan'; } catch { /* défaut */ }
    return b === 'sat' ? 'sat' : 'osm';
  }
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };

  function plan(map, kind) {
    const b = map.getBounds(), z0 = Math.round(map.getZoom()), list = [];
    for (let z = z0; z <= Math.min(MAX_ZOOM[kind], z0 + 4); z++) {
      const x1 = lon2x(b.getWest(), z), x2 = lon2x(b.getEast(), z), y1 = lat2y(b.getNorth(), z), y2 = lat2y(b.getSouth(), z);
      const n = (x2 - x1 + 1) * (y2 - y1 + 1);
      if (list.length + n > MAX_TILES) break;
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) list.push(TILE_URL[kind](z, x, y));
    }
    return list;
  }

  let running = false;
  if (btn) btn.addEventListener('click', async () => {
    const map = window.fishMap; if (!map || running) return;
    if (!navigator.onLine) { status.textContent = 'Connexion nécessaire pour télécharger.'; return; }
    if (!navigator.serviceWorker.controller) { status.textContent = 'Rechargez la page une fois pour activer le mode hors ligne, puis réessayez.'; return; }
    const kind = base(), urls = plan(map, kind);
    if (!urls.length) { status.textContent = 'Zone trop grande : zoomez davantage sur la zone à enregistrer.'; return; }
    running = true; btn.disabled = true; bar.classList.remove('hidden'); bar.max = urls.length; bar.value = 0;
    let done = 0, fail = 0, i = 0;
    const worker = async () => {
      while (i < urls.length && navigator.onLine) {
        const u = urls[i++];
        try { const r = await fetch(u, { mode: 'cors' }); if (!r.ok) fail++; else await r.blob(); } catch { fail++; }
        bar.value = ++done;
        status.textContent = `Téléchargement… ${done}/${urls.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    running = false; btn.disabled = false; bar.classList.add('hidden');
    status.textContent = done < urls.length ? 'Téléchargement interrompu (connexion perdue).'
      : fail ? `Terminé : ${done - fail} tuiles enregistrées, ${fail} en échec.` : `Terminé : ${done} tuiles de la zone enregistrées (${kind === 'sat' ? 'satellite' : 'plan'}).`;
  });

  if (clear) clear.addEventListener('click', async () => {
    if (!confirm('Supprimer les cartes et données météo enregistrées pour le hors ligne ? Vos prises ne sont pas touchées.')) return;
    for (const k of await caches.keys()) if (/^peche-(tiles|api)-/.test(k)) await caches.delete(k);
    status.textContent = 'Cartes et prévisions en cache supprimées.';
  });
})();

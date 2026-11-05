/* Fonds de carte (Plan / Marine / Satellite) + calques météo (Open-Meteo) */
(() => {
  'use strict';

  const map = window.fishMap;
  if (!map) return;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoré */ } }
  };
  const KEY_BASE = 'peche.base.v1';
  const KEY_WX = 'peche.wx.v1';

  // =====================================================
  // Fonds de carte
  // =====================================================
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, maxNativeZoom: 18, crossOrigin: true,
    attribution: 'Imagerie &copy; Esri, Maxar, Earthstar Geographics'
  });
  const seamark = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 19, maxNativeZoom: 18, zIndex: 5, // au-dessus de la bathymétrie
    attribution: 'Balisage &copy; <a href="https://www.openseamap.org">OpenSeaMap</a>'
  });
  const BASES = { plan: [osm], marine: [osm, seamark], sat: [sat] };

  function setBase(name) {
    if (!BASES[name]) name = 'plan';
    [osm, sat, seamark].forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    BASES[name].forEach(l => l.addTo(map));
    store.set(KEY_BASE, name);
    document.querySelectorAll('[data-base]').forEach(b =>
      b.classList.toggle('on', b.dataset.base === name));
  }
  document.querySelectorAll('[data-base]').forEach(b =>
    b.addEventListener('click', () => setBase(b.dataset.base)));
  setBase(store.get(KEY_BASE, 'plan'));

  // =====================================================
  // Profondeur d'eau : bathymétrie EMODnet (WMS, superposée au fond choisi)
  // =====================================================
  const KEY_DEPTH = 'peche.depth.v1';
  const EMODNET_WMS = 'https://ows.emodnet-bathymetry.eu/wms';
  const EMODNET_ATTR = 'Bathymétrie &copy; <a href="https://emodnet.ec.europa.eu">EMODnet</a>';
  const wmsOpts = { format: 'image/png', transparent: true, version: '1.3.0', maxZoom: 19, attribution: EMODNET_ATTR };
  const DEPTH = {
    bathy:    L.tileLayer.wms(EMODNET_WMS, { ...wmsOpts, layers: 'emodnet:mean_multicolour', zIndex: 3, opacity: 0.7 }),
    contours: L.tileLayer.wms(EMODNET_WMS, { ...wmsOpts, layers: 'emodnet:contours', zIndex: 4 })
  };
  const depthState = Object.assign({ on: [], opacity: 70 }, store.get(KEY_DEPTH, {}));
  const saveDepth = () => store.set(KEY_DEPTH, depthState);

  function applyDepth() {
    Object.entries(DEPTH).forEach(([k, layer]) => {
      const show = depthState.on.includes(k);
      if (show && !map.hasLayer(layer)) layer.addTo(map);
      if (!show && map.hasLayer(layer)) map.removeLayer(layer);
    });
    DEPTH.bathy.setOpacity(depthState.opacity / 100);
  }
  document.querySelectorAll('[data-depth]').forEach(cb => {
    cb.checked = depthState.on.includes(cb.dataset.depth);
    cb.addEventListener('change', () => {
      const k = cb.dataset.depth;
      depthState.on = depthState.on.filter(x => x !== k);
      if (cb.checked) depthState.on.push(k);
      saveDepth(); applyDepth();
    });
  });
  const opac = $('depth-opacity');
  opac.value = depthState.opacity;
  opac.addEventListener('input', () => {
    depthState.opacity = Number(opac.value);
    DEPTH.bathy.setOpacity(depthState.opacity / 100);
    saveDepth();
  });
  applyDepth();

  // =====================================================
  // Calques météo
  // =====================================================
  const WX = {
    wind:    { label: 'Vent (nœuds)' },
    temp:    { label: 'Air (°C)' },
    sea:     { label: 'Eau (°C)' },
    current: { label: 'Courant (nœuds)' }
  };
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
  const KMH_TO_KT = 1 / 1.852;
  const WX_ATTR = 'Météo &copy; <a href="https://open-meteo.com">Open-Meteo</a>';

  const active = new Set(store.get(KEY_WX, []).filter(k => WX[k]));

  // Les marqueurs météo restent sous les prises (markerPane = 600)
  map.createPane('wx');
  map.getPane('wx').style.zIndex = 450;
  map.getPane('wx').style.pointerEvents = 'none';
  const group = L.layerGroup().addTo(map);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapLng = (l) => ((l + 540) % 360) - 180;

  function gridPoints() {
    const b = map.getBounds();
    const size = map.getSize();
    const cols = clamp(Math.round(size.x / 90), 3, 7);
    const rows = clamp(Math.round(size.y / 90), 3, 7);
    const n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast();
    const pts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lat = clamp(n - (r + 0.5) * (n - s) / rows, -89, 89);
        const lng = wrapLng(w + (c + 0.5) * (e - w) / cols);
        pts.push([lat, lng]);
      }
    }
    return pts;
  }

  // Cache simple (15 min) pour limiter les appels
  const cache = new Map();
  async function fetchBatch(baseUrl, pts, params) {
    const lat = pts.map(p => p[0].toFixed(3)).join(',');
    const lng = pts.map(p => p[1].toFixed(3)).join(',');
    const key = `${baseUrl}|${lat}|${lng}|${params}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < 15 * 60e3) return hit.v;
    const res = await fetch(`${baseUrl}?latitude=${lat}&longitude=${lng}&${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const v = Array.isArray(json) ? json : [json];
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return v;
  }

  // ----- Couleurs -----
  function tempColor(t) {
    const hue = clamp(240 - ((t + 5) / 40) * 240, 0, 240); // -5 °C bleu → 35 °C rouge
    return `hsl(${hue.toFixed(0)}, 72%, 38%)`;
  }
  function windColor(kt) {
    if (kt < 10) return '#16a34a';
    if (kt < 17) return '#ca8a04';
    if (kt < 25) return '#ea580c';
    if (kt < 34) return '#dc2626';
    return '#7c3aed';
  }
  function currentColor(kt) {
    if (kt < 0.5) return '#0891b2';
    if (kt < 1.5) return '#2563eb';
    return '#7c3aed';
  }

  // ----- Icônes -----
  // dx/dy : décalage en pixels pour ne pas superposer les calques
  function icon(html, w, h, dx, dy) {
    return L.divIcon({
      className: '', html, iconSize: [w, h],
      iconAnchor: [w / 2 - dx, h / 2 - dy]
    });
  }
  function arrowHtml(deg, color, label) {
    return `<div class="wx wx-arrow" style="color:${color}">
      <svg viewBox="0 0 24 24" width="30" height="30" style="transform:rotate(${deg}deg)">
        <path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      </svg><span>${label}</span></div>`;
  }
  const put = (pt, ic) =>
    L.marker(pt, { icon: ic, pane: 'wx', interactive: false, keyboard: false }).addTo(group);

  // ----- Statut -----
  function setStatus(msg) {
    const el = $('wx-status');
    if (!msg) { el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function updateAttribution() {
    map.attributionControl.removeAttribution(WX_ATTR);
    if (active.size) map.attributionControl.addAttribution(WX_ATTR);
  }

  // ----- Rafraîchissement -----
  let token = 0;
  async function refresh() {
    const my = ++token;
    updateAttribution();
    if (!active.size) { group.clearLayers(); setStatus(''); return; }
    if (map.getZoom() < 4) {
      group.clearLayers();
      setStatus('Zoomez pour afficher la météo');
      return;
    }

    const pts = gridPoints();
    const needF = active.has('wind') || active.has('temp');
    const needM = active.has('current') || active.has('sea');
    setStatus('Chargement de la météo…');

    const [f, m] = await Promise.all([
      needF ? fetchBatch(FORECAST_URL, pts,
        'current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kn').catch(() => null) : null,
      needM ? fetchBatch(MARINE_URL, pts,
        'current=ocean_current_velocity,ocean_current_direction,sea_surface_temperature').catch(() => null) : null
    ]);
    if (my !== token) return; // une requête plus récente a pris le relais

    group.clearLayers();
    const errors = [];
    if (needF && !f) errors.push('météo');
    if (needM && !m) errors.push('données marines');

    pts.forEach((pt, i) => {
      // Vent : la direction fournie est celle d'où vient le vent → flèche vers où il souffle
      const fc = f && f[i] && f[i].current;
      if (fc) {
        if (active.has('wind') && fc.wind_speed_10m != null && fc.wind_direction_10m != null) {
          const kt = fc.wind_speed_10m;
          put(pt, icon(arrowHtml(fc.wind_direction_10m + 180, windColor(kt), Math.round(kt)), 38, 46, 0, 0));
        }
        if (active.has('temp') && fc.temperature_2m != null) {
          const t = fc.temperature_2m;
          put(pt, icon(`<div class="wx wx-pill" style="background:${tempColor(t)}">${Math.round(t)}°</div>`, 46, 26, 0, 34));
        }
      }

      // Données marines : on ignore les points trop éloignés d'une cellule de mer (= terre)
      const mc = m && m[i];
      if (mc && mc.current &&
          Math.abs(mc.latitude - pt[0]) < 0.25 &&
          Math.abs(wrapLng(mc.longitude - pt[1])) < 0.25) {
        const c = mc.current;
        if (active.has('sea') && c.sea_surface_temperature != null) {
          const t = c.sea_surface_temperature;
          put(pt, icon(`<div class="wx wx-pill" style="background:${tempColor(t)}">🌊 ${Math.round(t)}°</div>`, 58, 26, 0, -34));
        }
        if (active.has('current') && c.ocean_current_velocity != null && c.ocean_current_direction != null) {
          const kt = c.ocean_current_velocity * KMH_TO_KT; // l'API fournit des km/h
          put(pt, icon(arrowHtml(c.ocean_current_direction, currentColor(kt), kt.toFixed(1)), 38, 46, 44, 0));
        }
      }
    });

    const names = [...active].map(k => WX[k].label).join(' · ');
    const hh = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    setStatus(errors.length
      ? `⚠️ ${errors.join(' et ')} indisponible(s) — réessayez plus tard`
      : `${names} — ${hh}`);
  }

  let debounce;
  const scheduleRefresh = () => {
    if (!active.size) return;
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 700);
  };
  map.on('moveend', scheduleRefresh);
  setInterval(() => { if (active.size && !document.hidden) refresh(); }, 15 * 60e3);

  // ----- Cases à cocher du panneau -----
  document.querySelectorAll('[data-wx]').forEach(cb => {
    cb.checked = active.has(cb.dataset.wx);
    cb.addEventListener('change', () => {
      cb.checked ? active.add(cb.dataset.wx) : active.delete(cb.dataset.wx);
      store.set(KEY_WX, [...active]);
      refresh();
    });
  });

  refresh();
})();

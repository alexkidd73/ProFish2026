/* Carnet de Pêche — app statique (Leaflet + localStorage) */
(() => {
  'use strict';

  // Poissons proposés selon la zone : eau douce ou mer / océan
  const FISH = {
    fresh: [
      'Brochet', 'Sandre', 'Perche', 'Truite', 'Carpe', 'Black-bass',
      'Silure', 'Gardon', 'Brème', 'Tanche', 'Anguille', 'Barbeau'
    ],
    sea: [
      'Bar (loup)', 'Daurade royale', 'Maquereau', 'Lieu jaune', 'Sole', 'Merlan',
      'Pageot', 'Rouget', 'Congre', 'Mulet', 'Sar', 'Turbot', 'Raie', 'Vive',
      'Orphie', 'Chinchard', 'Bonite', 'Thon rouge', 'Thon jaune', 'Mahi-mahi',
      'Barracuda', 'Mérou', 'Vivaneau', 'Carangue', 'Espadon', 'Marlin'
    ]
  };
  const DEFAULT_FISH = [...FISH.fresh, ...FISH.sea];
  const PALETTE = [
    '#e11d48', '#f97316', '#eab308', '#16a34a', '#0d9488', '#0ea5e9',
    '#4f46e5', '#9333ea', '#db2777', '#78716c', '#65a30d', '#0891b2'
  ];
  const KEY_CATCHES = 'peche.catches.v1';
  const KEY_CUSTOM = 'peche.customFish.v1';
  const KEY_HIDDEN = 'peche.hiddenLayers.v1';
  const KEY_WATER = 'peche.water.v1';

  // ---------- Stockage ----------
  const load = (k, def) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; }
  };
  const save = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch { toast('Stockage plein : supprime des prises ou photos.'); return false; }
  };

  let catches = load(KEY_CATCHES, []);
  // Poissons personnalisés : { name, kind: 'fresh' | 'sea' | 'any' } (anciens enregistrements = texte → 'any')
  const normCustom = (f) => (typeof f === 'string' ? { name: f, kind: 'any' } : f);
  let customFish = load(KEY_CUSTOM, []).map(normCustom);
  let hidden = new Set(load(KEY_HIDDEN, []));

  const allFish = () => [...DEFAULT_FISH, ...customFish.map(f => f.name)];
  const colorOf = (name) => {
    const i = allFish().indexOf(name);
    return PALETTE[(i < 0 ? name.length : i) % PALETTE.length];
  };

  // ---------- Utilitaires ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  // ---------- Carte ----------
  const map = L.map('map', { zoomControl: false }).setView([48.8566, 2.3522], 6);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  // Les fonds de carte (Plan / Marine / Satellite) et la météo sont gérés dans maps.js
  window.fishMap = map;

  const groups = {};        // nom -> L.layerGroup
  function groupFor(name) {
    if (!groups[name]) {
      groups[name] = L.layerGroup();
      if (!hidden.has(name)) groups[name].addTo(map);
    }
    return groups[name];
  }

  function addMarker(c) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="fish-marker" style="background:${colorOf(c.fish)}">🐟</div>`,
      iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16]
    });
    const m = L.marker([c.lat, c.lng], { icon });
    m.bindPopup(() => popupHtml(c));
    m.catchId = c.id;
    groupFor(c.fish).addLayer(m);
  }

  function popupHtml(c) {
    const d = new Date(c.date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    const bits = [];
    if (c.size) bits.push(`📏 ${c.size} cm`);
    if (c.weight) bits.push(`⚖️ ${c.weight} kg`);
    if (c.depth) bits.push(`🌊 prof. ${c.depth} m${c.depthSrc === 'carte' ? ' (carte)' : ''}`);
    const div = document.createElement('div');
    div.className = 'popup';
    div.innerHTML = `<h3>${esc(c.fish)}</h3>
      <p>${esc(d)}</p>
      ${bits.length ? `<p>${bits.join(' · ')}</p>` : ''}
      ${c.note ? `<p>${esc(c.note)}</p>` : ''}
      ${c.photo ? `<img src="${c.photo}" alt="Photo">` : ''}
      <button type="button">🗑️ Supprimer</button>`;
    div.querySelector('button').addEventListener('click', () => {
      if (confirm('Supprimer cette prise ?')) deleteCatch(c.id);
    });
    return div;
  }

  function deleteCatch(id) {
    catches = catches.filter(c => c.id !== id);
    save(KEY_CATCHES, catches);
    rebuildMarkers();
    renderLayers();
    map.closePopup();
  }

  function rebuildMarkers() {
    Object.values(groups).forEach(g => { g.clearLayers(); map.removeLayer(g); });
    Object.keys(groups).forEach(k => delete groups[k]);
    catches.forEach(addMarker);
  }

  // ---------- Géolocalisation ----------
  let me = null, meMarker = null, accCircle = null, firstFix = true;
  function onPos(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    me = { lat, lng, accuracy };
    if (!meMarker) {
      meMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        interactive: false, zIndexOffset: 1000
      }).addTo(map);
      accCircle = L.circle([lat, lng], { radius: accuracy, weight: 1, color: '#2563eb', fillOpacity: .08 }).addTo(map);
    } else {
      meMarker.setLatLng([lat, lng]);
      accCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }
    $('gps-status').textContent = `GPS ±${Math.round(accuracy)} m`;
    if (firstFix) { map.setView([lat, lng], 15); firstFix = false; }
  }
  function onPosErr(err) {
    $('gps-status').textContent = err.code === 1 ? 'GPS refusé' : 'GPS indisponible';
  }
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  } else {
    $('gps-status').textContent = 'GPS non supporté';
  }
  $('btn-locate').addEventListener('click', () => {
    if (me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 15));
    else toast('Position GPS pas encore disponible.');
  });

  // ---------- Panneau des calques ----------
  const panel = $('layers-panel');
  function renderLayers() {
    const list = $('layers-list');
    list.innerHTML = '';
    const counts = {};
    catches.forEach(c => counts[c.fish] = (counts[c.fish] || 0) + 1);
    const names = Object.keys(counts);
    if (!names.length) {
      list.innerHTML = '<li class="empty">Aucune prise enregistrée pour le moment.</li>';
      return;
    }
    names.sort().forEach(name => {
      const li = document.createElement('li');
      li.innerHTML = `<label>
          <input type="checkbox" ${hidden.has(name) ? '' : 'checked'}>
          <span class="dot" style="background:${colorOf(name)}"></span>
          <span>${esc(name)}</span>
        </label><span class="count">${counts[name]}</span>`;
      li.querySelector('input').addEventListener('change', (e) => toggleLayer(name, e.target.checked));
      list.appendChild(li);
    });
  }
  function toggleLayer(name, show) {
    const g = groupFor(name);
    if (show) { hidden.delete(name); g.addTo(map); }
    else { hidden.add(name); map.removeLayer(g); }
    save(KEY_HIDDEN, [...hidden]);
  }
  function setAll(show) {
    new Set(catches.map(c => c.fish)).forEach(n => toggleLayer(n, show));
    renderLayers();
  }
  $('btn-layers').addEventListener('click', () => { renderLayers(); panel.classList.toggle('hidden'); });
  document.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
  $('layers-all').addEventListener('click', () => setAll(true));
  $('layers-none').addEventListener('click', () => setAll(false));

  // Export / import
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ catches, customFish }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `carnet-peche-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const ids = new Set(catches.map(c => c.id));
      (data.catches || []).forEach(c => { if (!ids.has(c.id)) catches.push(c); });
      (data.customFish || []).map(normCustom).forEach(f => {
        if (f && f.name && !allFish().includes(f.name)) customFish.push(f);
      });
      save(KEY_CATCHES, catches); save(KEY_CUSTOM, customFish);
      rebuildMarkers(); renderLayers(); toast('Import terminé.');
    } catch { toast('Fichier invalide.'); }
    e.target.value = '';
  });

  // ---------- Modale de prise ----------
  const modal = $('modal');
  let selectedFish = null, photoData = null;

  // ----- Zone : eau douce / mer -----
  let waterKind = load(KEY_WATER, 'fresh') === 'sea' ? 'sea' : 'fresh';
  let waterUserPicked = false;
  const here = () => (me ? { lat: me.lat, lng: me.lng } : map.getCenter());
  const fishForKind = (kind) => [
    ...FISH[kind],
    ...customFish.filter(f => f.kind === kind || f.kind === 'any').map(f => f.name)
  ];
  function paintWater() {
    document.querySelectorAll('[data-water]').forEach(b =>
      b.classList.toggle('on', b.dataset.water === waterKind));
  }
  document.querySelectorAll('[data-water]').forEach(b => b.addEventListener('click', () => {
    waterKind = b.dataset.water;
    waterUserPicked = true;
    save(KEY_WATER, waterKind);
    paintWater();
    $('custom-box').classList.add('hidden');
    renderFishGrid();
  }));

  // Mer détectée si une cellule du modèle marin Open-Meteo existe à moins de ~10 km
  async function detectSea(lat, lng) {
    try {
      const r = await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lat.toFixed(4) +
        '&longitude=' + lng.toFixed(4) + '&current=sea_surface_temperature');
      if (!r.ok) return null;
      const j = await r.json();
      const near = Math.abs(j.latitude - lat) < 0.1 && Math.abs(j.longitude - lng) < 0.1;
      return !!(near && j.current && j.current.sea_surface_temperature != null);
    } catch { return null; }
  }

  // ----- Profondeur de la prise -----
  let depthEdited = false, depthFromMap = null;
  async function fetchMapDepth(lat, lng) {
    try {
      const r = await fetch('https://rest.emodnet-bathymetry.eu/depth_sample?geom=POINT(' +
        lng.toFixed(5) + '%20' + lat.toFixed(5) + ')');
      if (!r.ok) return null;
      const j = await r.json();
      const o = Array.isArray(j) ? j[0] : j;
      const v = o && (o.avg ?? o.value ?? o.depth);
      return typeof v === 'number' && v < 0 ? Math.round(-v * 10) / 10 : null; // altitude négative = profondeur
    } catch { return null; }
  }
  async function initDepth() {
    depthEdited = false; depthFromMap = null;
    const hint = $('depth-hint');
    hint.textContent = 'Saisissez la profondeur de votre sondeur (en mètres).';
    const p = here();
    const d = await fetchMapDepth(p.lat, p.lng);
    if (d == null || modal.classList.contains('hidden')) return;
    depthFromMap = d;
    hint.textContent = `Profondeur de la carte ici : ~${d} m (indicatif). Corrigez avec votre sondeur si besoin.`;
    if (!$('f-depth').value) $('f-depth').value = d;
  }
  function depthInfo() {
    const v = parseFloat($('f-depth').value);
    if (!isFinite(v) || v <= 0) return { depth: null, depthSrc: null };
    return { depth: v, depthSrc: (!depthEdited && v === depthFromMap) ? 'carte' : 'sondeur' };
  }
  $('f-depth').addEventListener('input', () => { depthEdited = true; });
  $('depth-auto').addEventListener('click', () => {
    if (depthFromMap == null) { toast('Profondeur de la carte indisponible ici.'); return; }
    $('f-depth').value = depthFromMap;
    depthEdited = false;
  });

  function renderFishGrid() {
    const grid = $('fish-grid');
    grid.innerHTML = '';
    fishForKind(waterKind).forEach(name => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fish-btn';
      b.innerHTML = `<span class="ico" style="background:${colorOf(name)}33">🐟</span><span>${esc(name)}</span>`;
      b.addEventListener('click', () => pickFish(name));
      grid.appendChild(b);
    });
    const other = document.createElement('button');
    other.type = 'button'; other.className = 'fish-btn other';
    other.innerHTML = '<span class="ico" style="background:#e5e7eb">➕</span><span>Autre…</span>';
    other.addEventListener('click', () => {
      $('custom-box').classList.remove('hidden');
      $('custom-name').focus();
    });
    grid.appendChild(other);
  }

  function openModal() {
    selectedFish = null; photoData = null;
    $('step-form').reset();
    $('photo-preview').classList.add('hidden');
    $('custom-box').classList.add('hidden');
    $('custom-name').value = '';
    $('step-form').classList.add('hidden');
    $('step-pick').classList.remove('hidden');
    $('modal-title').textContent = 'Quel poisson ?';
    waterUserPicked = false;
    paintWater();
    renderFishGrid();
    modal.classList.remove('hidden');

    // Détection automatique de la zone (l'utilisateur peut toujours corriger)
    const hint = $('water-hint');
    hint.textContent = '📍 Détection de la zone…';
    const p = here();
    detectSea(p.lat, p.lng).then(sea => {
      if (sea === null) { hint.textContent = 'Zone non détectée : choisissez eau douce ou mer.'; return; }
      hint.textContent = sea ? '📍 Zone détectée : mer / océan' : '📍 Zone détectée : eau douce';
      const detected = sea ? 'sea' : 'fresh';
      if (!waterUserPicked && detected !== waterKind) {
        waterKind = detected;
        paintWater();
        renderFishGrid();
      }
    });
  }
  const closeModal = () => modal.classList.add('hidden');

  function pickFish(name) {
    selectedFish = name;
    $('picked-badge').innerHTML = `<span class="dot" style="background:${colorOf(name)}"></span>${esc(name)}`;
    $('step-pick').classList.add('hidden');
    $('step-form').classList.remove('hidden');
    $('modal-title').textContent = 'Détails de la prise';
    $('pos-info').textContent = me
      ? `📍 Position GPS actuelle (±${Math.round(me.accuracy)} m)`
      : '📍 GPS indisponible : le centre de la carte sera utilisé.';
    initDepth();
  }

  $('btn-catch').addEventListener('click', openModal);
  $('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  $('back').addEventListener('click', () => {
    $('step-form').classList.add('hidden');
    $('step-pick').classList.remove('hidden');
    $('modal-title').textContent = 'Quel poisson ?';
  });

  function addCustom() {
    const raw = $('custom-name').value.trim().replace(/\s+/g, ' ');
    if (!raw) { toast('Saisis un nom de poisson.'); return; }
    const existing = allFish().find(n => n.toLowerCase() === raw.toLowerCase());
    if (existing) return pickFish(existing);
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    customFish.push({ name, kind: waterKind });
    save(KEY_CUSTOM, customFish);
    pickFish(name);
  }
  $('custom-ok').addEventListener('click', addCustom);
  $('custom-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

  // Photo : redimensionnement pour économiser le stockage
  function resizeImage(file, max = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }
  $('f-photo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    const prev = $('photo-preview');
    if (!f) { photoData = null; prev.classList.add('hidden'); return; }
    try {
      photoData = await resizeImage(f);
      prev.src = photoData; prev.classList.remove('hidden');
    } catch { toast('Photo illisible.'); }
  });

  $('step-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!selectedFish) return;
    const pos = me ? { lat: me.lat, lng: me.lng } : map.getCenter();
    const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : null; };
    const c = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      fish: selectedFish,
      lat: pos.lat, lng: pos.lng,
      size: num('f-size'), weight: num('f-weight'),
      ...depthInfo(), water: waterKind,
      photo: photoData, note: $('f-note').value.trim(),
      date: new Date().toISOString()
    };
    catches.push(c);
    if (!save(KEY_CATCHES, catches)) { catches.pop(); return; }
    hidden.delete(c.fish); save(KEY_HIDDEN, [...hidden]);
    rebuildMarkers();
    renderLayers();
    closeModal();
    map.setView([c.lat, c.lng], Math.max(map.getZoom(), 15));
    toast(`${c.fish} enregistré ! 🎉`);
  });

  // ---------- Init ----------
  rebuildMarkers();
  renderLayers();
  if (catches.length && !('geolocation' in navigator)) {
    map.fitBounds(L.latLngBounds(catches.map(c => [c.lat, c.lng])).pad(0.3));
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Emplacement réservé pour un éventuel service worker (mode hors-ligne)
  }
})();

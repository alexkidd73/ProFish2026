/* Spots de pêche : tombants, épaves, passages roche/sable… */
(function () {
  'use strict';
  const A = window.fishApp; if (!A || !window.L) return;
  const map = A.map, esc = A.esc, $ = id => document.getElementById(id);
  const KEY = 'peche.spots.v1', KEY_VIS = 'peche.spotsVisible.v1';
  const TYPES = {
    tombant: { label: 'Tombant', icon: '📉', color: '#6d4aa8' },
    epave: { label: 'Épave', icon: '🚢', color: '#b3402a' },
    roche: { label: 'Passage roche/sable', icon: '🪨', color: '#8a6d3b' },
    herbier: { label: 'Herbier', icon: '🌿', color: '#2e8b57' },
    autre: { label: 'Autre', icon: '📌', color: '#0b5d7a' }
  };
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const valid = s => s && s.id && isFinite(s.lat) && isFinite(s.lng);
  let spots = (read(KEY, []) || []).filter(valid);
  let visible = read(KEY_VIS, true) !== false, filter = 'all', editing = null, pos = null, picking = false;
  const group = L.layerGroup();
  if (visible) group.addTo(map);

  const typeOf = s => TYPES[s.type] || TYPES.autre;
  const dist = (a, b) => { // mètres
    const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const nearCatches = s => A.getCatches().filter(c => dist(s, c) <= 200).length;
  const label = s => s.name || typeOf(s).label + (s.type === 'autre' && s.label ? ' – ' + s.label : '');
  const kind = s => s.type === 'autre' && s.label ? s.label : typeOf(s).label;

  function popup(s) {
    const n = nearCatches(s);
    return `<div class="popup"><strong>${typeOf(s).icon} ${esc(label(s))}</strong><br>${esc(kind(s))}` +
      (s.depth != null ? `<br>Profondeur : ${esc(String(s.depth))} m` : '') +
      (s.note ? `<br>${esc(s.note)}` : '') +
      `<br>${n} prise${n > 1 ? 's' : ''} à moins de 200 m` +
      `<br><button class="edit" data-spot="${esc(s.id)}" data-act="edit">✏️ Modifier</button> <button class="del" data-spot="${esc(s.id)}" data-act="del">🗑️ Supprimer</button></div>`;
  }
  function redraw() {
    group.clearLayers();
    spots.forEach(s => {
      const t = typeOf(s);
      const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="spot-marker" style="background:${t.color}">${t.icon}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] }) });
      m.bindPopup(() => popup(s));
      group.addLayer(m);
    });
    renderList();
  }
  const save = () => { if (!write(KEY, spots)) { A.toast('Stockage plein : spot non enregistré.'); return false; } return true; };

  // ----- Liste -----
  function renderList() {
    const ul = $('spots-list'); if (!ul) return;
    const list = spots.filter(s => filter === 'all' || s.type === filter);
    $('spots-count').textContent = spots.length ? `${spots.length} spot${spots.length > 1 ? 's' : ''}` : 'Aucun spot pour l’instant.';
    ul.innerHTML = list.map(s => {
      const n = nearCatches(s);
      return `<li class="spot-item"><div class="spot-ico" style="background:${typeOf(s).color}">${typeOf(s).icon}</div><div class="spot-txt"><strong>${esc(label(s))}</strong><small>${esc(kind(s))}${s.depth != null ? ' · ' + esc(String(s.depth)) + ' m' : ''} · ${n} prise${n > 1 ? 's' : ''} (200 m)</small>${s.note ? `<small>${esc(s.note)}</small>` : ''}<small>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</small></div><div class="spot-btns"><button data-spot="${esc(s.id)}" data-act="go" class="chip">🗺️</button><button data-spot="${esc(s.id)}" data-act="edit" class="chip">✏️</button></div></li>`;
    }).join('');
    $('spots-filter').innerHTML = [['all', 'Tous']].concat(Object.entries(TYPES).map(([k, t]) => [k, t.icon + ' ' + t.label]))
      .map(([k, l]) => `<button type="button" class="chip${filter === k ? ' on' : ''}" data-filter="${k}">${l}</button>`).join('');
  }
  function goTo(s) {
    $('spots-panel').classList.add('hidden');
    if (!map.hasLayer(group)) { group.addTo(map); setVisible(true); }
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16));
    group.eachLayer(l => { const p = l.getLatLng(); if (p.lat === s.lat && p.lng === s.lng) l.openPopup(); });
  }
  function setVisible(v) {
    visible = v; write(KEY_VIS, v);
    if (v) group.addTo(map); else map.removeLayer(group);
    $('spots-toggle').textContent = v ? '👁️ Masquer sur la carte' : '👁️ Afficher sur la carte';
  }

  // ----- Formulaire -----
  function paintPos() {
    $('spot-pos').textContent = pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (${pos.src})` : 'Position inconnue';
  }
  function openForm(s) {
    editing = s || null;
    const g = A.getPos(), c = map.getCenter();
    pos = s ? { lat: s.lat, lng: s.lng, src: 'position enregistrée' } : g ? { lat: g.lat, lng: g.lng, src: 'GPS' } : { lat: c.lat, lng: c.lng, src: 'centre de la carte' };
    $('spot-title').textContent = s ? 'Modifier le spot' : 'Nouveau spot';
    $('spot-type').value = s ? s.type : 'tombant';
    $('spot-label').value = s && s.label || ''; $('spot-name').value = s && s.name || '';
    $('spot-depth').value = s && s.depth != null ? s.depth : ''; $('spot-note').value = s && s.note || '';
    $('spot-del').classList.toggle('hidden', !s);
    $('spot-label-row').classList.toggle('hidden', $('spot-type').value !== 'autre');
    paintPos(); $('spots-panel').classList.add('hidden'); $('spot-modal').classList.remove('hidden');
  }
  $('spot-type').innerHTML = Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.icon} ${t.label}</option>`).join('');
  $('spot-type').addEventListener('change', e => $('spot-label-row').classList.toggle('hidden', e.target.value !== 'autre'));
  const closeForm = () => $('spot-modal').classList.add('hidden');
  $('spot-close').addEventListener('click', closeForm);
  $('spot-me').addEventListener('click', () => {
    const g = A.getPos(); if (!g) return A.toast('Position GPS indisponible.');
    pos = { lat: g.lat, lng: g.lng, src: 'GPS' }; paintPos();
  });
  function onPick(e) { endPick({ lat: e.latlng.lat, lng: e.latlng.lng, src: 'choisie sur la carte' }); }
  function endPick(p) {
    picking = false; map.off('click', onPick); $('spot-banner').classList.add('hidden');
    if (p) { pos = p; paintPos(); }
    $('spot-modal').classList.remove('hidden');
  }
  $('spot-pick').addEventListener('click', () => {
    picking = true; $('spot-modal').classList.add('hidden'); $('spot-banner').classList.remove('hidden'); map.on('click', onPick);
  });
  $('spot-cancel-pick').addEventListener('click', () => endPick(null));
  $('spot-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!pos) return A.toast('Choisissez une position.');
    const d = $('spot-depth').value.trim(), depth = d === '' ? null : Number(d);
    if (depth != null && (!isFinite(depth) || depth < 0)) return A.toast('Profondeur invalide.');
    const type = $('spot-type').value, now = new Date().toISOString();
    const data = { type, label: type === 'autre' ? $('spot-label').value.trim() : '', name: $('spot-name').value.trim(), depth, note: $('spot-note').value.trim(), lat: pos.lat, lng: pos.lng };
    const before = spots.slice();
    if (editing) Object.assign(editing, data, { updated: now });
    else spots.push(Object.assign({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: now }, data));
    if (!save()) { spots = before; return; }
    if (!visible) setVisible(true);
    closeForm(); redraw(); A.toast(editing ? 'Spot modifié.' : 'Spot enregistré.');
  });
  $('spot-del').addEventListener('click', () => remove(editing));
  function remove(s) {
    if (!s || !confirm('Supprimer ce spot ? Vos prises ne sont pas touchées.')) return;
    const before = spots.slice(); spots = spots.filter(x => x.id !== s.id);
    if (!save()) { spots = before; return; }
    closeForm(); map.closePopup(); redraw();
  }

  // ----- Événements -----
  const byId = id => spots.find(s => s.id === id);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-spot]'); if (!b) return;
    const s = byId(b.dataset.spot); if (!s) return;
    if (b.dataset.act === 'go') goTo(s);
    else if (b.dataset.act === 'edit') { map.closePopup(); openForm(s); }
    else if (b.dataset.act === 'del') remove(s);
  });
  $('spots-filter').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; renderList(); } });
  $('btn-spots').addEventListener('click', () => { renderList(); $('spots-panel').classList.toggle('hidden'); });
  $('spot-add').addEventListener('click', () => openForm(null));
  $('spots-toggle').addEventListener('click', () => setVisible(!visible));
  $('spots-toggle').textContent = visible ? '👁️ Masquer sur la carte' : '👁️ Afficher sur la carte';

  window.fishSpots = { get: () => spots };
  redraw();
})();

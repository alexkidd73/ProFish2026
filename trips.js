/* Sorties de pêche : durée, trajet GPS, conditions, rendement ; bandeau « prise express » */
(function () {
  'use strict';
  const A = window.fishApp; if (!A || !window.L) return;
  const map = A.map, esc = A.esc, $ = id => document.getElementById(id);
  const KEY = 'peche.trips.v1';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const MAX_PTS = 3000;
  let trips = (read(KEY, []) || []).filter(t => t && t.id && t.start);
  const save = () => write(KEY, trips);
  const active = () => trips.find(t => !t.end) || null;
  const ms = t => new Date(t).getTime();

  // Une sortie restée ouverte plus de 18 h sans activité est clôturée à sa dernière position
  (function closeStale() {
    const t = active(); if (!t) return;
    const lastT = t.track && t.track.length ? t.track[t.track.length - 1][2] : ms(t.start);
    if (Date.now() - lastT > 18 * 3600e3) { t.end = new Date(lastT).toISOString(); save(); }
  })();

  const dist = (a, b) => {
    const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const length = t => { let d = 0; const p = t.track || []; for (let i = 1; i < p.length; i++) d += dist(p[i - 1], p[i]); return d; };
  const endOf = t => t.end ? ms(t.end) : Date.now();
  const hours = t => Math.max(0, (endOf(t) - ms(t.start)) / 3600e3);
  const catchesOf = t => A.getCatches().filter(c => { const d = ms(c.date); return d >= ms(t.start) && d <= endOf(t); });
  const fmtDur = h => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
  const fmtKm = m => m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m';
  const rate = (n, h) => h > 0 ? (n / h).toFixed(1).replace('.', ',') : '–';
  const dayF = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeF = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ----- Trajet -----
  let live = null, shown = null;
  const style = { color: '#e11d48', weight: 4, opacity: .85 };
  function drawLive() {
    const t = active();
    if (!t) { if (live) { map.removeLayer(live); live = null; } return; }
    const pts = (t.track || []).map(p => [p[0], p[1]]);
    if (!live) live = L.polyline(pts, style).addTo(map); else live.setLatLngs(pts);
  }
  function showTrack(t) {
    if (shown) { map.removeLayer(shown); shown = null; }
    const pts = (t.track || []).map(p => [p[0], p[1]]);
    if (pts.length < 2) { A.toast('Aucun trajet enregistré pour cette sortie.'); return; }
    shown = L.polyline(pts, { color: '#7c3aed', weight: 4, opacity: .85 }).addTo(map);
    $('trips-panel').classList.add('hidden');
    map.fitBounds(shown.getBounds().pad(0.2));
  }

  function ensureCond(t, pos) {
    if (t.cond || t.condBusy || !window.FishCond) return;
    t.condBusy = true;
    const date = new Date(t.start), o = { lat: pos.lat, lng: pos.lng, date: date.toISOString(), cond: FishCond.base(date) };
    FishCond.enrich(o).then(() => { t.cond = o.cond; delete t.condBusy; save(); renderPanel(); }).catch(() => { delete t.condBusy; });
  }
  // Enregistrement du trajet : un point tous les ~15 m
  A.onFix(pos => {
    const t = active(); if (!t) return;
    ensureCond(t, pos);
    if (pos.accuracy > 60) return;
    t.track = t.track || [];
    const last = t.track[t.track.length - 1], p = [+pos.lat.toFixed(6), +pos.lng.toFixed(6), Date.now()];
    if (last && dist(last, p) < 15) return;
    t.track.push(p);
    if (t.track.length > MAX_PTS) t.track = t.track.filter((_, i) => i % 2 === 0 || i === t.track.length - 1);
    save(); drawLive(); paintPill();
  });

  // ----- Écran allumé -----
  let lock = null;
  async function wake(on) {
    try {
      if (on && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch { lock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && active()) wake(true); });

  // ----- Démarrer / terminer -----
  function start() {
    if (active()) return;
    const g = A.getPos(), now = new Date();
    const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), start: now.toISOString(), end: null, track: [] };
    if (g) t.track.push([+g.lat.toFixed(6), +g.lng.toFixed(6), Date.now()]);
    trips.push(t);
    if (!save()) { trips.pop(); A.toast('Stockage plein : sortie non démarrée.'); return; }
    wake(true); drawLive(); paintPill(); renderPanel();
    $('trips-panel').classList.add('hidden'); // libère le bouton « J'ai pêché »
    const pos = g || map.getCenter(); ensureCond(t, { lat: pos.lat, lng: pos.lng });
    A.toast('Sortie démarrée 🎣 — gardez l’écran allumé pour le trajet.');
  }
  function stop() {
    const t = active(); if (!t) return;
    if (!confirm('Terminer la sortie ?')) return;
    t.end = new Date().toISOString(); save();
    wake(false); drawLive(); paintPill(); renderPanel();
    const n = catchesOf(t).length;
    A.toast(`Sortie terminée : ${fmtDur(hours(t))}, ${n} prise${n > 1 ? 's' : ''}.`);
  }
  function remove(id) {
    const t = trips.find(x => x.id === id); if (!t || !confirm('Supprimer cette sortie ? Vos prises ne sont pas touchées.')) return;
    const before = trips.slice(); trips = trips.filter(x => x.id !== id);
    if (!save()) { trips = before; return; }
    if (shown) { map.removeLayer(shown); shown = null; }
    drawLive(); paintPill(); renderPanel();
  }

  // ----- Bandeau de sortie en cours -----
  function paintPill() {
    const t = active(), pill = $('trip-pill'); if (!pill) return;
    pill.classList.toggle('hidden', !t);
    if (t) { const n = catchesOf(t).length; pill.textContent = `🎣 ${fmtDur(hours(t))} · ${n} prise${n > 1 ? 's' : ''} · ${fmtKm(length(t))}`; }
  }
  setInterval(paintPill, 30000);
  $('trip-pill').addEventListener('click', () => { renderPanel(); $('trips-panel').classList.remove('hidden'); });

  // ----- Panneau -----
  function condText(t) {
    const k = t.cond; if (!k) return '';
    const out = [];
    if (k.air != null) out.push(`🌡️ ${k.air} °C`);
    if (k.sea != null) out.push(`🌊 eau ${k.sea} °C`);
    if (k.wind != null) out.push(`💨 ${Math.round(k.wind)} kt`);
    if (k.press != null) out.push(`⏲️ ${k.press} hPa`);
    return out.join(' · ');
  }
  function renderPanel() {
    const box = $('trips-body'); if (!box) return;
    const a = active();
    let html = a
      ? `<div class="trip-active"><strong>🎣 Sortie en cours</strong><br>Depuis ${timeF.format(new Date(a.start))} · ${fmtDur(hours(a))} · ${fmtKm(length(a))} · ${catchesOf(a).length} prise(s)<button id="trip-stop" type="button" class="primary danger-btn">⏹️ Terminer la sortie</button><p class="hint">Gardez l’écran allumé : le navigateur ne suit pas le GPS en arrière-plan.</p></div>`
      : '<button id="trip-start" type="button" class="primary">▶️ Démarrer une sortie</button><p class="hint">Enregistre le trajet, la durée et les conditions. Les sorties sans prise comptent aussi : elles permettent de calculer un vrai rendement dans les statistiques.</p>';
    const done = trips.filter(t => t.end).sort((x, y) => ms(y.start) - ms(x.start));
    html += done.length ? done.map(t => {
      const n = catchesOf(t).length, h = hours(t);
      return `<div class="trip"><div><strong>${esc(dayF.format(new Date(t.start)))}</strong> · ${timeF.format(new Date(t.start))}–${timeF.format(new Date(t.end))}</div>
        <div>⏱️ ${fmtDur(h)} · 📏 ${fmtKm(length(t))} · 🐟 ${n} prise${n > 1 ? 's' : ''} · <strong>${rate(n, h)}/h</strong>${n ? '' : ' · bredouille'}</div>
        ${condText(t) ? `<small>${esc(condText(t))}</small>` : ''}
        <div class="sheet-actions"><button type="button" class="chip" data-trip="${esc(t.id)}" data-act="show">🗺️ Trajet</button><button type="button" class="chip" data-trip="${esc(t.id)}" data-act="del">🗑️</button></div></div>`;
    }).join('') : '<p class="backup-status">Aucune sortie terminée.</p>';
    box.innerHTML = html;
  }
  $('trips-body').addEventListener('click', e => {
    if (e.target.closest('#trip-start')) return start();
    if (e.target.closest('#trip-stop')) return stop();
    const b = e.target.closest('[data-trip]'); if (!b) return;
    const t = trips.find(x => x.id === b.dataset.trip); if (!t) return;
    if (b.dataset.act === 'show') showTrack(t); else remove(t.id);
  });
  $('btn-trip').addEventListener('click', () => { renderPanel(); $('trips-panel').classList.toggle('hidden'); });
  document.addEventListener('peche:catch-saved', paintPill);

  // ----- Prise express : confirmation avec « Compléter » / « Annuler » -----
  let barTimer = null;
  document.addEventListener('peche:catch-saved', e => {
    const { catch: c, express } = e.detail || {}; if (!express || !c) return;
    const bar = $('express-bar');
    bar.innerHTML = `<span>✅ ${esc(c.fish)} enregistré</span><button type="button" class="chip" id="ex-edit">Compléter</button><button type="button" class="chip" id="ex-undo">Annuler</button>`;
    bar.classList.remove('hidden');
    clearTimeout(barTimer); barTimer = setTimeout(() => bar.classList.add('hidden'), 10000);
    $('ex-edit').onclick = () => { bar.classList.add('hidden'); A.startEdit(c.id); };
    $('ex-undo').onclick = () => { bar.classList.add('hidden'); A.deleteCatch(c.id); A.toast('Prise annulée.'); paintPill(); };
  });

  window.fishTrips = { get: () => trips, hoursOf: hours, catchesOf, length };
  drawLive(); paintPill(); if (active()) wake(true);
})();

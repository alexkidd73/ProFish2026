/* Conditions de pêche : lune, marée et météo au moment d'une prise.
   Données : Open-Meteo (sans clé). Chargé AVANT app.js. */
(() => {
  'use strict';

  const KMH_TO_KT = 1 / 1.852;
  const F_URL = 'https://api.open-meteo.com/v1/forecast';
  const M_URL = 'https://marine-api.open-meteo.com/v1/marine';
  const MAX_PAST_DAYS = 92;
  const HOUR = 3600e3;

  // ---------- Lune (calcul local, approximation par la lunaison moyenne : ±~0,5 jour) ----------
  const MOONS = [
    ['Nouvelle lune', '🌑'], ['Premier croissant', '🌒'], ['Premier quartier', '🌓'], ['Gibbeuse croissante', '🌔'],
    ['Pleine lune', '🌕'], ['Gibbeuse décroissante', '🌖'], ['Dernier quartier', '🌗'], ['Dernier croissant', '🌘']
  ];
  const SYNODIC = 29.530588853;
  const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

  function moonInfo(ms) {
    const age = ((((ms - REF_NEW_MOON) / 864e5) % SYNODIC) + SYNODIC) % SYNODIC;
    const i = Math.floor((age / SYNODIC) * 8 + 0.5) % 8;
    const illum = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100);
    return { i, name: MOONS[i][0], emoji: MOONS[i][1], illum };
  }

  // ---------- Utilitaires ----------
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const toMs = (s) => Date.parse(s + 'Z'); // l'API renvoie des heures GMT (timezone=GMT)
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const fmtDur = (min) => {
    const m = Math.max(0, Math.round(min));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${String(m % 60).padStart(2, '0')}`;
  };
  function nearest(ms, arr) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - ms);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: bd };
  }
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const query = (lat, lng, hourly, past, fwd) =>
    `?latitude=${Number(lat).toFixed(4)}&longitude=${Number(lng).toFixed(4)}&hourly=${hourly}` +
    `&past_days=${past}&forecast_days=${fwd}&timezone=GMT`;

  // ---------- Marée : extrêmes (pleines / basses mers) à partir du niveau horaire ----------
  function extremes(tms, lv) {
    const out = [];
    for (let j = 1; j < lv.length - 1; j++) {
      const a = lv[j - 1], b = lv[j], c = lv[j + 1];
      if (a == null || b == null || c == null) continue;
      const isHigh = b > a && b >= c;
      const isLow = b < a && b <= c;
      if (!isHigh && !isLow) continue;
      const den = a - 2 * b + c;
      const off = den ? (0.5 * (a - c)) / den : 0;          // affinage par parabole (heures)
      const level = b - 0.25 * (a - c) * off;
      out.push({ ms: tms[j] + off * HOUR, level, type: isHigh ? 'PM' : 'BM' });
    }
    return out;
  }
  // Retire les petites oscillations parasites (deux extrêmes de même type ou trop rapprochés)
  function cleanExtremes(ex) {
    const out = [];
    for (const e of ex) {
      const last = out[out.length - 1];
      if (last && last.type === e.type) {
        if ((e.type === 'PM' && e.level > last.level) || (e.type === 'BM' && e.level < last.level)) out[out.length - 1] = e;
        continue;
      }
      if (last && e.ms - last.ms < 2.5 * HOUR) continue;
      out.push(e);
    }
    return out;
  }
  function tideAt(tms, lv, ms) {
    const n = nearest(ms, tms);
    if (n.i < 1 || n.i > tms.length - 2 || n.d > 1.5 * HOUR || lv[n.i] == null) return null;
    const ex = cleanExtremes(extremes(tms, lv));
    const prev = [...ex].reverse().find((e) => e.ms <= ms);
    const next = ex.find((e) => e.ms > ms);
    const win = lv.filter((v, k) => v != null && Math.abs(tms[k] - ms) <= 13 * HOUR);
    const range = win.length ? Math.max(...win) - Math.min(...win) : null;
    const slope = lv[n.i + 1] != null && lv[n.i - 1] != null ? (lv[n.i + 1] - lv[n.i - 1]) / 2 : 0; // m/h
    const trend = Math.abs(slope) < 0.01 ? 'slack' : slope > 0 ? 'up' : 'down';
    return {
      lvl: r2(lv[n.i]), trend,
      last: prev ? prev.type : null, ago: prev ? Math.round((ms - prev.ms) / 60000) : null,
      next: next ? next.type : null, inMin: next ? Math.round((next.ms - ms) / 60000) : null,
      range: range == null ? null : r2(range),
      weak: range != null && range < 0.4 // Méditerranée : marée quasi nulle, le modèle est surtout piloté par la pression
    };
  }

  // ---------- Conditions associées à une prise ----------
  const moonCompact = (ms) => { const m = moonInfo(ms); return { i: m.i, ill: m.illum }; };
  const base = (date) => ({ v: 1, moon: moonCompact(new Date(date).getTime()), pending: true });

  async function enrich(c) {
    const t = new Date(c.date).getTime();
    const cond = c.cond || base(c.date);
    c.cond = cond;
    if (!cond.moon) cond.moon = moonCompact(t);
    const days = Math.floor((Date.now() - t) / 864e5) + 1;
    if (days > MAX_PAST_DAYS) { cond.pending = false; return; } // trop ancien pour l'historique gratuit
    const past = Math.max(1, days);

    let f, m;
    try {
      [f, m] = await Promise.all([
        getJSON(F_URL + query(c.lat, c.lng, 'temperature_2m,wind_speed_10m,wind_direction_10m,pressure_msl', past, 2) + '&wind_speed_unit=kn'),
        getJSON(M_URL + query(c.lat, c.lng, 'sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl', past, 2))
          .catch((e) => (e && e.status ? null : Promise.reject(e))) // hors mer : pas de données marines
      ]);
    } catch (e) {
      if (e && e.status) { cond.pending = false; return; } // refus définitif du service
      throw e; // pas de réseau : on réessaiera plus tard
    }

    if (f && f.hourly) {
      const h = f.hourly, tms = h.time.map(toMs), n = nearest(t, tms);
      if (n.d <= 1.5 * HOUR) {
        const g = (a) => (a && a[n.i] != null ? a[n.i] : null);
        const air = g(h.temperature_2m), wind = g(h.wind_speed_10m), dir = g(h.wind_direction_10m), pr = g(h.pressure_msl);
        if (air != null) cond.air = r1(air);
        if (wind != null) cond.wind = r1(wind);
        if (dir != null) cond.windDir = Math.round(dir);
        if (pr != null) cond.press = Math.round(pr);
      }
    }
    if (m && m.hourly && m.hourly.time) {
      const near = Math.abs(m.latitude - c.lat) < 0.15 && Math.abs(((m.longitude - c.lng + 540) % 360) - 180) < 0.15;
      const h = m.hourly, tms = h.time.map(toMs), n = nearest(t, tms);
      if (near && n.d <= 1.5 * HOUR) {
        const g = (a) => (a && a[n.i] != null ? a[n.i] : null);
        const sea = g(h.sea_surface_temperature), cur = g(h.ocean_current_velocity), cdir = g(h.ocean_current_direction);
        if (sea != null) cond.sea = r1(sea);
        if (cur != null) cond.cur = r1(cur * KMH_TO_KT);
        if (cdir != null) cond.curDir = Math.round(cdir);
        if (h.sea_level_height_msl) {
          const td = tideAt(tms, h.sea_level_height_msl, t);
          if (td) cond.tide = td;
        }
      }
    }
    cond.pending = false;
  }

  // Complète les prises sans conditions (anciennes prises, ou saisies hors réseau)
  let running = false;
  async function backfill(getList, persist, refresh) {
    if (running || navigator.onLine === false) return;
    running = true;
    try {
      for (const c of getList().slice()) {
        if (c.cond && !c.cond.pending) continue;
        try { await enrich(c); persist(); refresh(); } catch { break; } // hors ligne : on réessaiera
      }
    } finally { running = false; }
  }

  // ---------- Affichage ----------
  function lines(c) {
    const k = c && c.cond;
    if (!k) return [];
    const out = [];
    if (k.wind != null) out.push(`💨 ${Math.round(k.wind)} kt${k.windDir != null ? ' de ' + compass(k.windDir) : ''}`);
    if (k.air != null) out.push(`🌡️ air ${Math.round(k.air)}°`);
    if (k.sea != null) out.push(`🌊 eau ${k.sea}°`);
    if (k.cur != null) out.push(`🧭 courant ${k.cur.toFixed(1)} kt${k.curDir != null ? ' vers ' + compass(k.curDir) : ''}`);
    if (k.press != null) out.push(`⏲️ ${k.press} hPa`);
    if (k.tide) {
      const t = k.tide;
      if (t.weak) out.push('↕️ marée très faible');
      else {
        const w = t.trend === 'up' ? '⬆️ marée montante' : t.trend === 'down' ? '⬇️ marée descendante' : '⏸️ étale';
        const since = t.last ? `, ${fmtDur(t.ago)} après la ${t.last === 'PM' ? 'pleine' : 'basse'} mer` : '';
        out.push(w + since);
      }
    }
    if (k.moon && MOONS[k.moon.i]) out.push(`${MOONS[k.moon.i][1]} ${MOONS[k.moon.i][0].toLowerCase()}`);
    return out;
  }
  const summary = (c) => lines(c).join(' · '); // texte sûr (aucune saisie utilisateur)

  window.FishCond = {
    MOONS, moonInfo, base, enrich, backfill, lines, summary,
    toMs, nearest, extremes, cleanExtremes, tideAt, compass, fmtDur
  };
})();

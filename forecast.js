/* Page « Prévisions » : météo marine sur une date (8 jours), Open-Meteo. Chargé APRÈS app.js et conditions.js. */
(() => {
  'use strict';

  const A = window.fishApp, C = window.FishCond;
  if (!A || !C) return;
  const $ = (id) => document.getElementById(id);
  const { esc } = A;
  const F_URL = 'https://api.open-meteo.com/v1/forecast';
  const M_URL = 'https://marine-api.open-meteo.com/v1/marine';
  const KMH_TO_KT = 1 / 1.852;
  const MAX_AGE = 15 * 60e3;

  const F_HOURLY = 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl';
  const F_HOURLY_CORE = 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m';
  const F_DAILY = 'sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum';
  const F_DAILY_CORE = 'sunrise,sunset';
  const M_HOURLY = 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl';
  const M_HOURLY_CORE = 'wave_height,wave_period,wave_direction,sea_surface_temperature';

  const page = $('forecast-page');
  let data = null;               // { pos, ts, f, m, cached, cachedAt }
  let selDate = null;            // 'AAAA-MM-JJ'
  let step = 3;                  // pas du tableau : 3 h ou 1 h
  let locMode = 'me';            // 'me' | 'center'

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const r0 = (v) => Math.round(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const nums = (arr, idx) => idx.map((i) => arr && arr[i]).filter(isNum);
  const rng = (lo, hi, f) => (f(lo) === f(hi) ? `${f(lo)}` : `${f(lo)}–${f(hi)}`); // « 14 » plutôt que « 14–14 »
  const minmax = (a) => (a.length ? [Math.min(...a), Math.max(...a)] : null);

  // ---------- Réseau ----------
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const json = await r.json();
    return { json, cached: r.headers.get('X-From-Cache') === '1', date: r.headers.get('Date') };
  }
  // Si une variable est refusée (400), on retente avec le jeu minimal
  async function getWithFallback(base, q, full, core) {
    try { return await getJSON(`${base}?${q}&${full}`); }
    catch (e) { if (e && e.status === 400) return getJSON(`${base}?${q}&${core}`); throw e; }
  }
  async function load(pos) {
    const q = `latitude=${pos.lat.toFixed(4)}&longitude=${pos.lng.toFixed(4)}&timezone=auto&forecast_days=8`;
    const [f, m] = await Promise.all([
      getWithFallback(F_URL, q + '&wind_speed_unit=kn',
        `hourly=${F_HOURLY}&daily=${F_DAILY}`, `hourly=${F_HOURLY_CORE}&daily=${F_DAILY_CORE}`),
      getWithFallback(M_URL, q, `hourly=${M_HOURLY}`, `hourly=${M_HOURLY_CORE}`)
        .catch((e) => (e && e.status ? null : Promise.reject(e))) // hors mer : pas de données marines
    ]);
    return { pos, ts: Date.now(), f: f.json, m: m ? m.json : null, cached: f.cached || !!(m && m.cached), cachedAt: f.date };
  }

  // ---------- Repères de couleur (indicatifs, petite embarcation) ----------
  const windLvl = (kt) => (kt < 10 ? 'g' : kt < 17 ? 'o' : 'r');
  const gustLvl = (kt) => (kt < 15 ? 'g' : kt < 22 ? 'o' : 'r');
  const waveLvl = (m) => (m < 0.5 ? 'g' : m < 1.25 ? 'o' : 'r');
  const arrow = (deg, title) =>
    `<span class="arr" style="transform:rotate(${((deg + 180) % 360).toFixed(0)}deg)" title="${esc(title)}">↑</span>`;

  // ---------- Données marines alignées sur l'axe horaire ----------
  function marineSeries() {
    const m = data.m;
    if (!m || !m.hourly || !m.hourly.time) return null;
    const near = Math.abs(m.latitude - data.pos.lat) < 0.15 && Math.abs(((m.longitude - data.pos.lng + 540) % 360) - 180) < 0.15;
    if (!near) return null;
    const h = m.hourly;
    const any = ['wave_height', 'sea_surface_temperature', 'sea_level_height_msl', 'ocean_current_velocity']
      .some((k) => h[k] && h[k].some(isNum));
    if (!any) return null;
    const byTime = new Map(h.time.map((t, i) => [t, i]));
    return { h, byTime };
  }

  // ---------- Rendu ----------
  function dayLabel(d, i) {
    if (i === 0) return "Aujourd'hui";
    if (i === 1) return 'Demain';
    const [y, mo, da] = d.split('-').map(Number);
    return new Date(y, mo - 1, da).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  }
  function paintDays() {
    const days = data.f.daily.time;
    $('fc-days').innerHTML = days.map((d, i) =>
      `<button type="button" class="fc-day${d === selDate ? ' on' : ''}" data-d="${esc(d)}">${esc(dayLabel(d, i))}</button>`).join('');
  }
  function paintWhere() {
    const p = data ? data.pos : null;
    $('fc-where').textContent = p ? `📍 ${p.src} (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})` : '';
    $('fc-loc-toggle').textContent = locMode === 'me' ? '🗺️ Centre de la carte' : '📍 Ma position';
    $('fc-loc-toggle').classList.toggle('hidden', locMode === 'me' ? false : !A.getPos());
  }

  function dayCurve(tms, lv, idxs, nowFake) {
    const pts = idxs.filter((i) => isNum(lv[i])).map((i) => [tms[i], lv[i]]);
    if (pts.length < 3) return '';
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 0.05) { hi += 0.025; lo -= 0.025; }
    const W = 320, H = 100, pad = 8;
    const x = (t) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
    const now = nowFake >= t0 && nowFake <= t1
      ? `<line x1="${x(nowFake).toFixed(1)}" x2="${x(nowFake).toFixed(1)}" y1="4" y2="${H - 4}" stroke="#e11d48" stroke-width="1.5" stroke-dasharray="4 3"/>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="tide-svg" role="img" aria-label="Niveau de la mer sur la journée">
      <path d="${d}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${now}</svg>
      <div class="tide-axis"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>`;
  }

  function render() {
    const body = $('fc-body');
    if (!data) return;
    const f = data.f, h = f.hourly, d = selDate;
    paintDays(); paintWhere();
    const di = f.daily.time.indexOf(d);
    const idxAll = [];
    h.time.forEach((t, i) => { if (t.startsWith(d)) idxAll.push(i); });
    if (!idxAll.length) { body.innerHTML = '<p class="empty">Pas de données pour cette date.</p>'; return; }
    const hourOf = (i) => Number(h.time[i].slice(11, 13));
    const day = idxAll.filter((i) => hourOf(i) >= 5 && hourOf(i) <= 21);
    const off = f.utc_offset_seconds || 0;
    const nowFake = Date.now() + off * 1000;
    const nowStr = new Date(nowFake).toISOString().slice(0, 13); // « AAAA-MM-JJTHH »
    const sunrise = f.daily.sunrise && f.daily.sunrise[di], sunset = f.daily.sunset && f.daily.sunset[di];

    const ms = marineSeries();
    const mIdx = (i) => (ms ? ms.byTime.get(h.time[i]) : undefined);
    const mArr = (k) => (ms && ms.h[k]) || null;
    const mAt = (k, i) => { const a = mArr(k), j = mIdx(i); return a && j != null && isNum(a[j]) ? a[j] : null; };

    // ----- Résumé (5 h – 21 h) -----
    const wind = minmax(nums(h.wind_speed_10m, day)), gust = minmax(nums(h.wind_gusts_10m, day));
    const waves = minmax(day.map((i) => mAt('wave_height', i)).filter(isNum));
    const wavesT = day.map((i) => mAt('wave_period', i)).filter(isNum);
    const sea = day.map((i) => mAt('sea_surface_temperature', i)).filter(isNum);
    const air = minmax(nums(h.temperature_2m, day));
    const rain = idxAll.map((i) => h.precipitation && h.precipitation[i]).filter(isNum).reduce((a, b) => a + b, 0);
    const p6 = h.pressure_msl && h.pressure_msl[idxAll.find((i) => hourOf(i) === 6)];
    const p18 = h.pressure_msl && h.pressure_msl[idxAll.find((i) => hourOf(i) === 18)];
    const [yy, mo, da] = d.split('-').map(Number);
    const moon = C.moonInfo(Date.UTC(yy, mo - 1, da, 12));

    const tile = (v, l, cls = '') => `<div class="ftile ${cls}"><strong>${v}</strong><span>${l}</span></div>`;
    let html = '';
    if (data.cached) {
      html += `<div class="tide-warn">📴 Hors ligne : dernières prévisions enregistrées${
        data.cachedAt ? ' (' + esc(new Date(data.cachedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })) + ')' : ''}.</div>`;
    }
    html += '<div class="ftiles">' +
      (wind ? tile(`${rng(wind[0], wind[1], r0)} kt`, `Vent${gust ? ' · rafales ' + r0(gust[1]) : ''}`, 'l-' + windLvl(wind[1])) : '') +
      (waves ? tile(`${rng(waves[0], waves[1], r1)} m`, `Vagues${wavesT.length ? ' · ' + r0(Math.max(...wavesT)) + ' s' : ''}`, 'l-' + waveLvl(waves[1])) : '') +
      (air ? tile(`${rng(air[0], air[1], r0)} °C`, 'Air') : '') +
      (sea.length ? tile(`${r1(sea.reduce((a, b) => a + b, 0) / sea.length)} °C`, 'Eau') : '') +
      tile(rain > 0.05 ? `${r1(rain)} mm` : 'Sec', 'Pluie (24 h)') +
      (isNum(p6) && isNum(p18) ? tile(`${r0(p18)} hPa ${p18 - p6 > 1 ? '↗' : p18 - p6 < -1 ? '↘' : '→'}`, 'Pression 6 h → 18 h') : '') +
      '</div>';
    html += `<div class="fc-sun">${sunrise ? `🌅 Lever <strong>${esc(sunrise.slice(11, 16))}</strong>` : ''}${
      sunset ? ` · 🌇 coucher <strong>${esc(sunset.slice(11, 16))}</strong>` : ''} · ${moon.emoji} ${esc(moon.name.toLowerCase())} (${moon.illum} %)</div>`;
    if (!ms) html += '<p class="hint">🌊 Pas de données marines pour ce point (vagues, courant, marée) : hors mer ou trop loin de la côte.</p>';

    // ----- Tableau horaire -----
    const rows = idxAll.filter((i) => hourOf(i) % step === 0).map((i) => {
      const hr = hourOf(i);
      const ws = h.wind_speed_10m && h.wind_speed_10m[i], wd = h.wind_direction_10m && h.wind_direction_10m[i];
      const g = h.wind_gusts_10m && h.wind_gusts_10m[i];
      const wh = mAt('wave_height', i), wp = mAt('wave_period', i);
      const cv = mAt('ocean_current_velocity', i), cd = mAt('ocean_current_direction', i);
      const pr = h.precipitation && h.precipitation[i];
      const night = (sunrise && h.time[i] < sunrise) || (sunset && h.time[i] > sunset);
      const isNow = h.time[i].slice(0, 13) === nowStr;
      return `<tr class="${night ? 'night' : ''}${isNow ? ' now' : ''}">
        <th scope="row">${String(hr).padStart(2, '0')} h</th>
        <td class="c-${isNum(ws) ? windLvl(ws) : 'n'}">${isNum(ws) ? (isNum(wd) ? arrow(wd, 'vent de ' + C.compass(wd)) : '') + ' ' + r0(ws) : '–'}</td>
        <td class="c-${isNum(g) ? gustLvl(g) : 'n'}">${isNum(g) ? r0(g) : '–'}</td>
        <td class="c-${isNum(wh) ? waveLvl(wh) : 'n'}">${isNum(wh) ? r1(wh) + ' m' + (isNum(wp) ? `<small>${r0(wp)} s</small>` : '') : '–'}</td>
        <td>${isNum(cv) ? (isNum(cd) ? arrow(cd - 180, 'courant vers ' + C.compass(cd)) : '') + ' ' + r1(cv * KMH_TO_KT) : '–'}</td>
        <td>${isNum(pr) && pr > 0.04 ? r1(pr) : '–'}</td></tr>`;
    }).join('');
    html += `<section class="stat"><h3>🕐 Heure par heure <small>vent en nœuds</small></h3>
      <div class="fc-scroll"><table class="fc-table"><thead><tr>
        <th>Heure</th><th>Vent</th><th>Raf.</th><th>Vagues</th><th>Courant</th><th>Pluie</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <div class="sheet-actions"><button type="button" id="fc-step" class="chip">${step === 3 ? '🔍 Toutes les heures' : '↕️ Toutes les 3 h'}</button></div>
      <p class="hint">Flèche du vent : direction vers laquelle il souffle. Courant en nœuds, pluie en mm. Lignes grisées : nuit.
        Couleurs <span class="lg g">calme</span> <span class="lg o">à surveiller</span> <span class="lg r">difficile</span> : repères indicatifs
        pour une petite embarcation, pas un avis de navigation.</p></section>`;

    // ----- Marée du jour -----
    if (ms && ms.h.sea_level_height_msl && ms.h.sea_level_height_msl.some(isNum)) {
      const lv = ms.h.sea_level_height_msl, tms = ms.h.time.map(C.toMs);
      const dIdx = [];
      ms.h.time.forEach((t, i) => { if (t.startsWith(d)) dIdx.push(i); });
      const vals = dIdx.map((i) => lv[i]).filter(isNum);
      const range = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
      html += '<section class="stat"><h3>🌊 Marée</h3>';
      if (range < 0.4) {
        html += `<div class="tide-warn">⚠️ <strong>Marée très faible ici</strong> (environ ${Math.round(range * 100)} cm sur la journée). En Méditerranée, le niveau de la mer dépend surtout de la pression et du vent : pas d'horaires de pleine ou basse mer significatifs.</div>`;
      } else {
        const ex = C.cleanExtremes(C.extremes(tms, lv)).filter((e) => new Date(e.ms).toISOString().slice(0, 10) === d);
        html += ex.length ? '<ul class="tide-list">' + ex.map((e) =>
          `<li><span>${e.type === 'PM' ? '▲ Pleine mer' : '▼ Basse mer'}</span><span>${new Date(e.ms).toISOString().slice(11, 16)}</span>` +
          `<span class="muted">${(e.level >= 0 ? '+' : '−') + Math.abs(e.level).toFixed(2)} m</span></li>`).join('') + '</ul>'
          : '<p class="hint">Pas de pleine ou basse mer détectée ce jour-là.</p>';
        html += dayCurve(tms, lv, dIdx, nowFake);
        html += `<p class="hint">Marnage de la journée : environ ${range.toFixed(2)} m. Hauteurs au-dessus du niveau moyen de la mer (pas le zéro des cartes). Les coefficients ne sont pas disponibles.</p>`;
      }
      html += '</section>';
    }

    html += `<p class="hint">Prévisions limitées à 8 jours (modèles Open-Meteo, résolution d'environ 8 à 25 km), moins fiables près des côtes et au-delà de 3 jours.
      <strong>Indicatif : consultez le bulletin Météo-France Marine ou la capitainerie avant de prendre la mer.</strong>
      Données : <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>.</p>`;
    body.innerHTML = html;
  }

  // ---------- Chargement ----------
  async function refresh(force) {
    const p = A.getPos();
    const useMe = locMode === 'me' && p;
    const c = A.map.getCenter();
    const pos = useMe ? { lat: p.lat, lng: p.lng, src: 'Votre position' } : { lat: c.lat, lng: c.lng, src: 'Centre de la carte' };
    const same = data && Math.abs(data.pos.lat - pos.lat) < 0.01 && Math.abs(data.pos.lng - pos.lng) < 0.01;
    if (!force && same && Date.now() - data.ts < MAX_AGE) { render(); return; }
    $('fc-body').innerHTML = '<p class="hint">Chargement des prévisions…</p>';
    try {
      data = await load(pos);
    } catch (e) {
      data = null;
      $('fc-days').innerHTML = '';
      $('fc-where').textContent = '';
      $('fc-body').innerHTML = `<p class="empty">${e && e.status
        ? 'Le service de prévisions ne répond pas pour ce lieu (erreur ' + esc(e.status) + ').'
        : 'Pas de connexion : impossible de charger les prévisions.'}</p>
        <div class="sheet-actions"><button type="button" id="fc-retry" class="chip strong">↻ Réessayer</button></div>`;
      return;
    }
    const days = data.f.daily.time;
    if (!selDate || !days.includes(selDate)) selDate = days[0];
    render();
  }

  // ---------- Ouverture / fermeture ----------
  let pushed = false;
  function openForecast() {
    $('tide-panel').classList.add('hidden');
    $('layers-panel').classList.add('hidden');
    locMode = A.getPos() ? 'me' : 'center';
    page.classList.remove('hidden');
    page.scrollTop = 0;
    pushed = location.hash !== '#previsions';
    if (pushed) history.pushState(null, '', '#previsions');
    refresh(false);
  }
  function closeForecast() {
    page.classList.add('hidden');
    if (location.hash === '#previsions') {
      if (pushed) { pushed = false; history.back(); }
      else history.replaceState(null, '', location.pathname + location.search);
    }
  }
  window.addEventListener('popstate', () => { if (location.hash !== '#previsions') page.classList.add('hidden'); });

  $('btn-forecast').addEventListener('click', openForecast);
  $('fc-back').addEventListener('click', closeForecast);
  $('fc-loc-toggle').addEventListener('click', () => { locMode = locMode === 'me' ? 'center' : 'me'; refresh(true); });
  $('fc-days').addEventListener('click', (e) => {
    const b = e.target.closest('.fc-day');
    if (!b) return;
    selDate = b.dataset.d;
    render();
    page.scrollTop = 0;
  });
  $('fc-body').addEventListener('click', (e) => {
    if (e.target.closest('#fc-step')) { step = step === 3 ? 1 : 3; render(); }
    else if (e.target.closest('#fc-retry')) refresh(true);
  });
  window.addEventListener('online', () => { if (!page.classList.contains('hidden') && !data) refresh(true); });
})();

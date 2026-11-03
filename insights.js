/* Panneau « Marées & lune » + page « Statistiques ». Chargé APRÈS app.js. */
(() => {
  'use strict';

  const A = window.fishApp, C = window.FishCond;
  if (!A || !C) return;
  const $ = (id) => document.getElementById(id);
  const { esc } = A;
  const HOUR = 3600e3;
  const F_URL = 'https://api.open-meteo.com/v1/forecast';
  const M_URL = 'https://marine-api.open-meteo.com/v1/marine';

  const timeFmt = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  function dayTime(ms) {
    const d = new Date(ms), n = new Date();
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
                             new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
    const pre = diff === 0 ? '' : diff === 1 ? 'demain ' : diff === -1 ? 'hier ' : d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ';
    return pre + timeFmt(ms);
  }
  const sign = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' m';

  // =====================================================
  // Panneau Marées & lune
  // =====================================================
  const tidePanel = $('tide-panel');

  function curve(tms, lv, now) {
    const t0 = now - 6 * HOUR, t1 = now + 30 * HOUR;
    const pts = [];
    tms.forEach((t, i) => { if (t >= t0 && t <= t1 && lv[i] != null) pts.push([t, lv[i]]); });
    if (pts.length < 3) return '';
    const ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 0.05) { hi += 0.025; lo -= 0.025; }
    const W = 320, H = 110, pad = 8;
    const x = (t) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="tide-svg" role="img" aria-label="Niveau de la mer sur 36 heures">
      <path d="${d}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="4" y2="${H - 4}" stroke="#e11d48" stroke-width="1.5" stroke-dasharray="4 3"/>
    </svg><div class="tide-axis"><span>−6 h</span><span>maintenant</span><span>+30 h</span></div>`;
  }

  async function loadTide() {
    const body = $('tide-body');
    body.innerHTML = '<p class="hint">Chargement…</p>';
    const p = A.getPos() || A.map.getCenter();
    const where = A.getPos() ? 'votre position' : 'le centre de la carte';
    const ll = `latitude=${p.lat.toFixed(4)}&longitude=${p.lng.toFixed(4)}`;
    const now = Date.now();
    const moon = C.moonInfo(now);

    const [m, f] = await Promise.all([
      fetch(`${M_URL}?${ll}&hourly=sea_level_height_msl&past_days=1&forecast_days=3&timezone=GMT`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${F_URL}?${ll}&daily=sunrise,sunset&timezone=auto&forecast_days=2`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ]);

    let html = `<p class="hint">Pour ${where}.</p>`;

    // Lune
    html += `<div class="tide-block"><div class="big">${moon.emoji}</div>
      <div><strong>${esc(moon.name)}</strong><br><span class="muted">${moon.illum} % éclairée${
        moon.i === 0 || moon.i === 4 ? ' · marées plus fortes (vives-eaux)' : ''}</span></div></div>`;

    // Soleil
    if (f && f.daily && f.daily.sunrise && f.daily.sunrise[0]) {
      html += `<div class="tide-block"><div class="big">🌅</div><div>
        <strong>Lever ${esc(f.daily.sunrise[0].slice(11, 16))}</strong> · <strong>coucher ${esc(f.daily.sunset[0].slice(11, 16))}</strong><br>
        <span class="muted">Aube et crépuscule : souvent les meilleurs moments.</span></div></div>`;
    }

    // Marée
    const lv = m && m.hourly && m.hourly.sea_level_height_msl;
    const tms = m && m.hourly && m.hourly.time ? m.hourly.time.map(C.toMs) : null;
    const near = m && Math.abs(m.latitude - p.lat) < 0.15 && Math.abs(((m.longitude - p.lng + 540) % 360) - 180) < 0.15;
    const hasSea = !!(lv && tms && near && lv.some((v) => v != null));

    if (!m && !f) {
      html += '<p class="hint">Pas de connexion : impossible de charger la marée.</p>';
    } else if (!hasSea) {
      html += '<p class="hint">🌊 Pas de données de marée ici (point hors mer, ou trop loin de la côte).</p>';
    } else {
      const st = C.tideAt(tms, lv, now);
      if (st && st.weak) {
        html += `<div class="tide-warn">⚠️ <strong>Marée très faible ici</strong> (environ ${Math.round((st.range || 0) * 100)} cm de variation).
          En Méditerranée, le niveau de la mer dépend surtout de la pression et du vent : les horaires de pleine et basse mer ne sont pas significatifs.</div>`;
      } else if (st) {
        const word = st.trend === 'up' ? '⬆️ Marée montante' : st.trend === 'down' ? '⬇️ Marée descendante' : '⏸️ Étale';
        const nxt = st.next ? ` · ${st.next === 'PM' ? 'pleine' : 'basse'} mer dans ${C.fmtDur(st.inMin)}` : '';
        html += `<div class="tide-block"><div class="big">🌊</div><div><strong>${word}</strong><br><span class="muted">${esc(nxt.replace(/^ · /, ''))}</span></div></div>`;
        const up = C.cleanExtremes(C.extremes(tms, lv)).filter((e) => e.ms > now).slice(0, 4);
        if (up.length) {
          html += '<ul class="tide-list">' + up.map((e) =>
            `<li><span>${e.type === 'PM' ? '▲ Pleine mer' : '▼ Basse mer'}</span><span>${esc(dayTime(e.ms))}</span><span class="muted">${sign(e.level)}</span></li>`).join('') + '</ul>';
        }
      }
      html += curve(tms, lv, now);
      html += `<p class="hint">Hauteurs au-dessus du niveau moyen de la mer (pas le zéro des cartes marines). Modèle d'environ 8 km, peu précis près des côtes :
        il ne remplace pas un annuaire des marées. Les coefficients ne sont pas disponibles.</p>`;
    }
    html += '<p class="hint">Données : <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>.</p>';
    body.innerHTML = html;
  }

  $('btn-tide').addEventListener('click', () => {
    $('layers-panel').classList.add('hidden');
    const open = tidePanel.classList.toggle('hidden') === false;
    if (open) loadTide();
  });
  $('btn-layers').addEventListener('click', () => tidePanel.classList.add('hidden'));

  // =====================================================
  // Page Statistiques
  // =====================================================
  const stats = $('stats-page');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const bucketOf = (v, defs) => { for (const [lo, hi, label] of defs) if (v >= lo && v < hi) return label; return null; };
  const labelsOf = (defs) => defs.map((d) => d[2]);

  const LURE_W = [[0, 30, '< 30 g'], [30, 60, '30–60 g'], [60, 100, '60–100 g'], [100, 1e6, '> 100 g']];
  const DEPTH = [[0, 10, '0–10 m'], [10, 20, '10–20 m'], [20, 30, '20–30 m'], [30, 50, '30–50 m'], [50, 1e6, '> 50 m']];
  const WIND = [[0, 5, '< 5 kt'], [5, 10, '5–10 kt'], [10, 15, '10–15 kt'], [15, 20, '15–20 kt'], [20, 1e6, '> 20 kt']];
  const SEA = [[-5, 12, '< 12 °C'], [12, 16, '12–16 °C'], [16, 20, '16–20 °C'], [20, 24, '20–24 °C'], [24, 60, '> 24 °C']];
  const DAYPART = ['Aube (5–9 h)', 'Matinée (9–12 h)', 'Après-midi (12–17 h)', 'Soir (17–21 h)', 'Nuit (21–5 h)'];
  const dayPart = (c) => {
    const h = new Date(c.date).getHours();
    return h >= 5 && h < 9 ? DAYPART[0] : h >= 9 && h < 12 ? DAYPART[1] : h >= 12 && h < 17 ? DAYPART[2] : h >= 17 && h < 21 ? DAYPART[3] : DAYPART[4];
  };
  const TIDE_L = { up: 'Montante', down: 'Descendante', slack: 'Étale' };

  const SECTIONS = [
    { icon: '🪝', title: 'Type de leurre', key: (c) => c.lure && c.lure.type || null },
    { icon: '🎨', title: 'Couleur du leurre', key: (c) => c.lure && c.lure.color ? cap(c.lure.color.trim().toLowerCase()) : null },
    { icon: '⚖️', title: 'Poids du leurre', key: (c) => c.lure && c.lure.weight ? bucketOf(c.lure.weight, LURE_W) : null, order: labelsOf(LURE_W) },
    { icon: '🦐', title: 'Appât', key: (c) => c.bait || null },
    { icon: '📐', title: 'Profondeur', key: (c) => c.depth ? bucketOf(c.depth, DEPTH) : null, order: labelsOf(DEPTH) },
    { icon: '🕐', title: 'Moment de la journée', key: dayPart, order: DAYPART },
    { icon: '🌙', title: 'Phase de lune', key: (c) => c.cond && c.cond.moon && C.MOONS[c.cond.moon.i] ? C.MOONS[c.cond.moon.i][0] : null, order: C.MOONS.map((m) => m[0]) },
    { icon: '🌊', title: 'Marée', key: (c) => c.cond && c.cond.tide && !c.cond.tide.weak ? TIDE_L[c.cond.tide.trend] : null, order: ['Montante', 'Descendante', 'Étale'],
      note: 'Marées très faibles (Méditerranée) exclues.' },
    { icon: '💨', title: 'Vent', key: (c) => c.cond && c.cond.wind != null ? bucketOf(c.cond.wind, WIND) : null, order: labelsOf(WIND) },
    { icon: '🌡️', title: "Température de l'eau", key: (c) => c.cond && c.cond.sea != null ? bucketOf(c.cond.sea, SEA) : null, order: labelsOf(SEA) }
  ];

  function barSection(sec, list) {
    const m = new Map();
    let n = 0;
    list.forEach((c) => { const k = sec.key(c); if (k == null || k === '') return; n++; m.set(k, (m.get(k) || 0) + 1); });
    if (!n) return '';
    let entries = sec.order ? sec.order.filter((k) => m.has(k)).map((k) => [k, m.get(k)])
                            : [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 8);
    const max = Math.max(...entries.map((e) => e[1]));
    const rows = entries.map(([k, v]) => `<div class="bar-row${v === max ? ' top' : ''}" title="${esc(k)} : ${v} prise${v > 1 ? 's' : ''}">
        <span class="bar-label">${esc(k)}</span>
        <span class="bar"><i style="width:${Math.max(4, (v / max) * 100).toFixed(0)}%"></i></span>
        <span class="bar-n">${v}</span></div>`).join('');
    return `<section class="stat"><h3>${sec.icon} ${esc(sec.title)} <small>${n} / ${list.length} renseignée${n > 1 ? 's' : ''}</small></h3>${rows}${
      sec.note ? `<p class="hint">${esc(sec.note)}</p>` : ''}</section>`;
  }

  function summaryHtml(list) {
    const days = new Set(list.map((c) => new Date(c.date).toDateString())).size;
    const species = new Set(list.map((c) => c.fish)).size;
    const bySize = list.filter((c) => c.size).sort((a, b) => b.size - a.size)[0];
    const byW = list.filter((c) => c.weight).sort((a, b) => b.weight - a.weight)[0];
    const tile = (v, l) => `<div class="tile"><strong>${v}</strong><span>${l}</span></div>`;
    return `<div class="tiles">${tile(list.length, 'prises')}${tile(species, 'espèce' + (species > 1 ? 's' : ''))}${tile(days, 'jour' + (days > 1 ? 's' : '') + ' de pêche')}</div>` +
      (bySize || byW ? '<div class="records">' +
        (bySize ? `<div>🏆 Plus longue : <strong>${bySize.size} cm</strong> — ${esc(bySize.fish)}</div>` : '') +
        (byW ? `<div>🏆 Plus lourde : <strong>${byW.weight} kg</strong> — ${esc(byW.fish)}</div>` : '') + '</div>' : '');
  }

  function renderStats() {
    const all = A.getCatches();
    const sel = $('stats-filter');
    const cur = sel.value;
    const names = [...new Set(all.map((c) => c.fish))].sort((a, b) => a.localeCompare(b, 'fr'));
    sel.innerHTML = '<option value="">Toutes les espèces</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = names.includes(cur) ? cur : '';
    const list = all.filter((c) => !sel.value || c.fish === sel.value);
    const body = $('stats-body');
    if (!list.length) { body.innerHTML = '<p class="empty">Aucune prise à analyser.</p>'; return; }

    const species = { icon: '🐟', title: 'Espèces', key: (c) => c.fish };
    let html = summaryHtml(list);
    html += '<p class="hint">Ces statistiques comptent vos <strong>prises</strong> : elles montrent avec quoi, où et quand vous avez pêché, pas un taux de réussite (les sorties sans prise ne sont pas enregistrées).</p>';
    if (!sel.value) html += barSection(species, list);
    html += SECTIONS.map((s) => barSection(s, list)).join('');
    if (list.some((c) => !c.cond || c.cond.pending)) {
      html += '<p class="hint">Certaines conditions (vent, marée…) sont encore en cours de récupération : rouvrez la page dans un instant.</p>';
    }
    body.innerHTML = html;
  }

  let pushed = false;
  function openStats() {
    renderStats();
    stats.classList.remove('hidden');
    stats.scrollTop = 0;
    pushed = location.hash !== '#stats';
    if (pushed) history.pushState(null, '', '#stats'); // le bouton « retour » du téléphone ferme la page
  }
  function closeStats() {
    stats.classList.add('hidden');
    if (location.hash === '#stats') {
      if (pushed) { pushed = false; history.back(); }
      else history.replaceState(null, '', location.pathname + location.search);
    }
  }
  window.addEventListener('popstate', () => {
    if (location.hash !== '#stats') stats.classList.add('hidden');
  });
  $('btn-stats').addEventListener('click', openStats);
  $('stats-back').addEventListener('click', closeStats);
  $('stats-filter').addEventListener('change', renderStats);
})();

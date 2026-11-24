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


  // ---------- Courbes : prises en fonction d'une variable ----------
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const VARS = {
    sea: { label: 'Température eau', unit: '°C', step: 1, val: (c) => c.cond && c.cond.sea },
    air: { label: 'Température air', unit: '°C', step: 1, val: (c) => c.cond && c.cond.air },
    wind: { label: 'Vent', unit: 'kt', step: 2, val: (c) => c.cond && c.cond.wind },
    press: { label: 'Pression', unit: 'hPa', step: 3, val: (c) => c.cond && c.cond.press },
    cur: { label: 'Courant', unit: 'kt', step: 0.2, val: (c) => c.cond && c.cond.cur },
    depth: { label: 'Profondeur', unit: 'm', step: 5, val: (c) => c.depth },
    hour: { label: 'Heure de la journée', unit: 'h', step: 1, val: (c) => new Date(c.date).getHours(), fixed: [0, 23] },
    month: { label: 'Mois', unit: '', step: 1, val: (c) => new Date(c.date).getMonth(), fixed: [0, 11], fmt: (v) => MONTHS[v] }
  };
  const METRICS = { count: 'Nombre de prises', size: 'Taille moyenne (cm)' };
  let curveVar = 'sea', curveMetric = 'count', tab = 'bars';

  function curveChart(list) {
    const V = VARS[curveVar], isCount = curveMetric === 'count';
    const pts = list.map((c) => ({ v: V.val(c), c })).filter((p) => p.v != null && isFinite(p.v));
    if (!pts.length) return '<p class="empty">Pas encore de données « ' + esc(V.label.toLowerCase()) + ' » pour ces prises.</p>';
    const bin = (v) => Math.floor(v / V.step + 1e-9);
    const lo = V.fixed ? V.fixed[0] : Math.min(...pts.map((p) => bin(p.v)));
    const hi = V.fixed ? V.fixed[1] : Math.max(...pts.map((p) => bin(p.v)));
    const nb = hi - lo + 1;
    const cnt = new Array(nb).fill(0), sz = new Array(nb).fill(0), szn = new Array(nb).fill(0);
    pts.forEach(({ v, c }) => { const i = bin(v) - lo; if (i < 0 || i >= nb) return; cnt[i]++; if (c.size) { sz[i] += c.size; szn[i]++; } });
    const y = isCount ? cnt : sz.map((t, i) => (szn[i] ? t / szn[i] : null));
    const sm = isCount ? cnt.map((_, i) => ((cnt[i - 1] || 0) + 2 * cnt[i] + (cnt[i + 1] || 0)) / (i === 0 || i === nb - 1 ? 3 : 4)) : y;
    const vals = y.filter((v) => v != null);
    if (!vals.length) return '<p class="empty">Aucune taille renseignée pour ces prises.</p>';
    const ymax = Math.max(...vals, ...sm.filter((v) => v != null)) || 1;
    const W = 340, H = 200, L = 34, R = 10, T = 12, B = 34, pw = W - L - R, ph = H - T - B;
    const X = (i) => L + (nb === 1 ? pw / 2 : (i / (nb - 1)) * pw), Y = (v) => T + ph - (v / ymax) * ph;
    const lab = (i) => V.fmt ? V.fmt(lo + i) : String(+((lo + i) * V.step).toFixed(2));
    const nTicks = Math.min(nb, 6), ticks = [...new Set(Array.from({ length: nTicks }, (_, k) => Math.round(k * (nb - 1) / Math.max(1, nTicks - 1))))];
    const path = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }); return d; };
    const best = y.indexOf(Math.max(...vals));
    const fmtY = (v) => (isCount ? String(Math.round(v)) : v.toFixed(0));
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="curve" role="img" aria-label="${esc(METRICS[curveMetric])} selon ${esc(V.label)}">`;
    [0, 0.5, 1].forEach((f) => { const yy = T + ph - f * ph; svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 4}" y="${yy + 4}" class="ax" text-anchor="end">${fmtY(ymax * f)}</text>`; });
    ticks.forEach((i) => { svg += `<text x="${X(i)}" y="${H - B + 14}" class="ax" text-anchor="middle">${esc(lab(i))}</text>`; });
    svg += `<text x="${L + pw / 2}" y="${H - 4}" class="ax" text-anchor="middle">${esc(V.label)}${V.unit ? ' (' + esc(V.unit) + ')' : ''}</text>`;
    if (isCount) svg += `<path d="${path(sm)}L${X(nb - 1)} ${T + ph}L${X(0)} ${T + ph}Z" class="area"/>`;
    svg += `<path d="${path(isCount ? sm : y)}" class="line"/>`;
    y.forEach((v, i) => { if (v == null) return; svg += `<circle cx="${X(i)}" cy="${Y(v)}" r="${i === best ? 5 : 3}" class="dot${i === best ? ' best' : ''}"><title>${esc(lab(i))}${V.unit ? ' ' + esc(V.unit) : ''} : ${isCount ? v + ' prise' + (v > 1 ? 's' : '') : v.toFixed(1) + ' cm (' + szn[i] + ' prise' + (szn[i] > 1 ? 's' : '') + ')'}</title></circle>`; });
    svg += '</svg>';
    const bl = lab(best) + (V.unit ? ' ' + V.unit : '');
    const range = V.step > 1 || V.step < 1 ? ` (tranche ${+((lo + best) * V.step).toFixed(2)}–${+((lo + best + 1) * V.step).toFixed(2)})` : '';
    return `<section class="stat"><h3>📈 ${esc(METRICS[curveMetric])} <small>${pts.length} / ${list.length} prises renseignées</small></h3>${svg}` +
      `<p class="hint">Point le plus haut : <strong>${esc(bl)}</strong>${V.fixed ? '' : esc(range)}. ${isCount ? 'La courbe est lissée ; les points sont les valeurs réelles.' : 'Moyenne des tailles renseignées par tranche.'} ${pts.length < 15 ? '⚠️ Peu de prises : la courbe est surtout indicative.' : ''}</p></section>` +
      '<p class="hint">Elle montre où vous avez pêché le plus, pas où le poisson mord le mieux (les sorties sans prise ne sont pas enregistrées).</p>';
  }
  function curvesTools() {
    const opt = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');
    return `<div class="curve-tools"><label>Variable<select id="curve-var">${opt(VARS, curveVar)}</select></label><label>Mesure<select id="curve-metric">${opt(METRICS, curveMetric)}</select></label></div>`;
  }


  // ---------- Sorties : rendement (prises par heure de pêche) ----------
  function tripsHtml(sp) {
    const FT = window.fishTrips; if (!FT) return '';
    const T = FT.get().filter((t) => t.end && FT.hoursOf(t) >= 1 / 6)
      .map((t) => ({ t, h: FT.hoursOf(t), n: FT.catchesOf(t).filter((c) => !sp || c.fish === sp).length }));
    if (!T.length) return '';
    const H = T.reduce((a, r) => a + r.h, 0), N = T.reduce((a, r) => a + r.n, 0), blank = T.filter((r) => !r.n).length;
    const fr = (v) => v.toFixed(1).replace('.', ',');
    const tile = (v, l) => `<div class="tile"><strong>${v}</strong><span>${l}</span></div>`;
    let html = `<section class="stat"><h3>⏱️ Sorties <small>${T.length} sortie${T.length > 1 ? 's' : ''}</small></h3><div class="tiles">${tile(fr(N / H), 'prises / heure')}${tile(H >= 10 ? Math.round(H) + ' h' : fr(H) + ' h', 'à pêcher')}${tile(Math.round(blank / T.length * 100) + ' %', 'bredouilles')}</div></section>`;
    const by = (title, icon, keyOf, order) => {
      const m = new Map();
      T.forEach((r) => { const k = keyOf(r.t); if (k == null) return; const o = m.get(k) || { h: 0, n: 0, s: 0 }; o.h += r.h; o.n += r.n; o.s++; m.set(k, o); });
      const es = (order || [...m.keys()]).filter((k) => m.has(k) && m.get(k).h >= 1).map((k) => [k, m.get(k)]);
      if (es.length < 2) return '';
      const mx = Math.max(...es.map(([, o]) => o.n / o.h)) || 1;
      return `<section class="stat"><h3>${icon} Rendement selon ${esc(title)}</h3>` + es.map(([k, o]) => {
        const r = o.n / o.h;
        return `<div class="bar-row rate${r === mx && mx > 0 ? ' top' : ''}" title="${esc(k)} : ${o.n} prise(s) en ${fr(o.h)} h, ${o.s} sortie(s)"><span class="bar-label">${esc(k)}</span><span class="bar"><i style="width:${Math.max(4, r / mx * 100).toFixed(0)}%"></i></span><span class="bar-n">${fr(r)}/h</span></div>`;
      }).join('') + '<p class="hint">Prises par heure, sorties bredouilles incluses (tranches avec au moins 1 h de pêche).</p></section>';
    };
    html += by("la température de l'eau", '🌡️', (t) => t.cond && t.cond.sea != null ? bucketOf(t.cond.sea, SEA) : null, labelsOf(SEA));
    html += by('le vent', '💨', (t) => t.cond && t.cond.wind != null ? bucketOf(t.cond.wind, WIND) : null, labelsOf(WIND));
    html += by('le moment de départ', '🕐', (t) => dayPart({ date: t.start }), DAYPART);
    html += by('la lune', '🌙', (t) => t.cond && t.cond.moon && C.MOONS[t.cond.moon.i] ? C.MOONS[t.cond.moon.i][0] : null, C.MOONS.map((m) => m[0]));
    return html;
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
    $('stats-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'curves') {
      body.innerHTML = curvesTools() + curveChart(list);
      $('curve-var').addEventListener('change', (e) => { curveVar = e.target.value; renderStats(); });
      $('curve-metric').addEventListener('change', (e) => { curveMetric = e.target.value; renderStats(); });
      return;
    }
    let html = summaryHtml(list);
    html += window.fishTrips && window.fishTrips.get().some((t) => t.end)
      ? '<p class="hint">Les barres ci-dessous comptent vos <strong>prises</strong> ; le rendement (prises par heure) vient de vos <strong>sorties</strong>, bredouilles comprises.</p>'
      : '<p class="hint">Ces statistiques comptent vos <strong>prises</strong>, pas un taux de réussite. Démarrez une <strong>sortie</strong> (⏱️) pour mesurer un vrai rendement, sorties bredouilles comprises.</p>';
    html += tripsHtml(sel.value);
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
  $('stats-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderStats(); stats.scrollTop = 0; } });
})();

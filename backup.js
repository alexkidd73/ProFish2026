/* Sauvegarde et restauration des données (fichier JSON), rappel de sauvegarde. Chargé APRÈS app.js. */
(() => {
  'use strict';

  const A = window.fishApp;
  if (!A) return;
  const $ = (id) => document.getElementById(id);
  const { esc, toast } = A;

  const PREFIX = 'peche.';
  const KEY_BK = 'peche.backup.v1';          // dernière sauvegarde : { at, ids }
  const KEY_CATCHES = 'peche.catches.v1';
  const KEY_CUSTOM = 'peche.customFish.v1';
  const KEY_SPOTS = 'peche.spots.v1';
  const KEY_MSG = 'peche.msg';               // message à afficher après rechargement (sessionStorage)
  const DAY = 864e5;
  const REMIND_AFTER_DAYS = 7;               // rappel si des prises sont non sauvegardées depuis 7 jours
  const REMIND_AFTER_NEW = 5;                // ou dès 5 nouvelles prises non sauvegardées

  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const isDataKey = (k) => k !== KEY_BK && k !== KEY_CATCHES && k !== KEY_CUSTOM && k !== KEY_SPOTS;
  const pecheKeys = () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIX)) out.push(k); }
    return out;
  };

  const pad = (n) => String(n).padStart(2, '0');
  function stamp(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  // ---------- Fabrication du fichier ----------
  function buildBackup() {
    const settings = {};
    pecheKeys().filter(isDataKey).forEach((k) => { settings[k] = read(k, null); });
    return {
      app: 'carnet-peche', version: 2, exportedAt: new Date().toISOString(),
      catches: A.getCatches(), customFish: read(KEY_CUSTOM, []), spots: read(KEY_SPOTS, []), settings
    };
  }
  function makeFile(prefix) {
    const data = buildBackup();
    const json = JSON.stringify(data);
    const name = `${prefix}-${stamp()}.json`;
    return { data, json, name, blob: new Blob([json], { type: 'application/json' }) };
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Signature d'une prise : change quand la prise est modifiée
  const sigOf = (c) => c.id + '|' + (c.updated || '');
  function markBackup(catches, at) {
    write(KEY_BK, { at: at || new Date().toISOString(), ids: catches.map((c) => c.id), sigs: catches.map(sigOf) });
    renderStatus();
  }

  // ---------- État de la sauvegarde / rappel ----------
  function state() {
    const cur = A.getCatches();
    const bk = read(KEY_BK, null);
    const useSig = !!(bk && Array.isArray(bk.sigs)); // anciennes sauvegardes : identifiants seuls
    const saved = new Set(bk ? (useSig ? bk.sigs : Array.isArray(bk.ids) ? bk.ids : []) : []);
    const unsaved = cur.filter((c) => !saved.has(useSig ? sigOf(c) : c.id)).length;
    const age = bk && bk.at ? Date.now() - new Date(bk.at).getTime() : Infinity;
    const due = cur.length > 0 && (!bk || unsaved >= REMIND_AFTER_NEW || (unsaved >= 1 && age > REMIND_AFTER_DAYS * DAY));
    return { cur, bk, unsaved, due };
  }
  function renderStatus() {
    const s = state();
    const el = $('backup-status');
    if (!s.cur.length && !s.bk) el.textContent = 'Aucune prise à sauvegarder pour le moment.';
    else if (!s.bk) el.innerHTML = '⚠️ <strong>Aucune sauvegarde.</strong> Vos données ne sont que dans ce navigateur.';
    else {
      el.innerHTML = `Dernière sauvegarde : <strong>${esc(fmtDate(s.bk.at))}</strong>` +
        (s.unsaved ? `<br>⚠️ ${s.unsaved} prise${s.unsaved > 1 ? 's' : ''} nouvelle${s.unsaved > 1 ? 's' : ''} ou modifiée${s.unsaved > 1 ? 's' : ''}, non sauvegardée${s.unsaved > 1 ? 's' : ''}` : '<br>✅ Tout est sauvegardé');
    }
    el.classList.toggle('warn', s.due);
    $('btn-layers').classList.toggle('alert', s.due);
    return s;
  }

  // ---------- Sauvegarder ----------
  $('btn-backup').addEventListener('click', () => {
    const f = makeFile('carnet-peche');
    download(f.blob, f.name);
    markBackup(f.data.catches);
    toast(`Sauvegarde téléchargée : ${f.data.catches.length} prise${f.data.catches.length > 1 ? 's' : ''}`);
  });

  // Partage natif (téléphone) : enregistrer dans Drive, Fichiers, e-mail…
  const canShareFiles = () => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'a.json', { type: 'application/json' })] })); }
    catch { return false; }
  };
  if (canShareFiles()) $('btn-share').classList.remove('hidden');
  $('btn-share').addEventListener('click', async () => {
    const f = makeFile('carnet-peche');
    const file = new File([f.json], f.name, { type: 'application/json' });
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Carnet de Pêche' });
      markBackup(f.data.catches);
      toast('Sauvegarde envoyée');
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Partage impossible : utilisez « Sauvegarder ».');
    }
  });

  // ---------- Lecture / validation d'un fichier ----------
  function parseBackup(text) {
    let d;
    try { d = JSON.parse(text); } catch { return null; }
    if (!d || typeof d !== 'object' || !Array.isArray(d.catches)) return null;
    if (d.app && d.app !== 'carnet-peche') return null;
    const ok = (c) => c && typeof c === 'object' && c.id && typeof c.fish === 'string' && c.fish &&
      isFinite(c.lat) && isFinite(c.lng) && c.date && !isNaN(new Date(c.date));
    const catches = d.catches.filter(ok);
    const settings = {};
    if (d.settings && typeof d.settings === 'object') {
      Object.keys(d.settings).forEach((k) => { if (k.startsWith(PREFIX) && isDataKey(k)) settings[k] = d.settings[k]; });
    }
    return {
      catches, customFish: Array.isArray(d.customFish) ? d.customFish : [], settings,
      spots: (Array.isArray(d.spots) ? d.spots : []).filter((s) => s && s.id && isFinite(s.lat) && isFinite(s.lng)),
      exportedAt: d.exportedAt || null, skipped: d.catches.length - catches.length
    };
  }
  const normFish = (f) => (typeof f === 'string' ? { name: f, kind: 'any' } : f);
  // Liste de poissons personnalisés = existants + ceux du fichier + espèces des prises restaurées
  function mergeCustom(existing, incoming, catches) {
    const known = new Set(A.defaultFish.map((n) => n.toLowerCase()));
    const out = [];
    const add = (f) => {
      f = normFish(f);
      if (!f || typeof f.name !== 'string' || !f.name.trim()) return;
      const k = f.name.trim().toLowerCase();
      if (known.has(k)) return;
      known.add(k);
      out.push({ name: f.name.trim(), kind: ['fresh', 'sea', 'any'].includes(f.kind) ? f.kind : 'any' });
    };
    existing.forEach(add);
    incoming.forEach(add);
    catches.forEach((c) => add({ name: c.fish, kind: c.water === 'sea' || c.water === 'fresh' ? c.water : 'any' }));
    return out;
  }

  // ---------- Restaurer ----------
  const modal = $('restore-modal');
  let pending = null;

  $('file-restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let text;
    try { text = await file.text(); } catch { toast('Lecture du fichier impossible.'); return; }
    const parsed = parseBackup(text);
    if (!parsed) { toast('Ce fichier n’est pas une sauvegarde Carnet de Pêche.'); return; }
    pending = parsed;
    const have = new Set(A.getCatches().map((c) => c.id));
    const fresh = parsed.catches.filter((c) => !have.has(c.id)).length;
    $('restore-summary').innerHTML =
      `Fichier ${parsed.exportedAt ? 'du <strong>' + esc(fmtDate(parsed.exportedAt)) + '</strong>' : ''} : ` +
      `<strong>${parsed.catches.length}</strong> prise${parsed.catches.length > 1 ? 's' : ''}, ` +
      `dont <strong>${fresh}</strong> absente${fresh > 1 ? 's' : ''} de votre carnet actuel (${A.getCatches().length} prise${A.getCatches().length > 1 ? 's' : ''}).` +
      (parsed.skipped ? `<br><span class="muted">${parsed.skipped} entrée${parsed.skipped > 1 ? 's' : ''} invalide${parsed.skipped > 1 ? 's' : ''} ignorée${parsed.skipped > 1 ? 's' : ''}.</span>` : '');
    modal.classList.remove('hidden');
  });
  const closeModal = () => { modal.classList.add('hidden'); pending = null; };
  $('restore-close').addEventListener('click', closeModal);
  $('restore-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function finish(message) {
    try { sessionStorage.setItem(KEY_MSG, message); } catch { /* ignoré */ }
    location.reload(); // l'application relit toutes ses données au démarrage
  }

  $('restore-merge').addEventListener('click', () => {
    if (!pending) return;
    const cur = A.getCatches().slice();
    const ids = new Set(cur.map((c) => c.id));
    let added = 0;
    pending.catches.forEach((c) => { if (!ids.has(c.id)) { cur.push(c); ids.add(c.id); added++; } });
    const custom = mergeCustom(read(KEY_CUSTOM, []), pending.customFish, cur);
    const spots = read(KEY_SPOTS, []).slice(); const sid = new Set(spots.map((s) => s.id));
    pending.spots.forEach((s) => { if (!sid.has(s.id)) { spots.push(s); sid.add(s.id); added++; } });
    if (!write(KEY_CATCHES, cur) || !write(KEY_CUSTOM, custom) || !write(KEY_SPOTS, spots)) {
      toast('Stockage plein : rien n’a été modifié.');
      return;
    }
    finish(added ? `${added} élément${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} depuis la sauvegarde (prises et spots).` : 'Rien à ajouter : tout était déjà présent.');
  });

  $('restore-replace').addEventListener('click', () => {
    if (!pending) return;
    // 1) filet de sécurité : sauvegarde de l'état actuel avant d'écraser
    if (A.getCatches().length) {
      const safety = makeFile('carnet-peche-avant-restauration');
      download(safety.blob, safety.name);
    }
    // 2) remplacement, avec retour arrière si le stockage est plein
    const keys = pecheKeys().filter((k) => k !== KEY_BK);
    const snap = {};
    keys.forEach((k) => { snap[k] = localStorage.getItem(k); });
    const custom = mergeCustom([], pending.customFish, pending.catches);
    try {
      keys.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(KEY_CATCHES, JSON.stringify(pending.catches));
      localStorage.setItem(KEY_CUSTOM, JSON.stringify(custom));
      localStorage.setItem(KEY_SPOTS, JSON.stringify(pending.spots));
      Object.keys(pending.settings).forEach((k) => localStorage.setItem(k, JSON.stringify(pending.settings[k])));
    } catch {
      try {
        pecheKeys().filter((k) => k !== KEY_BK).forEach((k) => localStorage.removeItem(k));
        Object.keys(snap).forEach((k) => { if (snap[k] != null) localStorage.setItem(k, snap[k]); });
      } catch { /* ignoré */ }
      toast('Stockage plein : vos données actuelles ont été conservées.');
      return;
    }
    markBackup(pending.catches, pending.exportedAt);
    finish(`Sauvegarde restaurée : ${pending.catches.length} prise${pending.catches.length > 1 ? 's' : ''}.`);
  });

  // ---------- Rappel, stockage durable ----------
  $('btn-layers').addEventListener('click', () => {
    const s = renderStatus();
    if (s.due) setTimeout(() => { const el = $('backup-section'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, 50);
  });

  const note = $('persist-note');
  note.textContent = 'Le navigateur peut effacer les données d’un site (cache vidé, manque de place) : sauvegardez régulièrement.';
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((granted) => {
      if (granted) note.textContent = '🔒 Stockage protégé par le navigateur contre l’effacement automatique. Une sauvegarde reste recommandée.';
    }).catch(() => {});
  }

  try {
    const msg = sessionStorage.getItem(KEY_MSG);
    if (msg) { sessionStorage.removeItem(KEY_MSG); setTimeout(() => toast(msg), 600); }
  } catch { /* ignoré */ }

  const s0 = renderStatus();
  if (s0.due) {
    setTimeout(() => toast(s0.bk
      ? `💾 ${s0.unsaved} prise${s0.unsaved > 1 ? 's' : ''} non sauvegardée${s0.unsaved > 1 ? 's' : ''} : 🗂️ → Sauvegarde`
      : '💾 Pensez à sauvegarder vos prises : 🗂️ → Sauvegarde'), 2500);
  }
  setInterval(renderStatus, 5000);
})();

/* Stockage des photos dans IndexedDB (le localStorage est limité à ~5 Mo).
   Les prises gardent leur photo en mémoire ; seule la copie du localStorage en est allégée. */
(function () {
  'use strict';
  const P = { ok: false, loaded: false, stored: new Map(), onFail: null };
  let db = null, chain = Promise.resolve();

  const open = () => new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('carnet-peche', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('photos')) r.result.createObjectStore('photos'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  const tx = (mode, fn) => new Promise((res, rej) => {
    let out;
    try {
      const t = db.transaction('photos', mode);
      out = fn(t.objectStore('photos'));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
    } catch (e) { rej(e); }
  });

  // Charge les photos, migre celles qui sont encore dans le localStorage, supprime les orphelines
  P.init = async function (list) {
    try {
      db = await open();
      const keys = await tx('readonly', (s) => s.getAllKeys());
      const vals = await tx('readonly', (s) => s.getAll());
      const m = new Map(keys.map((k, i) => [k, vals[i]]));
      list.forEach((c) => {
        if (!c.photo && m.has(c.id)) c.photo = m.get(c.id);
        if (c.photo && m.get(c.id) === c.photo) P.stored.set(c.id, c.photo);
      });
      P.ok = true;
      await P.putMany(list); // photos héritées du localStorage
      if (P.ok && list.length) {
        const ids = new Set(list.map((c) => c.id));
        const orphans = keys.filter((k) => !ids.has(k));
        if (orphans.length) await tx('readwrite', (s) => { orphans.forEach((k) => s.delete(k)); });
      }
    } catch { P.ok = false; }
    P.loaded = true;
    return P.ok;
  };

  // Aligne IndexedDB sur la liste de prises (ajouts, changements, suppressions)
  P.putMany = function (list, keepOthers) {
    if (!P.ok || !db) return Promise.resolve(false);
    const byId = new Map(list.map((c) => [c.id, c]));
    const todo = list.filter((c) => c.photo && P.stored.get(c.id) !== c.photo);
    const del = [];
    if (!keepOthers) P.stored.forEach((v, id) => { const c = byId.get(id); if (!c || !c.photo) del.push(id); });
    if (!todo.length && !del.length) return Promise.resolve(true);
    todo.forEach((c) => P.stored.set(c.id, c.photo));
    del.forEach((id) => P.stored.delete(id));
    chain = chain
      .then(() => tx('readwrite', (s) => { todo.forEach((c) => s.put(c.photo, c.id)); del.forEach((id) => s.delete(id)); }))
      .then(() => true, () => { P.ok = false; P.stored.clear(); if (P.onFail) P.onFail(); return false; });
    return chain;
  };

  // Copie allégée pour le localStorage : sans les photos déjà placées dans IndexedDB
  P.strip = (list) => list.map((c) => (c.photo && P.ok && P.stored.get(c.id) === c.photo ? (({ photo, ...rest }) => rest)(c) : c));

  window.PhotoStore = P;
})();

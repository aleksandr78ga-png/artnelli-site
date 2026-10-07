/* Shared catalogue consumer. No VK Market writes or independent product database. */
(function (root) {
  'use strict';
  const validId = (id) => Number.isSafeInteger(Number(id)) && Number(id) !== 0;
  function validateSnapshot(products) {
    if (!Array.isArray(products) || !products.length) return false;
    const ids = new Set();
    return products.every(p => {
      if (!p || !validId(p.id) || ids.has(Number(p.id)) || typeof p.name !== 'string' ||
          !Array.isArray(p.photos) || !Array.isArray(p.prices)) return false;
      ids.add(Number(p.id));
      return true;
    });
  }
  function parseSnapshot(text) {
    const match = /^\s*window\.NELLI_CATALOG\s*=\s*(\[[\s\S]*\])\s*;?\s*$/.exec(text);
    if (!match) throw new Error('Unexpected catalogue format');
    const products = JSON.parse(match[1]);
    if (!validateSnapshot(products)) throw new Error('Incomplete catalogue');
    return products;
  }
  function validLive(live) {
    return live?.ok === true && Array.isArray(live.products) && Array.isArray(live.statuses) &&
      live.products.every(p => p && validId(p.id)) && live.statuses.every(p => p && validId(p.id));
  }
  function merge(base, live) {
    const byId = new Map((base || []).map(p => [Number(p.id), {...p}]));
    if (validLive(live)) {
      for (const p of live.products) byId.set(Number(p.id), {...byId.get(Number(p.id)), ...p});
      for (const status of live.statuses) {
        const current = byId.get(Number(status.id));
        // Names are never identities: sale and rental may have identical names.
        if (current) {
          if (typeof status.sold === 'boolean') current.sold = status.sold;
          if (typeof status.removed === 'boolean') current.removed = status.removed;
        }
      }
    }
    return [...byId.values()].filter(p => p.removed !== true && p.name && p.photos?.length)
      .sort((a,b) => Number(Boolean(a.sold)) - Number(Boolean(b.sold)) ||
        String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id));
  }
  const api = {validateSnapshot, parseSnapshot, validLive, merge};
  root.NELLI_CATALOG_MODEL = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

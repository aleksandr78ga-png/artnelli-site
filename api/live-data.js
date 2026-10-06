(() => {
  const endpoint = 'https://artnelli-leotards.aleksandr78ga.chatgpt.site/api/catalog';
  let pending = false;
  let signature = null;
  async function refreshCatalog() {
    if (pending || document.hidden || navigator.onLine === false) return;
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {cache:'no-store', credentials:'omit', signal:controller.signal});
      if (!response.ok) throw new Error('Catalog unavailable');
      const payload = await response.json();
      if (payload?.telegram?.ok !== true || !Array.isArray(payload.telegram.products) ||
          !Array.isArray(payload.telegram.statuses)) throw new Error('Incomplete catalog');
      window.NELLI_LIVE = {...window.NELLI_LIVE, ...payload};
      const nextSignature = JSON.stringify(payload.telegram);
      if (nextSignature !== signature) {
        signature = nextSignature;
        window.dispatchEvent(new CustomEvent('nelli:live-data', {detail:window.NELLI_LIVE}));
      }
    } catch {
      // Keep the last usable catalogue while offline or during an upstream outage.
    } finally {
      clearTimeout(timeout);
      pending = false;
    }
  }
  refreshCatalog();
  setInterval(refreshCatalog, 60000);
  window.addEventListener('online', refreshCatalog);
  document.addEventListener('visibilitychange', refreshCatalog);
})();

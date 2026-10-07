(() => {
  const endpoint = 'https://artnelli-leotards.aleksandr78ga.chatgpt.site/api/catalog';
  const productTopicIds = new Set([1864, 1865, 5098, 14, 2, 4, 16, 738]);
  const publishedIds = new Set((window.NELLI_CATALOG || []).map(product => Number(product.id)));
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
      const telegram = {
        ...payload.telegram,
        products: payload.telegram.products.filter(product => {
          const id = Number(product?.id);
          return publishedIds.has(id) || productTopicIds.has(Number(product?.telegramTopicId));
        }),
      };
      window.NELLI_LIVE = {...window.NELLI_LIVE, ...payload, telegram};
      const nextSignature = JSON.stringify(telegram);
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
  setInterval(refreshCatalog, 15000);
  window.addEventListener('online', refreshCatalog);
  window.addEventListener('focus', refreshCatalog);
  document.addEventListener('visibilitychange', refreshCatalog);
})();

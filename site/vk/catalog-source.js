(() => {
  'use strict';
  const SOURCE = 'https://artnelli.com/catalog-data.js';
  const CACHE = 'artnelli-vk-catalog-v1';
  const status = document.getElementById('catalog-status');
  let pending = false;
  let signature = '';
  let hasData = false;
  function accept(products, cache = true) {
    if (!window.NELLI_CATALOG_MODEL.validateSnapshot(products)) return;
    const next = JSON.stringify(products);
    hasData = true;
    status.hidden = true;
    if (next === signature) return;
    signature = next;
    window.NELLI_CATALOG = products;
    if (cache) { try { localStorage.setItem(CACHE, next); } catch (_) {} }
    window.dispatchEvent(new CustomEvent('nelli:catalog-base'));
  }
  try { const cached = JSON.parse(localStorage.getItem(CACHE)); accept(cached, false); } catch (_) {}
  async function refresh() {
    if (pending || document.hidden || navigator.onLine === false) return;
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(SOURCE, {cache:'no-store', credentials:'omit', signal:controller.signal});
      if (!response.ok) throw new Error('Unavailable');
      accept(window.NELLI_CATALOG_MODEL.parseSnapshot(await response.text()));
    } catch (_) {
      if (!hasData) {
        status.textContent = 'Не удалось загрузить каталог. Повторяем подключение…';
        status.hidden = false;
      }
      // A failure never clears the last confirmed catalogue or creates a deletion.
    } finally { clearTimeout(timeout); pending = false; }
  }
  window.addEventListener('nelli:live-data', () => {
    if (window.NELLI_CATALOG_MODEL.validLive(window.NELLI_LIVE?.telegram) && window.NELLI_LIVE.telegram.products.length) {
      status.hidden = true;
    }
  });
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('nelli:host-restore', refresh);
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 15000);
  refresh();
})();

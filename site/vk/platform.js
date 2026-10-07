(() => {
  'use strict';
  const bridge = window.vkBridge;
  const params = new URLSearchParams(location.search);
  const appId = /^\d+$/.test(params.get('vk_app_id') || '') ? params.get('vk_app_id') : null;
  const embedded = Boolean(appId && bridge);
  function optional(method, payload) {
    if (!embedded || (method !== 'VKWebAppInit' && !bridge.supports(method))) return Promise.resolve(null);
    return bridge.send(method, payload).catch(() => null);
  }
  window.NELLI_PLATFORM = {appId, embedded, optional};
  if (!embedded) return;
  optional('VKWebAppInit').then(() => optional('VKWebAppSetViewSettings', {
    status_bar_style:'light', action_bar_color:'#0a090b', navigation_bar_color:'#0a090b'
  }));
  bridge.subscribe(event => {
    const {type, data} = event.detail || {};
    if (type === 'VKWebAppUpdateInsets' || type === 'VKWebAppUpdateConfig') {
      const insets = data?.insets;
      if (insets) {
        for (const side of ['top','bottom']) {
          const value = Number(insets[side]);
          if (Number.isFinite(value) && value >= 0 && value < 200)
            document.documentElement.style.setProperty('--vk-safe-' + side, value + 'px');
        }
      }
    }
    if (type === 'VKWebAppViewRestore') window.dispatchEvent(new Event('nelli:host-restore'));
  });
})();

// Validate the same fast endpoint used by the website and both mini-apps.
const base = process.env.NELLI_CATALOG_BACKEND || 'https://artnelli-leotards.aleksandr78ga.chatgpt.site/';
const response = await fetch(new URL('/api/catalog',base), {
  headers:{accept:'application/json','cache-control':'no-cache'},
  signal:AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Live catalogue HTTP ${response.status}`);
if (response.headers.get('access-control-allow-origin') !== '*') throw new Error('Live catalogue CORS is unavailable');
const {telegram} = await response.json();
if (!telegram?.ok || !Array.isArray(telegram.products)) throw new Error('Invalid live catalogue');
const ids = telegram.products.map(p=>Number(p.id));
if (ids.some(id=>!Number.isSafeInteger(id)||id<=0) || new Set(ids).size!==ids.length)
  throw new Error('Live catalogue has invalid or duplicate product IDs');
console.log('Live catalogue health '+JSON.stringify({
  checkedAt:new Date().toISOString(),historyAt:telegram.authenticatedHistoryAt,
  count:ids.length,conditions:telegram.products.reduce((counts,p)=>{
    counts[p.condition]=(counts[p.condition]||0)+1;return counts;
  },{}),ids:ids.sort((a,b)=>a-b),
  prices:telegram.products.map(p=>({id:p.id,prices:p.prices})),
  removed:(telegram.statuses||[]).filter(s=>s.removed===true).map(s=>s.id),
}));

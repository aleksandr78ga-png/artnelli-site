// Ask the existing importer to refresh public Telegram evidence. This needs
// neither a personal browser session nor a second catalogue publisher.
const base = process.env.NELLI_CATALOG_BACKEND || 'https://artnelli-leotards.aleksandr78ga.chatgpt.site/';
try {
  const response = await fetch(new URL('/api/telegram-sync', base), {
    headers: {accept:'application/json','cache-control':'no-cache'},
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error('Importer HTTP '+response.status);
  const payload = await response.json();
  const result = payload.reconciliation;
  if (result?.source !== 'public-telegram-albums') throw new Error('Public album reconciliation unavailable');
  console.log(JSON.stringify({source:result.source,checkedAt:payload.checkedAt,
    sourceHealthy:result.sourceHealthy,checked:result.checked,pending:result.pending,
    removed:result.removed,unknown:result.unknown}));
} catch (error) {
  // Keep the last confirmed catalogue and the independent fast webhook path.
  // A failed public read must not turn every listing into a removal.
  console.warn('Telegram public reconciliation deferred: '+error.message);
}

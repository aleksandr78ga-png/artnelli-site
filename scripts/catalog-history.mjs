const SOURCE = 'authenticated-telegram-catalog';
const SCOPE = 'all-product-topics';
const validId = id => Number.isSafeInteger(id) && id > 0;
export function validateCatalogHistory(state) {
  if (state?.version !== 1 || state.channel !== 'nelli_leotards' || state.source !== SOURCE ||
      state.scope !== SCOPE || !Number.isFinite(Date.parse(state.checkedAt)) || !Array.isArray(state.records))
    throw new Error('Invalid authenticated catalogue history');
  const ids = new Set();
  for (const record of state.records) {
    if (!validId(record.id) || ids.has(record.id)) throw new Error('Invalid catalogue post ID');
    if (record.observedMessageIds != null && (!Array.isArray(record.observedMessageIds) ||
        record.observedMessageIds.some(id=>!validId(id)) ||
        new Set(record.observedMessageIds).size!==record.observedMessageIds.length))
      throw new Error('Invalid observed album message IDs');
    if (record.observedAlbumRootId != null && (!validId(record.observedAlbumRootId) ||
        !record.observedMessageIds?.includes(record.observedAlbumRootId)))
      throw new Error('Invalid observed album root ID');
    ids.add(record.id);
    if (record.removed && !(record.missingChecks >= 2 &&
        Date.parse(record.lastMissingAt) <= Date.parse(state.checkedAt) &&
        Date.parse(record.lastMissingAt)-Date.parse(record.missingSince) >= 600000))
      throw new Error('Deletion needs two complete authenticated observations');
  }
  return state;
}
export function recordCatalogHistory(previous, observation, knownProducts = []) {
  if (previous) validateCatalogHistory(previous);
  if (observation?.channel !== 'nelli_leotards' || observation.source !== SOURCE || observation.scope !== SCOPE ||
      observation.complete !== true || observation.reachedStart !== true || observation.reachedEnd !== true ||
      observation.allProductTopicsRead !== true) return previous;
  const now = Date.parse(observation.checkedAt);
  if (!Number.isFinite(now) || previous && now <= Date.parse(previous.checkedAt))
    throw new Error('Observation must be newer than previous history');
  if (!Array.isArray(observation.posts) || observation.posts.some(p=>!validId(p.id)))
    throw new Error('Invalid catalogue observations');
  const present = new Map(observation.posts.map(p=>[p.id,p]));
  const records = new Map((previous?.records || []).map(p=>[p.id,p]));
  for (const p of knownProducts) if (validId(p.id) && !records.has(p.id))
    records.set(p.id,{id:p.id,name:p.name,telegramTopicId:p.telegramTopicId||null,lastSeenAt:null});
  for (const p of present.values()) records.set(p.id,{id:p.id,name:p.name||records.get(p.id)?.name||'',
    ...(p.observedAlbumRootId?{observedAlbumRootId:p.observedAlbumRootId,observedMessageIds:p.observedMessageIds}:{}),
    telegramTopicId:p.telegramTopicId||null,lastSeenAt:observation.checkedAt,missingSince:null,lastMissingAt:null,
    missingChecks:0,removed:false});
  for (const [id,p] of records) if (!present.has(id)) {
    const since=p.missingSince||observation.checkedAt;
    const checks=(p.missingChecks||0)+1;
    records.set(id,{...p,missingSince:since,lastMissingAt:observation.checkedAt,missingChecks:checks,
      removed:checks>=2 && now-Date.parse(since)>=600000});
  }
  return validateCatalogHistory({version:1,channel:'nelli_leotards',source:SOURCE,scope:SCOPE,
    checkedAt:observation.checkedAt,records:[...records.values()].sort((a,b)=>a.id-b.id)});
}
export function confirmedCatalogRemovalIds(state) {
  return validateCatalogHistory(state).records.filter(p=>p.removed).map(p=>p.id);
}

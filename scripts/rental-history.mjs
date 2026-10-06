const CHANNEL = 'nelli_leotards';
const TOPIC = 1865;
const SOURCE = 'authenticated-telegram-topic';
const MIN_CONFIRMATION_MS = 10 * 60 * 1000;
const validId = id => Number.isSafeInteger(id) && id > 0;

export function validateRentalHistory(state) {
  if (state?.version !== 1 || state.channel !== CHANNEL || state.topicId !== TOPIC ||
      state.source !== SOURCE || !Number.isFinite(Date.parse(state.checkedAt)) ||
      !Array.isArray(state.records)) throw new Error('Invalid rental history evidence');
  const ids = new Set();
  for (const record of state.records) {
    if (!validId(record.id) || ids.has(record.id)) throw new Error('Invalid rental message ID');
    if (record.observedMessageIds != null && (!Array.isArray(record.observedMessageIds) ||
        record.observedMessageIds.some(id=>!validId(id)) ||
        new Set(record.observedMessageIds).size!==record.observedMessageIds.length))
      throw new Error('Invalid observed album message IDs');
    if (record.observedAlbumRootId != null && (!validId(record.observedAlbumRootId) ||
        !record.observedMessageIds?.includes(record.observedAlbumRootId)))
      throw new Error('Invalid observed album root ID');
    ids.add(record.id);
    if (record.removed && !(record.missingChecks >= 2 &&
        Date.parse(record.lastMissingAt) - Date.parse(record.missingSince) >= MIN_CONFIRMATION_MS)) {
      throw new Error('Rental deletion needs two complete history observations');
    }
  }
  return state;
}

// A partial page, login screen, loading state or network error is not evidence
// of absence. Only a complete traversal of this exact topic advances evidence.
export function recordRentalHistory(previous, observation, knownRentals = []) {
  if (previous) validateRentalHistory(previous);
  if (observation?.complete !== true || observation.reachedStart !== true ||
      observation.reachedEnd !== true || observation.channel !== CHANNEL ||
      observation.topicId !== TOPIC || observation.source !== SOURCE) return previous;
  const now = Date.parse(observation.checkedAt);
  if (!Number.isFinite(now) || (previous && now <= Date.parse(previous.checkedAt))) {
    throw new Error('Rental history observation must be newer than the previous one');
  }
  if (!Array.isArray(observation.posts) || observation.posts.some(p => !validId(p.id))) {
    throw new Error('Invalid rental history posts');
  }
  const present = new Map(observation.posts.map(p => [p.id, p]));
  const records = new Map((previous?.records || []).map(p => [p.id, p]));
  for (const p of knownRentals) {
    if (validId(p.id) && Number(p.telegramTopicId) === TOPIC && !records.has(p.id)) {
      records.set(p.id, {id:p.id, name:p.name, lastSeenAt:null});
    }
  }
  for (const p of present.values()) {
    records.set(p.id, {id:p.id, name:p.name || records.get(p.id)?.name || '',
      ...(p.observedAlbumRootId?{observedAlbumRootId:p.observedAlbumRootId,observedMessageIds:p.observedMessageIds}:{}),
      lastSeenAt:observation.checkedAt, missingSince:null, lastMissingAt:null,
      missingChecks:0, removed:false});
  }
  for (const [id, p] of records) {
    if (present.has(id)) continue;
    const missingSince = p.missingSince || observation.checkedAt;
    const missingChecks = (p.missingChecks || 0) + 1;
    records.set(id, {...p, missingSince, lastMissingAt:observation.checkedAt,
      missingChecks, removed:missingChecks >= 2 && now - Date.parse(missingSince) >= MIN_CONFIRMATION_MS});
  }
  return validateRentalHistory({version:1, channel:CHANNEL, topicId:TOPIC, source:SOURCE,
    checkedAt:observation.checkedAt, records:[...records.values()].sort((a,b)=>a.id-b.id)});
}

export function confirmedRentalRemovalIds(state) {
  return validateRentalHistory(state).records.filter(p=>p.removed).map(p=>p.id);
}

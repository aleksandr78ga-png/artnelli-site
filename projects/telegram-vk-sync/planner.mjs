// Offline preflight only. This module has no network or persistence operations.
import { createHash } from 'node:crypto';

const CHANNEL = 'nelli_leotards';
const CONDITIONS = new Set(['new', 'used', 'rental']);
const FIELDS = ['name', 'description', 'price', 'photos', 'transactionType'];
const validId = n => Number.isSafeInteger(n) && n > 0;
const validOwner = n => Number.isSafeInteger(n) && n < 0;
const positivePrice = n => typeof n === 'number' && Number.isSafeInteger(n * 100) && n > 0;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const fingerprint = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const sourceKey = p => `${CHANNEL}:${p.id}:${p.condition === 'rental' ? 'rent' : 'sale'}`;

function photoUrl(value) {
  if (typeof value !== 'string' || !value) throw new Error('invalid_photo');
  const url = new URL(value, 'https://artnelli.com/');
  if (url.protocol !== 'https:' || url.hostname !== 'artnelli.com' || url.port || url.username || url.password ||
      !/^\/(?:assets\/catalog\/|api\/telegram-media\/|api\/telegram-public-media(?:\?|$))/.test(url.pathname + url.search)) {
    throw new Error('unverified_photo_origin');
  }
  return url.href;
}

export function normalizeProduct(p) {
  const issues = [];
  if (!p || !validId(p.id)) return { key: null, issues: ['invalid_source_id'], fields: null };
  if (!CONDITIONS.has(p.condition)) issues.push('unknown_sale_or_rental');
  if (typeof p.name !== 'string' || !p.name.trim()) issues.push('missing_name');
  if (p.removed || p.sold || p.available === false) issues.push('source_unavailable_keep_vk');
  const key = sourceKey(p);
  const mode = p.condition === 'rental' ? 'rent' : 'sale';
  let price = null;
  if (!Array.isArray(p.prices) || p.prices.some(v => !positivePrice(v))) issues.push('invalid_price');
  else if (p.prices.length === 0) {
    price = { mode: 'on_request', amountRub: null, currency: 'RUB' };
    issues.push('price_on_request_vk_unverified');
  } else if (p.prices.length > 1) {
    price = { mode: 'unresolved_offers', amountsRub: [...p.prices], currency: 'RUB' };
    issues.push('multiple_prices_need_offer_mapping');
  } else price = { mode: 'fixed', amountRub: p.prices[0], currency: 'RUB' };
  let photos = [];
  try {
    if (!Array.isArray(p.photos) || !p.photos.length) throw new Error('missing_photos');
    photos = [...new Set(p.photos.map(photoUrl))];
  } catch (error) { issues.push(error.message); }
  let telegram;
  try {
    const u = new URL(p.telegram);
    const match = u.pathname.match(/^\/nelli_leotards\/(?:[1-9]\d*\/)?([1-9]\d*)\/?$/);
    if (u.protocol !== 'https:' || u.hostname !== 't.me' || u.username || u.password || u.port ||
        u.search || u.hash || !match || Number(match[1]) !== p.id) throw new Error();
    telegram = u.href;
  } catch { issues.push('invalid_telegram_source'); }
  // Do not copy free-text phone numbers, client names or addresses to VK.
  const safeValue = v => typeof v === 'string' && /^[\d\s.,–—-]+$/.test(v) ? v.trim() : null;
  const lines = [p.name?.trim() || '', mode === 'rent' ? 'Аренда' : p.condition === 'used' ? 'Продажа · б/у' : 'Продажа · новый'];
  const measurements = [['Рост', p.height], ['Обхват груди', p.specs?.chest], ['Обхват талии', p.specs?.waist],
    ['Обхват бёдер', p.specs?.hips], ['Дуга тела', p.specs?.girth]];
  for (const [label, value] of measurements) if (safeValue(value)) lines.push(`${label}: ${safeValue(value)} см`);
  if (telegram) lines.push(`Подробности: ${telegram}`);
  return { key, sourceId: p.id, issues, fields: { name: mode === 'rent' ? `Аренда · ${p.name}` : p.name,
    description: lines.join('\n'), transactionType: mode, price, photos } };
}

const counts = (list, key) => list.reduce((map, row) => map.set(key(row), (map.get(key(row)) || 0) + 1), new Map());
function validTargetFields(fields) {
  return fields && FIELDS.every(k => Object.hasOwn(fields, k)) && typeof fields.name === 'string' &&
    typeof fields.description === 'string' && ['sale', 'rent'].includes(fields.transactionType) &&
    Array.isArray(fields.photos) && fields.photos.length > 0 && fields.photos.every(v => typeof v === 'string' && v.length > 0) &&
    fields.price?.currency === 'RUB' &&
    ((fields.price.mode === 'fixed' && positivePrice(fields.price.amountRub)) ||
     (fields.price.mode === 'on_request' && fields.price.amountRub === null));
}

/** Inputs are local, normalized snapshots, never raw VK API responses.
 * Every suggested change remains disabled. A separate verified transport and
 * apply-time compare-and-swap are required before any live integration.
 */
export function planSync({ source, vk = null, bindings = [], now, maxAgeMs = 15 * 60 * 1000 }) {
  if (!Array.isArray(source?.products) || !Array.isArray(bindings)) throw new TypeError('Expected source.products and bindings arrays');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new TypeError('Explicit now and positive maxAgeMs required');
  const blockers = [];
  const fresh = t => Number.isFinite(Date.parse(t)) && Date.parse(t) <= nowMs && nowMs - Date.parse(t) <= maxAgeMs;
  if (source.channel !== CHANNEL) blockers.push('wrong_telegram_channel');
  if (source.complete !== true) blockers.push('incomplete_source_snapshot');
  if (!fresh(source.checkedAt)) blockers.push('source_snapshot_stale_or_unverified');
  if (!vk) blockers.push('vk_snapshot_missing');
  else {
    if (!validOwner(vk.ownerId)) blockers.push('invalid_vk_owner');
    if (!Array.isArray(vk.items) || vk.complete !== true) blockers.push('incomplete_vk_snapshot');
    if (!fresh(vk.checkedAt)) blockers.push('vk_snapshot_stale_or_unverified');
  }
  const bindingIssues = [];
  for (const b of bindings) {
    if (!b || typeof b.sourceKey !== 'string' || !/^nelli_leotards:[1-9]\d*:(sale|rent)$/.test(b.sourceKey) ||
        !validOwner(b.ownerId) || !validId(b.itemId) || b.confirmed !== true) bindingIssues.push('unconfirmed_or_invalid_binding');
    else if (vk && b.ownerId !== vk.ownerId) bindingIssues.push('binding_owner_mismatch');
  }
  const validBindings = bindings.filter(b => b && typeof b.sourceKey === 'string');
  if ([...counts(validBindings, b => b.sourceKey).values()].some(n => n > 1)) bindingIssues.push('duplicate_source_binding');
  if ([...counts(validBindings, b => `${b.ownerId}:${b.itemId}`).values()].some(n => n > 1)) bindingIssues.push('vk_item_bound_to_multiple_offers');
  blockers.push(...new Set(bindingIssues));
  const sourceCounts = counts(source.products, p => p?.id);
  const items = Array.isArray(vk?.items) ? vk.items : [];
  if (items.some(i => !i || !validId(i.itemId) || i.ownerId !== vk?.ownerId)) blockers.push('invalid_vk_item_identity');
  if ([...counts(items, i => i?.itemId).values()].some(n => n > 1)) blockers.push('duplicate_vk_item_identity');
  const rows = [];
  for (const product of source.products) {
    const desired = normalizeProduct(product);
    const issues = [...blockers, ...desired.issues];
    if (sourceCounts.get(product?.id) > 1) issues.push('duplicate_source_id');
    const binding = validBindings.find(b => b.sourceKey === desired.key);
    const target = binding && items.find(i => i?.itemId === binding.itemId && i?.ownerId === binding.ownerId);
    if (!binding) issues.push('mapping_required_no_automatic_creation');
    else if (!target) issues.push('mapped_vk_item_missing_keep_mapping');
    else if (!validTargetFields(target.fields)) issues.push('vk_fields_not_verified');
    else if (desired.fields?.transactionType !== target.fields.transactionType) issues.push('sale_rental_conflict');
    const row = { sourceKey: desired.key, sourceId: desired.sourceId ?? null, target: binding ? {ownerId:binding.ownerId, itemId:binding.itemId} : null,
      status:'review_required', reasons:[...new Set(issues)], desired:desired.fields, writesAllowed:false };
    if (!row.reasons.length) {
      const before = Object.fromEntries(FIELDS.map(k => [k, target.fields[k]]));
      const changedFields = FIELDS.filter(k => fingerprint(before[k]) !== fingerprint(desired.fields[k]));
      row.status = changedFields.length ? 'update_candidate' : 'unchanged';
      row.changedFields = changedFields;
      row.preconditions = { ownerId: binding.ownerId, itemId: binding.itemId, observedFingerprint:fingerprint(before),
        sourceFingerprint:fingerprint(desired.fields), sourceCheckedAt:source.checkedAt, vkCheckedAt:vk.checkedAt };
    }
    rows.push(row);
  }
  // Neither a missing source post nor partial feed membership proves deletion.
  const seen = new Set(rows.map(r => r.sourceKey));
  const retained = validBindings.filter(b => !seen.has(b.sourceKey)).map(b => ({sourceKey:b.sourceKey,
    ownerId:b.ownerId, itemId:b.itemId, action:'retain', reason:'source_missing_never_delete_automatically'}));
  return { schema:'artnelli-telegram-vk-preflight-v1', mode:'offline_preview', writesEnabled:false, applySupported:false,
    sourceFingerprint:fingerprint(source), snapshotFingerprint:vk ? fingerprint(vk) : null, blockers, rows, retained,
    summary:{ sourceCards:rows.length, updateCandidates:rows.filter(r => r.status === 'update_candidate').length,
      unchanged:rows.filter(r => r.status === 'unchanged').length, needsReview:rows.filter(r => r.status === 'review_required').length,
      retained:retained.length, creates:0, deletes:0 } };
}

// Revalidation helper for the future executor; it performs no mutation.
export function targetStillMatches(candidate, observedItem) {
  if (candidate.status !== 'update_candidate' || !candidate.preconditions || !validTargetFields(observedItem?.fields)) return false;
  return observedItem.ownerId === candidate.preconditions.ownerId && observedItem.itemId === candidate.preconditions.itemId &&
    fingerprint(Object.fromEntries(FIELDS.map(k => [k, observedItem.fields[k]]))) === candidate.preconditions.observedFingerprint;
}

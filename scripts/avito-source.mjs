// Source-side preparation only. This module never calls Avito or publishes ads.
import { createHash } from 'node:crypto';
import { normalizeCatalogOffer, catalogPriceValues } from './catalog-offer.mjs';

export const fingerprint = value => createHash('sha256').update(
  typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
const positiveId = id => Number.isSafeInteger(id) && id > 0;
const base = 'https://artnelli.com/';

export function parseCatalog(source) {
  const match = source.match(/^\s*window\.NELLI_CATALOG\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) throw new Error('Unrecognised shared catalogue format');
  const products = JSON.parse(match[1]);
  if (!Array.isArray(products) || !products.length) throw new Error('Empty catalogue; preserve previous export');
  const ids = new Set();
  for (const p of products) {
    if (!p || !Number.isSafeInteger(p.id) || !p.id || ids.has(p.id))
      throw new Error('Invalid or duplicate source ID; preserve previous export');
    if (!Array.isArray(p.prices) || !Array.isArray(p.photos) || typeof p.description !== 'string')
      throw new Error('Incomplete source product; preserve previous export');
    ids.add(p.id);
  }
  return products;
}

export function photoPath(value) {
  if (typeof value !== 'string') throw new Error('Invalid image reference');
  const url = new URL(value, base);
  if (url.origin !== new URL(base).origin || url.search || url.hash ||
      !/^\/assets\/catalog\/[\w.-]+\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname))
    throw new Error('Image must be an existing shared catalogue asset');
  return url.pathname.slice(1);
}

export function validateConnection(connection) {
  if (connection?.schemaVersion !== 1 || connection.mode !== 'prepare' ||
      !connection.bindings || typeof connection.bindings !== 'object' || Array.isArray(connection.bindings))
    throw new Error('Only source preparation is implemented; live connection is disabled');
  const remoteIds = new Set();
  for (const [key, binding] of Object.entries(connection.bindings)) {
    if (!/^artnelli-tg-\d+-(?:sale|rental)$/.test(key) ||
        !/^\d+$/.test(binding?.avitoId || '') || binding?.verified !== true ||
        remoteIds.has(binding.avitoId)) throw new Error('Invalid or duplicate Avito binding');
    remoteIds.add(binding.avitoId);
  }
  return connection;
}

export function verifiedRemovals(checkpoint, catalogSource) {
  if (checkpoint?.schemaVersion !== 1 || checkpoint.source !== 'shared-catalogue-publisher' ||
      checkpoint.catalogSha256 !== fingerprint(catalogSource) ||
      !Array.isArray(checkpoint.confirmedRemovedIds) ||
      checkpoint.confirmedRemovedIds.some(id => !positiveId(id)) ||
      new Set(checkpoint.confirmedRemovedIds).size !== checkpoint.confirmedRemovedIds.length)
    throw new Error('Removal checkpoint does not match this catalogue; preserve previous export');
  return checkpoint.confirmedRemovedIds;
}

export function prepareOffer(original, imageInfo) {
  const p = normalizeCatalogOffer(original);
  const problems = [];
  if (!positiveId(p.id)) problems.push('telegram_id_not_verified');
  if (!['new', 'used', 'rental'].includes(p.condition)) problems.push('offer_kind_not_verified');
  const kind = p.condition === 'rental' ? 'rental' : 'sale';
  const id = `artnelli-tg-${p.id}-${kind}`;
  if (!String(p.name || '').trim()) problems.push('missing_name');
  if (p.sold === true || p.removed === true || p.available === false) problems.push('unavailable');

  const declared = catalogPriceValues(p.description);
  let price;
  if (!p.prices.length && !declared.length) {
    price = {mode: 'on_request', amount: null, currency: null};
    problems.push('on_request_format_not_verified');
  } else if (p.prices.length > 1 || declared.length > 1) {
    price = {mode: 'variants', amount: null, currency: 'RUB', values: [...p.prices]};
    problems.push('price_variants_need_explicit_mapping');
  } else if (p.prices.length !== 1 || !Number.isFinite(p.prices[0]) || p.prices[0] <= 0 ||
      Math.round(p.prices[0] * 100) !== p.prices[0] * 100 || !declared.includes(p.prices[0])) {
    price = {mode: 'unverified', amount: null, currency: null, values: [...p.prices]};
    problems.push('price_must_match_explicit_source_currency');
  } else {
    price = {mode: 'fixed', amount: p.prices[0], currency: 'RUB'};
  }
  if (kind === 'rental') problems.push('rental_format_and_period_not_verified');
  if (p.type !== 'leotard' || /фигурн|акробат|эстетическ/iu.test(p.description))
    problems.push('category_needs_mapping');

  const photos = [];
  for (const value of p.photos) {
    try {
      const relative = photoPath(value);
      const info = imageInfo.get(relative);
      if (!info?.sha256) throw new Error('Image is missing or unreadable');
      photos.push({url: new URL(relative, base).href, sha256: info.sha256});
    } catch { problems.push('image_needs_review'); }
  }
  if (!photos.length) problems.push('no_images');
  // The supplied Avito edit screen shows a ten-photo limit. Do not silently
  // discard photographs or select a subset without checking the actual template.
  if (photos.length > 10) problems.push('image_count_needs_review');

  const fields = {
    name: p.name, type: p.type, condition: p.condition, offerKind: kind,
    description: p.description, height: p.height || '', specs: p.specs || {}, price, photos,
    telegram: p.telegram || '', telegramTopicId: p.telegramTopicId || null,
    observedMessageIds: [...new Set([p.id, ...(p.telegramMessageIds || [])])].sort((a,b) => a-b),
  };
  return {id, sourceId: p.id, fields, fingerprint: fingerprint(fields),
    status: problems.length ? 'needs_review' : 'ready_for_template',
    blockers: [...new Set(problems)]};
}

export function prepareSource({products, imageInfo, connection, previous = null, removedIds = []}) {
  validateConnection(connection);
  if (previous && (previous.schemaVersion !== 1 || previous.source !== 'nelli_leotards' ||
      previous.scope !== 'source_preparation_only' || !Array.isArray(previous.offers) ||
      !Array.isArray(previous.removals) || previous.removals.some(p => !positiveId(p?.sourceId)) ||
      previous.offers.some(p => !Number.isSafeInteger(p?.sourceId) || !p.sourceId ||
        !['sale','rental'].includes(p.fields?.offerKind) ||
        p.id !== `artnelli-tg-${p.sourceId}-${p.fields.offerKind}`)))
    throw new Error('Invalid previous export; preserve it');
  const removed = new Set(removedIds);
  if (removedIds.some(id => !positiveId(id)) || products.some(p => removed.has(p.id)))
    throw new Error('Contradictory removal evidence; preserve previous export');
  const offers = products.map(p => prepareOffer(p, imageInfo));
  const seen = new Set(offers.map(p => p.id));
  if (seen.size !== offers.length) throw new Error('Duplicate offer ID');
  // A missing/invalid card is not an instruction to delete its Avito listing.
  // Retain unresolved previous records; a verified tombstone is required.
  for (const old of previous?.offers || []) {
    if (!seen.has(old.id) && !removed.has(old.sourceId)) {
      offers.push({...old, status:'held', blockers:['source_absence_not_confirmed']});
      seen.add(old.id);
    }
  }
  offers.sort((a,b) => a.sourceId-b.sourceId || a.id.localeCompare(b.id));
  const removals = [...new Set([...(previous?.removals || []).map(p => p.sourceId), ...removed])]
    .filter(id => !products.some(p => p.id === id)).sort((a,b) => a-b)
    .map(sourceId => ({sourceId, reason:'confirmed_by_shared_catalogue_publisher'}));
  return {
    schemaVersion:1, source:'nelli_leotards', scope:'source_preparation_only',
    avitoConnected:false, avitoImportFile:false, deleteMissingOffers:false,
    activationBlockers:['official_category_template_required', 'existing_avito_inventory_required',
      'account_autoload_connection_required', 'create_update_withdraw_acceptance_test_required'],
    offers, removals,
  };
}

// A preview of intended changes, NOT executable requests. An existing ad can
// only be matched by an explicitly verified source ID ↔ Avito ID binding.
export function previewChanges(source, connection, previousFingerprints = {}) {
  validateConnection(connection);
  const plan = source.offers.map(offer => {
    const binding = connection.bindings[offer.id];
    const action = offer.status !== 'ready_for_template' ? 'hold' : binding
      ? previousFingerprints[offer.id] === offer.fingerprint ? 'unchanged' : 'update'
      : 'await_inventory_match';
    return {sourceId:offer.sourceId, id:offer.id, avitoId:binding?.avitoId || null, action};
  });
  for (const removal of source.removals) {
    for (const [id, binding] of Object.entries(connection.bindings)) {
      if (id.startsWith(`artnelli-tg-${removal.sourceId}-`))
        plan.push({sourceId:removal.sourceId, id, avitoId:binding.avitoId, action:'withdraw_after_receiver_validation'});
    }
  }
  return {executable:false, changes:plan};
}

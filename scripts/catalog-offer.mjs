// The publication's leading offer determines rental vs sale. A mention such as
// “Продаётся б/у (аренда)” still describes a pre-owned sale, not a rental price.
export function normalizeCatalogOffer(product) {
  const heading = String(product.description || '').normalize('NFKC')
    .split(/\r?\n/).find(line => line.trim()) || '';
  const isRental = Number(product.telegramTopicId) === 1865 ||
    /^[^\p{L}\p{N}]*(?:аренда|прокат)(?=$|[^\p{L}])/iu.test(heading);
  if (!isRental) return product;
  return {
    ...product,
    condition: 'rental',
    // Correct only the upstream generated sale/new prefix; preserve model data.
    ...(product.descriptionEn ? {
      descriptionEn: product.descriptionEn.replace(/^For sale\s*\n(?:New |Pre-owned )?/i, 'For rent\n'),
    } : {}),
  };
}

function translationMatchesSourceFacts(text, product) {
  const description = String(text || '');
  const normalize = (value) => String(value ?? '')
    .normalize('NFKC').toLowerCase().replace(/[–—]/g, '-')
    .replace(/\bcm\b/g, '').replace(/\s+/g, '').trim();
  const translatedValue = (label) =>
    description.match(new RegExp(`^\\s*${label}\\s*:\\s*([^\\n]+)$`, 'imu'))?.[1];
  const measurements = [
    ['Height', product.height],
    ['Chest', product.specs?.chest],
    ['Waist', product.specs?.waist],
    ['Hips', product.specs?.hips],
    ['Body girth', product.specs?.girth],
  ];
  for (const [label, expected] of measurements) {
    const translated = translatedValue(label);
    if (expected && translated && normalize(translated) !== normalize(expected)) return false;
  }
  if (product.condition === 'used' && /\bnew\b/i.test(description) &&
      !/\bpre-owned\b/i.test(description)) return false;
  if (product.condition === 'new' && /\bpre-owned\b/i.test(description)) return false;
  if (product.condition === 'rental' && /^\s*for sale\b/im.test(description)) return false;
  return true;
}

// A Telegram message ID cannot change in place. Public album refreshes may
// temporarily select another member as the representative message, so keep
// the already confirmed canonical ID for an existing card. Likewise, do not
// replace confirmed translations with regenerated fallbacks when the source
// product facts themselves are unchanged.
export function mergeCatalogOffer(existing, incoming) {
  if (!existing) return incoming;
  const sourceKeys = ['name', 'description', 'height', 'specs', 'prices', 'condition', 'type'];
  const sourceUnchanged = sourceKeys.every((key) =>
    JSON.stringify(existing[key]) === JSON.stringify(incoming[key]));
  const representativeDrift = Number(incoming.telegramMessageId) > 0 &&
    Number(incoming.telegramMessageId) !== Number(existing.id);
  const saleSection = String(incoming.description || '').match(/(?:^|\n)\s*Sale\b[\s\S]*$/i)?.[0] || '';
  const explicitEnglishName = representativeDrift
    ? saleSection.match(/[“"«]([^”"»\n]+)[”"»]/)?.[1]?.trim()
    : undefined;
  const preserveExistingTranslation = sourceUnchanged && existing.descriptionEn &&
    translationMatchesSourceFacts(existing.descriptionEn, incoming);
  const confirmedDescriptionEn = preserveExistingTranslation
    ? (explicitEnglishName
        ? existing.descriptionEn.replace(/([“"«])([^”"»\n]+)([”"»])/, `$1${explicitEnglishName}$3`)
        : existing.descriptionEn)
    : incoming.descriptionEn;
  return {
    ...existing,
    ...incoming,
    telegramMessageId: Number(existing.id) > 0
      ? Number(existing.id)
      : (existing.telegramMessageId ?? incoming.telegramMessageId),
    ...(sourceUnchanged && (explicitEnglishName ||
        (preserveExistingTranslation && existing.nameEn))
      ? { nameEn: explicitEnglishName || existing.nameEn }
      : {}),
    ...(confirmedDescriptionEn ? { descriptionEn: confirmedDescriptionEn } : {}),
  };
}

// Owner-supplied screenshots can establish an offer before its message ID is
// available. Negative IDs belong to these local imports, never to Telegram.
// Replace an import only when a single real rental post identifies the same
// model and measurements. A separate sale or an ambiguous match must survive.
export function reconcileImportedRentals(products) {
  const normalize = (value = '') => String(value).normalize('NFKC')
    .toLocaleLowerCase('ru').replace(/[–—]/g, '-').replace(/\s+/g, '').trim();
  const sameModel = (left, right) =>
    normalize(left.name) === normalize(right.name) &&
    normalize(left.height) === normalize(right.height) &&
    ['chest', 'waist', 'hips', 'girth'].every((key) =>
      normalize(left.specs?.[key]) === normalize(right.specs?.[key]));
  const albumAliases = new Set(products.flatMap(product =>
    (product.telegramMessageIds || []).map(Number).filter(id =>
      id > 0 && id !== Number(product.id))));
  return products.filter((product) => {
    if (albumAliases.has(Number(product.id))) return false;
    if (product.sourceImport !== 'owner-screenshots-2026-09-28' ||
        Number(product.id) >= 0 || product.condition !== 'rental') return true;
    const matches = products.filter((candidate) =>
      Number(candidate.id) > 0 && candidate.condition === 'rental' &&
      candidate.removed !== true && sameModel(product, candidate));
    return matches.length !== 1;
  });
}

export function rentalPhotosChanged(existing, incoming) {
  if (normalizeCatalogOffer(incoming).condition !== 'rental') return false;
  return JSON.stringify(existing?.telegramPhotoSources || []) !==
    JSON.stringify(incoming.photos || []);
}

export function catalogPhotosChanged(existing, incoming) {
  const sources = incoming.photos || [];
  const local = existing?.photos || [];
  const path = value => String(value).replace(/^https:\/\/artnelli\.com\//, '');
  if (JSON.stringify(sources.map(path)) === JSON.stringify(local.map(path))) return false;
  if (!existing?.telegramPhotoSources) return Number(incoming.telegramMediaUpdatedAt || 0) * 1000 >
    (Date.parse(existing?.catalogMediaSnapshotAt || '') || Date.now());
  return JSON.stringify(existing.telegramPhotoSources) !== JSON.stringify(sources);
}
export function catalogPriceValues(text = '') {
  const values = [];
  const pattern = /(?<![\d.,])((?:[1-9]\d{0,2}(?:[ \u00a0\u202f.]\d{3})+|\d+)(?:,\d{1,2})?)\s*(?:(тыс(?:яч(?:а|и)?|\.?))\s*)?(?:руб(?:лей|ля|ль)?|₽)/giu;
  for (const match of String(text).matchAll(pattern)) {
    const number = Number(match[1].replace(/[ .\u00a0\u202f]/g, '').replace(',', '.')) * (match[2] ? 1000 : 1);
    if (Number.isFinite(number) && number >= 1000 && !values.includes(number)) values.push(number);
  }
  return values;
}


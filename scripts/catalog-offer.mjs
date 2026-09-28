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

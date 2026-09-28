// The publication's leading offer determines rental vs sale. A mention such as
// “Продаётся б/у (аренда)” still describes a pre-owned sale, not a rental price.
export function normalizeCatalogOffer(product) {
  const heading = String(product.description || '').normalize('NFKC')
    .split(/\r?\n/).find(line => line.trim()) || '';
  const isRental = /^[^\p{L}\p{N}]*(?:аренда|прокат)(?=$|[^\p{L}])/iu.test(heading);
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

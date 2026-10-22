// Preparation only: no Avito API, account access or automatic publication.
// This grouping was observed in Nelli's existing ad, not inferred from its name.
export const MONOCHROME = ['artnelli-tg-8-sale', 'artnelli-tg-60-sale', 'artnelli-tg-66-sale'];
export const STORE_KEY = 'artnelli-avito-manual-v1';
export const reasons = {
  on_request_format_not_verified: 'Цена по запросу. Укажите её на Авито только после уточнения.',
  price_variants_need_explicit_mapping: 'В источнике несколько цен. Проверьте, к каким вариантам они относятся.',
  rental_format_and_period_not_verified: 'Аренда: проверьте категорию и период, за который указана цена.',
  category_needs_mapping: 'Выберите категорию Авито, подходящую этому изделию.',
  source_absence_not_confirmed: 'Карточка требует повторной сверки с источником. Перенос приостановлен.',
  unavailable: 'В источнике изделие отмечено недоступным.',
  image_count_needs_review: 'Фотографий больше десяти. Проверьте лимит в своей форме Авито.',
  image_needs_review: 'Часть фотографий требует проверки.',
  no_images: 'Нет подтверждённых фотографий.',
  telegram_id_not_verified: 'Нужно проверить исходную публикацию.',
  offer_kind_not_verified: 'Нужно проверить тип предложения.',
  missing_name: 'Нужно уточнить название.',
  price_must_match_explicit_source_currency: 'Нужно проверить цену и валюту в исходной карточке.',
};
export function validateFeed(feed) {
  if (feed?.schemaVersion !== 1 || feed.source !== 'nelli_leotards' ||
      feed.scope !== 'source_preparation_only' || !Array.isArray(feed.offers) ||
      !feed.offers.length || !Array.isArray(feed.removals)) throw Error('Неполный каталог');
  const ids = new Set();
  for (const o of feed.offers) {
    if (!/^artnelli-tg--?\d+-(sale|rental)$/.test(o.id) || ids.has(o.id) ||
        !Number.isInteger(o.sourceId) || typeof o.fingerprint !== 'string' ||
        !['ready_for_template', 'needs_review', 'held'].includes(o.status) ||
        typeof o.fields?.name !== 'string' || typeof o.fields?.description !== 'string' ||
        !Array.isArray(o.fields.photos) || !o.fields.price || !Array.isArray(o.blockers))
      throw Error('Некорректная карточка');
    ids.add(o.id);
  }
  return feed;
}
export function imagePath(photo) {
  const url = new URL(photo.url, 'https://artnelli.com');
  if (url.origin !== 'https://artnelli.com' || !/^\/assets\/catalog\/[\w.-]+\.(webp|png|jpe?g|avif)$/i.test(url.pathname))
    throw Error('Неизвестный источник фотографии');
  return url.pathname;
}
export function safeAvitoLink(input) {
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' || !['avito.ru','www.avito.ru'].includes(u.hostname) || u.username || u.password)
      return '';
    return u.href;
  } catch { return ''; }
}
export function sourceLink(offer) {
  return offer.sourceId > 0 ? `https://t.me/nelli_leotards/${offer.sourceId}` : 'https://t.me/nelli_leotards';
}
export function makeItems(feed) {
  const offers = validateFeed(feed).offers;
  const byId = new Map(offers.map(o => [o.id, o]));
  const grouped = MONOCHROME.map(id => byId.get(id)).filter(Boolean);
  const remaining = offers.filter(o => !MONOCHROME.includes(o.id));
  const items = remaining.map(o => makeItem([o]));
  if (grouped.length) items.unshift(makeItem(grouped, true));
  return items;
}
function makeItem(offers, group = false) {
  const first = offers[0];
  const fields = first.fields;
  const photos = [...new Map(offers.flatMap(o => o.fields.photos).map(p => [p.sha256 || p.url, p])).values()];
  const blocked = offers.some(o => o.status === 'held' || o.blockers.includes('unavailable')) ||
    (group && offers.length !== MONOCHROME.length);
  const fixed = offers.every(o => o.fields.price.mode === 'fixed' && o.fields.price.currency === 'RUB' && o.fields.price.amount > 0);
  const titleBase = fields.type === 'leotard' ? (/художественн[\s\S]{0,12}гимнаст/iu.test(fields.description) ? 'Гимнастический купальник' : 'Купальник') : '';
  const title = `${titleBase ? titleBase+' ' : ''}«${fields.name}»${group || !fields.height ? '' : `, ${fields.height} см`}`;
  const warnings = [...new Set(offers.flatMap(o => o.blockers).map(b => reasons[b] || 'Проверьте исходную карточку.'))];
  if (group && offers.length !== MONOCHROME.length) warnings.unshift('Изменился состав трёх вариантов в существующем объявлении. Проверьте его целиком.');
  if (offers.some(o => /https?:\/\/|t\.me\/|(?:\+?\d[\s()\-]*){10,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(o.fields.description)))
    warnings.push('В описании есть контакты или ссылки. Проверьте текст и перенесите контакты в отдельные поля Авито.');
  if (fields.condition === 'used') warnings.push('Проверьте город, владельца и актуальное наличие этого изделия.');
  if (photos.length > 10 && !warnings.includes(reasons.image_count_needs_review)) warnings.push(reasons.image_count_needs_review);
  return {
    id: group ? 'monochrome-existing-ad' : first.id, offers, group, blocked, warnings,
    name: fields.name, title, description: offers.map(o => o.fields.description).join('\n\n——————————\n\n'),
    price: fixed && !blocked ? Math.min(...offers.map(o => o.fields.price.amount)) : null,
    priceMode: fixed ? 'fixed' : fields.price.mode,
    condition: fields.condition, height: group ? `${offers.length} размера` : fields.height,
    photos, fingerprint: offers.map(o => `${o.id}:${o.fingerprint}:${o.status}`).join('|'),
  };
}
export function itemStatus(item, records) {
  const record = records[item.id];
  if (item.blocked) return 'review';
  if (record?.fingerprint) return record.fingerprint === item.fingerprint ? 'done' : 'changed';
  return item.group ? 'existing' : 'todo';
}
export function removalTasks(feed, records) {
  const removed = new Set(feed.removals.filter(r => r.reason === 'confirmed_by_shared_catalogue_publisher').map(r => r.sourceId));
  return Object.entries(records).filter(([,r]) => r.sourceIds?.some(id => removed.has(id) && !r.acknowledgedRemovals?.includes(id)))
    .map(([id,r]) => ({id, ...r, removed: r.sourceIds.filter(x => removed.has(x) && !r.acknowledgedRemovals?.includes(x))}));
}
export function readRecords(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Некорректные отметки');
  const records = {};
  for (const [id, r] of Object.entries(value)) {
    if (!(id === 'monochrome-existing-ad' || /^artnelli-tg--?\d+-(sale|rental)$/.test(id)) ||
        !r || typeof r.fingerprint !== 'string' || !Array.isArray(r.sourceIds) ||
        !r.sourceIds.every(Number.isInteger) || typeof r.title !== 'string' ||
        (r.url && !safeAvitoLink(r.url))) throw Error('Некорректная отметка');
    records[id] = {fingerprint:r.fingerprint, sourceIds:r.sourceIds, title:r.title,
      url:r.url || '', savedAt:typeof r.savedAt === 'string' ? r.savedAt : '',
      acknowledgedRemovals:Array.isArray(r.acknowledgedRemovals) ? r.acknowledgedRemovals.filter(Number.isInteger) : []};
  }
  return records;
}

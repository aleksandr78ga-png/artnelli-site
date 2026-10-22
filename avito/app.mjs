import {STORE_KEY, makeItems, itemStatus, removalTasks, readRecords, imagePath, safeAvitoLink, sourceLink, validateFeed} from './model.mjs';
import {zipBlob} from './zip.mjs';

const $ = id => document.getElementById(id);
const labels = {todo:'Ещё не отмечено', existing:'Уже есть на Авито', done:'Отмечено как готовое', changed:'Есть изменения', review:'Нужна проверка'};
const conditions = {new:'Новый', used:'Б/у', rental:'Аренда'};
const rub = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
let feed, items = [], records = {}, active, activeStale = false, loading = false, toastTimer;
const rotations = new Map();

function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action, className) {
  const b = el('button',text,className); b.type = 'button'; b.addEventListener('click',action); return b;
}
function link(text, href, className) {
  const a = el('a',text,className); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'),3800);
}
function saveRecords(next) {
  // Do not show success if the browser rejects persistence.
  localStorage.setItem(STORE_KEY,JSON.stringify(next)); records = next;
}
try { records = readRecords(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
catch { $('error').hidden = false; $('error').textContent = 'Не удалось прочитать отметки этого браузера. Можно продолжить подготовку; сохранённые отметки не перезаписывались.'; }

function priceLabel(item) {
  if (item.price !== null) return `${item.group ? 'от ' : ''}${rub(item.price)}`;
  return item.priceMode === 'on_request' ? 'Цена по запросу' : 'Уточнить цену';
}
function renderCards() {
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filter = $('filter').value;
  const visible = items.filter(item => {
    const text = [item.name,item.height,...item.offers.map(o => o.sourceId),item.description].join(' ').toLocaleLowerCase('ru');
    const status = itemStatus(item,records);
    return (!query || text.includes(query)) && (filter === 'all' ||
      filter === status || (filter === 'todo' && status === 'existing') ||
      filter === item.condition || (filter === 'review' && item.warnings.length));
  });
  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    const card = el('article',undefined,'card'), cover = el('div',undefined,'cover');
    if (item.photos[0]) {
      try { const img = el('img'); img.src = imagePath(item.photos[0]); img.alt = item.name; img.loading = 'lazy'; cover.append(img); } catch {}
    }
    cover.append(el('span',conditions[item.condition] || 'Проверить', 'tag'));
    const body = el('div',undefined,'card-body');
    const status = itemStatus(item,records);
    body.append(el('span',labels[status],`badge ${status}`),el('h2',item.name),
      el('p',item.group ? 'Одно объявление · 3 варианта' : `Рост ${item.height || 'уточнить'} см`,'muted'),
      el('p',priceLabel(item),'card-price'));
    if (item.warnings.length) body.append(el('p','Есть поля для проверки','muted'));
    body.append(button('Открыть подготовку',() => showDetail(item.id)));
    card.append(cover,body); fragment.append(card);
  }
  if (!visible.length) fragment.append(el('p','По этому запросу моделей нет. Попробуйте другое название или фильтр.','empty'));
  $('cards').replaceChildren(fragment);
  $('count').textContent = `${visible.length} из ${items.length} заготовок · ${feed.offers.length} карточек источника`;
  renderRemovals();
}
function renderRemovals() {
  const tasks = removalTasks(feed,records);
  $('removals').hidden = !tasks.length; $('removals').replaceChildren();
  if (!tasks.length) return;
  $('removals').append(el('strong','Из каталога удалены ранее отмеченные вами карточки'),
    el('p','Проверьте соответствующие объявления на Авито: снимите отсутствующее изделие или обновите состав вариантов.'));
  for (const task of tasks) {
    const row = el('div',undefined,'removal-entry');
    row.append(task.url ? link(task.title,task.url) : el('span',task.title));
    row.append(button('Сверено на Авито',() => {
      try {
        const record = {...records[task.id],acknowledgedRemovals:[...new Set([...(records[task.id].acknowledgedRemovals || []),...task.removed])]};
        saveRecords({...records,[task.id]:record}); renderRemovals(); toast('Ваша отметка сохранена');
      } catch { toast('Браузер не сохранил отметку. Скачайте резервную копию.'); }
    }));
    $('removals').append(row);
  }
}

async function refresh(manual = false) {
  if (loading) return;
  loading = true; $('refresh').disabled = true;
  try {
    const response = await fetch('/feeds/avito-source.json',{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Каталог недоступен');
    const next = validateFeed(await response.json());
    const nextItems = makeItems(next);
    feed = next; items = nextItems;
    $('error').hidden = true;
    const modified = response.headers.get('last-modified');
    $('freshness').textContent = modified && !Number.isNaN(Date.parse(modified))
      ? `Версия каталога: ${new Date(modified).toLocaleString('ru-RU')}` : 'Загружена опубликованная версия каталога';
    if (active && $('detail').open) {
      const current = items.find(i => i.id === active.id);
      if (!current || current.fingerprint !== active.fingerprint) staleDetail();
    }
    renderCards(); if (manual) toast('Данные каталога загружены');
  } catch {
    $('error').hidden = false;
    $('error').textContent = feed ? 'Не удалось обновить каталог. Показана предыдущая версия; перенос приостановлен до успешного обновления.' : 'Не удалось загрузить каталог. Нажмите «Обновить каталог» через некоторое время.';
    if (active && $('detail').open) staleDetail();
  } finally { loading = false; $('refresh').disabled = false; }
}
function staleDetail() {
  activeStale = true;
  const node = $('detail-update'); if (node) node.hidden = false;
  document.querySelectorAll('[data-transfer]').forEach(b => { b.disabled = true; });
}
async function copyText(value, field) {
  if (activeStale || active?.blocked || !$('error').hidden) return toast('Сначала обновите каталог и откройте карточку заново.');
  try { await navigator.clipboard.writeText(value); toast('Скопировано — вставьте в поле Авито'); }
  catch {
    field.focus(); field.select();
    try { if (document.execCommand('copy')) return toast('Скопировано — вставьте в поле Авито'); } catch {}
    toast('Текст выделен. Нажмите Ctrl+C, затем вставьте в Авито.');
  }
}
function copyField(label, id, value, multiline = false, disabled = false) {
  const wrap = el('div',undefined,'field'), head = el('div',undefined,'field-head');
  const lab = el('label',label); lab.htmlFor = id;
  const field = el(multiline ? 'textarea' : 'input'); field.id = id; field.value = value; field.readOnly = true;
  if (multiline) field.rows = 12;
  const b = button('Копировать',() => copyText(value,field)); b.dataset.transfer = 'true';
  b.disabled = disabled || active.blocked || !$('error').hidden;
  head.append(lab,b); wrap.append(head,field); return wrap;
}
function showDetail(id) {
  active = items.find(i => i.id === id); if (!active) return;
  activeStale = false; rotations.clear();
  const item = active, content = $('detail-content'); content.replaceChildren();
  content.append(el('h2',item.name,'detail-title')); content.lastChild.id = 'detail-title';
  if (item.group) content.append(el('p','Это существующее объявление с тремя размерами. Обновляйте его целиком, сохраняя все варианты.','muted'));
  const update = el('div',undefined,'notice'); update.id = 'detail-update'; update.hidden = true;
  update.append(el('p','Источник изменился или не удалось проверить обновление. Перед переносом загрузите карточку заново.'),
    button('Открыть актуальную карточку',async () => { await refresh(); if ($('error').hidden) showDetail(id); }));
  content.append(update);
  if (item.warnings.length) {
    const notice = el('div',undefined,'notice');
    for (const warning of item.warnings) notice.append(el('p',warning)); content.append(notice);
  }
  const sources = el('div',undefined,'source-links');
  for (const offer of item.offers) sources.append(link(`Telegram · ${offer.fields.height || offer.sourceId}`,sourceLink(offer)));
  content.append(sources);
  const layout = el('div',undefined,'detail-layout'), fields = el('div'), media = el('div');
  fields.append(copyField('Название','copy-title',item.title),copyField('Описание','copy-description',item.description,true),
    copyField(item.group ? 'Цена в поле Авито — минимальная из вариантов' : 'Цена, ₽','copy-price',item.price === null ? priceLabel(item) : String(item.price),false,item.price === null));
  fields.append(el('p','В описании сохранены данные исходных карточек. Контакты, город, категорию и условия размещения проверьте в форме Авито.','muted'));
  media.append(el('h3',`Фотографии · ${item.photos.length}`));
  const photos = el('div',undefined,'photos');
  item.photos.forEach((photo,index) => {
    const box = el('div',undefined,'photo'), frame = el('div',undefined,'photo-frame'), img = el('img');
    img.alt = `${item.name}, фото ${index + 1}`;
    try { img.src = imagePath(photo); } catch {}
    frame.append(img);
    const rotate = button(`↻ Фото ${index + 1}`,() => {
      const angle = ((rotations.get(index) || 0) + 90) % 360; rotations.set(index,angle);
      img.style.transform = `rotate(${angle}deg) scale(${angle % 180 ? .7 : 1})`;
      toast('Поворот будет учтён в скачанных фотографиях');
    });
    rotate.setAttribute('aria-label',`Повернуть фото ${index + 1} на 90 градусов`);
    box.append(frame,rotate); photos.append(box);
  });
  media.append(photos);
  const download = button('Скачать фото и текст одним архивом',() => downloadPack(item,download),'primary download');
  download.dataset.transfer = 'true'; download.disabled = item.blocked || !$('error').hidden;
  media.append(download,el('p','Распакуйте ZIP. В Авито откройте папку photos и выберите все фото сразу: Ctrl+A. Фотографии сохраняются в PNG.','muted'));
  const finish = el('div',undefined,'finish');
  finish.append(el('h3','После сохранения на Авито'));
  const label = el('label','Ссылка на объявление — чтобы быстро открыть его снова'); label.htmlFor = 'ad-url';
  const url = el('input'); url.type = 'url'; url.id = 'ad-url'; url.placeholder = 'https://www.avito.ru/…'; url.value = records[item.id]?.url || '';
  finish.append(label,url);
  if (records[item.id]?.url) finish.append(link('Открыть своё объявление ↗',records[item.id].url,'button'));
  const done = button('Готово — сохранено на Авито',() => {
    if (activeStale || item.blocked || !$('error').hidden) return toast('Сначала обновите каталог.');
    const raw = url.value.trim(), valid = raw ? safeAvitoLink(raw) : '';
    if (raw && !valid) { url.focus(); return toast('Нужна полная ссылка https://www.avito.ru/…'); }
    const record = {title:item.title, fingerprint:item.fingerprint, sourceIds:item.offers.map(o => o.sourceId), url:valid,
      savedAt:new Date().toISOString(), acknowledgedRemovals:records[item.id]?.acknowledgedRemovals || []};
    try { saveRecords({...records,[item.id]:record}); renderCards(); $('detail').close(); toast('Отметка сохранена в этом браузере'); }
    catch { toast('Браузер не разрешил сохранить отметку. Не закрывайте страницу.'); }
  },'primary');
  done.dataset.transfer = 'true'; done.disabled = item.blocked || !$('error').hidden;
  finish.append(done,el('p','Отметьте только после сохранения на Авито. Когда данные каталога изменятся, здесь появится «Есть изменения».','muted'));
  media.append(finish); layout.append(fields,media); content.append(layout);
  if (!$('detail').open) $('detail').showModal(); $('detail').scrollTop = 0;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}
async function pngBytes(photo, angle) {
  const response = await fetch(imagePath(photo),{cache:'no-cache',signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('Не удалось получить одну из фотографий. Повторите скачивание.');
  const bytes = await response.arrayBuffer();
  if (photo.sha256) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
    if (hash !== photo.sha256) throw Error('Фотография изменилась. Обновите каталог перед скачиванием.');
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = angle % 180 ? bitmap.height : bitmap.width;
  canvas.height = angle % 180 ? bitmap.width : bitmap.height;
  const context = canvas.getContext('2d');
  context.translate(canvas.width/2,canvas.height/2); context.rotate(angle*Math.PI/180);
  context.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2); bitmap.close();
  const png = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
  canvas.width = canvas.height = 0;
  if (!png) throw Error('Не удалось подготовить фотографию.');
  return new Uint8Array(await png.arrayBuffer());
}
async function downloadPack(item, control) {
  if (activeStale || item.blocked || !$('error').hidden) return toast('Обновите каталог перед скачиванием.');
  const original = control.textContent, currentRotations = new Map(rotations);
  control.disabled = true;
  try {
    const files = [
      {name:'01_title.txt',data:item.title}, {name:'02_description.txt',data:item.description},
      {name:'03_price.txt',data:item.price === null ? priceLabel(item) : String(item.price)},
      {name:'README.txt',data:`${item.title}\nПодготовлено: ${new Date().toLocaleString('ru-RU')}\n\n${item.offers.map(o => sourceLink(o)).join('\n')}\n\n${item.warnings.join('\n')}\n\nРаспакуйте архив. Скопируйте название, описание и цену в форму Авито. В папке photos выделите фотографии вместе (Ctrl+A). Проверьте категорию, контакты, город и наличие. Если объявление уже существует, редактируйте его, не создавайте дубль. Проверьте условия и стоимость перед подтверждением на Авито. Этот архив не подключает автоматическую синхронизацию.\n`},
    ];
    for (let i=0;i<item.photos.length;i++) {
      control.textContent = `Готовим фото ${i+1} из ${item.photos.length}…`;
      files.push({name:`photos/photo-${String(i+1).padStart(2,'0')}.png`,data:await pngBytes(item.photos[i],currentRotations.get(i) || 0)});
    }
    if (activeStale || !items.some(x => x.id === item.id && x.fingerprint === item.fingerprint))
      throw Error('Каталог обновился во время подготовки. Откройте карточку заново.');
    downloadBlob(zipBlob(files),`ArtNelli-Avito-${item.offers.map(o => o.sourceId).join('-')}.zip`);
    toast('Архив готов. Распакуйте его и загрузите фото из папки photos.');
  } catch (error) { toast(error.message || 'Не удалось подготовить архив. Попробуйте ещё раз.'); }
  finally { control.textContent = original; control.disabled = activeStale || item.blocked; }
}

$('search').addEventListener('input',() => feed && renderCards());
$('filter').addEventListener('change',() => feed && renderCards());
$('refresh').addEventListener('click',() => refresh(true));
$('close').addEventListener('click',() => $('detail').close());
$('export').addEventListener('click',() => downloadBlob(new Blob([JSON.stringify({version:1,records},null,2)],{type:'application/json'}),'ArtNelli-Avito-marks.json'));
$('import').addEventListener('click',() => $('import-file').click());
$('import-file').addEventListener('change',async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1000000) throw Error();
    const data = JSON.parse(await file.text()); if (data.version !== 1) throw Error();
    const incoming = readRecords(data.records), next = {...records};
    for (const [id,record] of Object.entries(incoming))
      if (!next[id] || record.savedAt > next[id].savedAt) next[id] = record;
    saveRecords(next); if (feed) renderCards(); toast('Отметки загружены');
  } catch { toast('Не удалось загрузить отметки. Выберите файл, скачанный с этой страницы.'); }
  event.target.value = '';
});
window.addEventListener('storage',event => {
  if (event.key !== STORE_KEY) return;
  try { records = readRecords(JSON.parse(event.newValue || '{}')); if (feed) renderCards(); } catch {}
});
document.addEventListener('visibilitychange',() => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); },15000);
refresh();

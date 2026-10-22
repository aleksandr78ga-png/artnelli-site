import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {makeItems, itemStatus, removalTasks, safeAvitoLink, imagePath, readRecords, validateFeed} from '../site/avito/model.mjs';
import {zipBlob,crc32} from '../site/avito/zip.mjs';
// Synthetic source fixtures: routine catalogue edits must not invalidate these tests.
const offer = (sourceId,height,amount,condition='new') => ({
  id:`artnelli-tg-${sourceId}-${condition === 'rental' ? 'rental' : 'sale'}`,sourceId,
  fingerprint:`fixture-${sourceId}`,status:'ready_for_template',blockers:[],fields:{
    name:'Монохром',type:'leotard',height,condition,offerKind:condition === 'rental' ? 'rental' : 'sale',
    description:`Купальник для художественной гимнастики\nРост ${height} см\n${amount ?? 'Цена по запросу'}`,
    price:amount === null ? {mode:'on_request',amount:null} : {mode:'fixed',amount,currency:'RUB'},
    photos:[{url:'https://artnelli.com/assets/catalog/fixture.webp',sha256:'same-photo'}],
  },
});
const real = {schemaVersion:1,source:'nelli_leotards',scope:'source_preparation_only',removals:[],offers:[
  offer(8,'110-130',38900),offer(60,'130-145',41900),offer(66,'140-160',46900),
  offer(2347,'140-160',38000,'used'),offer(9000,'140-160',null),offer(9001,'140-160',4500,'rental'),
]};
const clone = () => structuredClone(real);
test('Cards match website condition/date/ID ordering without pinning or splitting the existing ad',() => {
  const feed = clone();
  feed.offers.forEach(o => {o.sourceDate = '2026-01-01';});
  feed.offers.find(o => o.sourceId === 60).sourceDate = '2026-06-01';
  feed.offers.push({...offer(100,'130-140',50000),sourceDate:'2026-07-01'});
  feed.offers.push({...offer(99,'130-140',50000),sourceDate:'2026-07-01'});
  feed.offers.find(o => o.sourceId === 2347).sourceDate = '2026-10-22';
  const original = JSON.stringify(feed);
  assert.deepEqual(makeItems(feed).map(i => i.id),[
    'artnelli-tg-100-sale','artnelli-tg-99-sale','monochrome-existing-ad',
    'artnelli-tg-9000-sale','artnelli-tg-2347-sale','artnelli-tg-9001-rental',
  ]);
  assert.equal(JSON.stringify(feed),original);
});
test('The existing multi-size ad retains all three Telegram records and price meanings',() => {
  const group = makeItems(real).find(i => i.group);
  assert.deepEqual(group.offers.map(o => o.sourceId),[8,60,66]);
  assert.equal(group.price,38900);
  for (const offer of group.offers) assert(group.description.includes(offer.fields.description));
  assert(!group.title.includes('110-130'));
  assert(!makeItems(real).some(i => i.id === 'artnelli-tg-60-sale'));
  assert.equal(makeItems(real).find(i => i.offers[0].sourceId === 2347).condition,'used');
});
test('A missing or held size cannot silently become a reduced multi-size ad',() => {
  const missing = clone(); missing.offers = missing.offers.filter(o => o.sourceId !== 60);
  const group = makeItems(missing).find(i => i.group);
  assert.equal(group.blocked,true); assert.equal(group.price,null);
  const held = clone(); held.offers.find(o => o.sourceId === 60).status = 'held';
  assert.equal(makeItems(held).find(i => i.group).blocked,true);
});
test('Manual fingerprints detect text/photo changes; request-only prices never become zero',() => {
  const items = makeItems(real), group = items.find(i => i.group);
  const records = {[group.id]:{fingerprint:group.fingerprint}};
  assert.equal(itemStatus(group,records),'done');
  const changed = clone(); changed.offers.find(o => o.sourceId === 8).fingerprint = 'photo-content-changed';
  assert.equal(itemStatus(makeItems(changed).find(i => i.group),records),'changed');
  const onRequest = items.filter(i => i.priceMode === 'on_request'); assert(onRequest.length);
  assert(onRequest.every(i => i.price === null));
  assert(items.filter(i => i.condition === 'rental').every(i => !i.group));
});
test('Only explicit source removals produce manual withdrawal tasks; acknowledgements are local',() => {
  const record = {fingerprint:'x',sourceIds:[8,60,66],title:'Монохром',url:'',savedAt:''};
  const records = {test:record};
  assert.equal(removalTasks({removals:[]},records).length,0);
  assert.equal(removalTasks({removals:[{sourceId:8,reason:'unknown'}]},records).length,0);
  const feed = {removals:[{sourceId:8,reason:'confirmed_by_shared_catalogue_publisher'}]};
  assert.deepEqual(removalTasks(feed,records)[0].removed,[8]);
  assert.equal(removalTasks(feed,{test:{...record,acknowledgedRemovals:[8]}}).length,0);
});
test('Malformed input and unsafe links cannot enter source or restored browser records',() => {
  const invalid = clone(); invalid.offers.push(invalid.offers[0]);
  assert.throws(() => validateFeed(invalid));
  assert.throws(() => validateFeed({...real,offers:[]}));
  for (const url of ['javascript:alert(1)','https://avito.ru.evil.test/ad','https://user:pass@avito.ru/ad','http://avito.ru/ad']) assert.equal(safeAvitoLink(url),'');
  assert.equal(safeAvitoLink('https://www.avito.ru/tyumen/ad_123'),'https://www.avito.ru/tyumen/ad_123');
  assert.throws(() => imagePath({url:'https://evil.test/assets/catalog/photo.webp'}));
  assert.throws(() => readRecords({'artnelli-tg-8-sale':{fingerprint:'x',sourceIds:[8],title:'Монохром',url:'javascript:alert(1)'}}));
});
test('ZIP has correct CRC, UTF-8 content and directory offsets',async () => {
  const bytes = new TextEncoder().encode('123456789'); assert.equal(crc32(bytes),0xcbf43926);
  const zip = new Uint8Array(await zipBlob([{name:'Название.txt',data:'Монохром'}, {name:'photos/photo-01.png',data:bytes}]).arrayBuffer());
  const end = new DataView(zip.buffer,zip.length-22);
  assert.equal(end.getUint32(0,true),0x06054b50); assert.equal(end.getUint16(10,true),2);
  const centralOffset = end.getUint32(16,true);
  assert.equal(new DataView(zip.buffer,centralOffset).getUint32(0,true),0x02014b50);
  assert.equal(centralOffset+end.getUint32(12,true),zip.length-22);
});

test('The actual download handler exports every photo and no text or nested folders',async () => {
  const source = await readFile(new URL('../site/avito/app.mjs',import.meta.url),'utf8');
  const handler = source.slice(source.indexOf('async function downloadPack('),source.indexOf("$('search').addEventListener"));
  const item = makeItems(real).find(i => i.group);
  item.photos = [{url:'first'},{url:'second'},{url:'third'}];
  const calls = []; let downloaded;
  const context = {activeStale:false,items:[item],rotations:new Map([[1,90]]),Map,
    $:() => ({hidden:true}),toast:() => {},zipBlob,
    pngBytes:async (photo,angle) => {calls.push([photo.url,angle]); return new Uint8Array([1,2,3]);},
    downloadBlob:(blob,name) => {downloaded={blob,name};},
  };
  runInNewContext(handler,context);
  const control = {textContent:'Скачать все фотографии',disabled:false};
  await context.downloadPack(item,control);
  assert.deepEqual(calls,[['first',0],['second',90],['third',0]]);
  assert.equal(downloaded.name,'ArtNelli-Photos-8-60-66.zip');
  const bytes = new Uint8Array(await downloaded.blob.arrayBuffer());
  const view = new DataView(bytes.buffer); const names = []; let offset = 0;
  while (view.getUint32(offset,true) === 0x04034b50) {
    const size = view.getUint32(offset+18,true), length = view.getUint16(offset+26,true), extra = view.getUint16(offset+28,true);
    names.push(new TextDecoder().decode(bytes.slice(offset+30,offset+30+length)));
    offset += 30+length+extra+size;
  }
  assert.deepEqual(names,['photo-01.png','photo-02.png','photo-03.png']);
  assert.equal(control.textContent,'Скачать все фотографии');
  assert.equal(control.disabled,false);
});

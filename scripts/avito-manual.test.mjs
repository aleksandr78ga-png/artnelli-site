import test from 'node:test';
import assert from 'node:assert/strict';
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

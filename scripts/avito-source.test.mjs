import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fingerprint, parseCatalog, prepareOffer, prepareSource, previewChanges, verifiedRemovals } from './avito-source.mjs';
import { buildAvitoSource } from './build-avito-source.mjs';

const connection = {schemaVersion:1, mode:'prepare', bindings:{}};
const product = (overrides={}) => ({id:42, name:'Модель', type:'leotard', condition:'new',
  description:'Новый купальник. Цена 71 800 рублей', prices:[71800], height:'130–140',
  specs:{girth:'110–120'}, photos:['assets/catalog/model.jpg'],
  telegram:'https://t.me/nelli_leotards/42', ...overrides});
const imageInfo = new Map([['assets/catalog/model.jpg', {sha256:'original-photo'}]]);
const prepare = (products, rest={}) => prepareSource({products, imageInfo, connection, ...rest});

test('source dates preserve website ordering without changing product fingerprints', () => {
  const a = prepareOffer(product({date:'2026-09-01'}),imageInfo);
  const b = prepareOffer(product({date:'2026-10-22'}),imageInfo);
  assert.equal(a.sourceDate,'2026-09-01');
  assert.equal(b.sourceDate,'2026-10-22');
  assert.equal(a.fingerprint,b.fingerprint);
});

test('price, description, dimensions and photos update the same source offer ID', () => {
  const a=prepareOffer(product(), imageInfo);
  const b=prepareOffer(product({name:'Другое имя',prices:[68500],description:'Цена 68 500 ₽',specs:{girth:'115–125'}}), imageInfo);
  assert.equal(a.id,b.id); assert.notEqual(a.fingerprint,b.fingerprint);
  assert.equal(b.fields.price.amount,68500); assert.equal(b.fields.specs.girth,'115–125');
  const c=prepareOffer(product(), new Map([['assets/catalog/model.jpg',{sha256:'changed-bytes'}]]));
  assert.notEqual(a.fingerprint,c.fingerprint);
});

test('sale and rental of the same model are separate; topic corrects legacy condition', () => {
  const sale=product(); const rental=product({id:43,telegramTopicId:1865,prices:[4500],description:'Аренда. 4 500 ₽'});
  const source=prepare([sale,rental]);
  assert.deepEqual(source.offers.map(x=>x.id),['artnelli-tg-42-sale','artnelli-tg-43-rental']);
  assert.equal(source.offers[1].fields.price.amount,4500);
  assert(source.offers[1].blockers.includes('rental_format_and_period_not_verified'));
});

test('no price stays on request, multiple prices and foreign currency are never guessed', () => {
  const onRequest=prepareOffer(product({prices:[],description:'Цена по запросу'}),imageInfo);
  assert.deepEqual(onRequest.fields.price,{mode:'on_request',amount:null,currency:null});
  const multi=prepareOffer(product({prices:[38900,41900],description:'Чёрный 38 900 ₽; красный 41 900 ₽'}),imageInfo);
  assert.equal(multi.fields.price.mode,'variants'); assert.equal(multi.fields.price.amount,null);
  const foreign=prepareOffer(product({prices:[1200],description:'1200 USD'}),imageInfo);
  assert.equal(foreign.fields.price.amount,null);
  const missingRub=prepareOffer(product({prices:[],description:'Цена 50 000 ₽'}),imageInfo);
  assert.equal(missingRub.fields.price.mode,'unverified');
});

test('disagreement, zero, bad IDs and missing photos block preparation for import', () => {
  for (const p of [product({prices:[0]}),product({prices:[68500]}),product({id:-1}),product({photos:['https://example.com/p.jpg']})]) {
    assert.equal(prepareOffer(p,imageInfo).status,'needs_review');
  }
  assert.throws(()=>parseCatalog('window.NELLI_CATALOG=[];'));
  assert.throws(()=>parseCatalog('window.NELLI_CATALOG='+JSON.stringify([product(),product()])+';'));
  assert.throws(()=>parseCatalog('window.NELLI_CATALOG='+JSON.stringify([product({photos:null})])+';'));
});

test('a partial source or changed sale/rental role never instructs withdrawal', () => {
  const previous=prepare([product(),product({id:43})]);
  const source=prepare([product()],{previous});
  assert.equal(source.offers.find(x=>x.sourceId===43).status,'held');
  assert.deepEqual(source.removals,[]);
  const changedRole=prepare([product({condition:'rental'})],{previous});
  assert.equal(changedRole.offers.find(x=>x.id==='artnelli-tg-42-sale').status,'held');
  assert.deepEqual(changedRole.removals,[]);
});

test('confirmed removals survive later builds and only target verified Avito bindings', () => {
  const previous=prepare([product(),product({id:43})]);
  const source=prepare([product()],{previous,removedIds:[43]});
  assert.equal(source.offers.length,1); assert.equal(source.removals[0].sourceId,43);
  const bound={...connection,bindings:{'artnelli-tg-43-sale':{avitoId:'12345678',verified:true}}};
  const plan=previewChanges(source,bound);
  assert.equal(plan.executable,false);
  assert.equal(plan.changes[1].action,'withdraw_after_receiver_validation');
  assert.equal(plan.changes[1].avitoId,'12345678');
  assert.equal(prepare([product()],{previous:source}).removals.length,1);
  assert.equal(prepare([product(),product({id:43})],{previous:source}).removals.length,0);
  assert.throws(()=>prepare([product()],{removedIds:[42]}));
});

test('unknown existing inventory never creates duplicates; matching is never name-based', () => {
  const source=prepare([product(),product({id:43})]);
  const bound={...connection,bindings:{'artnelli-tg-42-sale':{avitoId:'123',verified:true}}};
  assert.deepEqual(previewChanges(source,bound).changes.map(x=>x.action),['update','await_inventory_match']);
  assert.equal(previewChanges(source,bound,{[source.offers[0].id]:source.offers[0].fingerprint}).changes[0].action,'unchanged');
  assert.throws(()=>previewChanges(source,{...bound,bindings:{...bound.bindings,'artnelli-tg-43-sale':{avitoId:'123',verified:true}}}));
  assert.throws(()=>prepare([product()],{connection:{...connection,mode:'live'}}));
});

test('removal evidence is bound to the exact complete published catalogue', () => {
  const source='window.NELLI_CATALOG='+JSON.stringify([product()])+';';
  const checkpoint={schemaVersion:1,source:'shared-catalogue-publisher',catalogSha256:fingerprint(source),confirmedRemovedIds:[43]};
  assert.deepEqual(verifiedRemovals(checkpoint,source),[43]);
  assert.throws(()=>verifiedRemovals(checkpoint,source+'\n'));
  assert.throws(()=>verifiedRemovals({...checkpoint,confirmedRemovedIds:[-1]},source));
});

test('CLI preparation preserves its previous output on failure and is deterministic', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'avito-source-'));
  try {
    await mkdir(path.join(root,'site/assets/catalog'),{recursive:true});
    await mkdir(path.join(root,'data'));
    await writeFile(path.join(root,'data/avito-connection.json'),JSON.stringify(connection));
    const catalog=path.join(root,'site/catalog-data.js');
    await writeFile(catalog,'window.NELLI_CATALOG='+JSON.stringify([product()])+';');
    await writeFile(path.join(root,'site/assets/catalog/model.jpg'),Buffer.from([1,2,3]));
    await buildAvitoSource(root);
    const output=path.join(root,'site/feeds/avito-source.json');
    const before=await readFile(output,'utf8');
    await buildAvitoSource(root); assert.equal(await readFile(output,'utf8'),before);
    await assert.rejects(buildAvitoSource(root,true),/checkpoint required/);
    await writeFile(catalog,'window.NELLI_CATALOG=[];');
    await assert.rejects(buildAvitoSource(root));
    assert.equal(await readFile(output,'utf8'),before);
  } finally { await rm(root,{recursive:true,force:true}); }
});

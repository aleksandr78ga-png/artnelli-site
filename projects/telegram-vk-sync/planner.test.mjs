import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProduct, planSync, sourceKey, targetStillMatches} from './planner.mjs';

const NOW = '2026-09-29T13:48:00Z';
const product = (extra={}) => ({id:3062,name:'Кармин',condition:'new',prices:[71800],height:'144-155',
  specs:{chest:'70-80',waist:'58-65',hips:'72-82',girth:'124-134'},
  description:'Кармин 71 800 рублей. Контакт клиента: +7 900 123 45 67, адрес не переносить.',
  photos:['assets/catalog/carmin.webp'],telegram:'https://t.me/nelli_leotards/3062',...extra});
const source = products => ({channel:'nelli_leotards',complete:true,checkedAt:NOW,products});
const binding = p => ({sourceKey:sourceKey(p),ownerId:-123,itemId:900,confirmed:true});
const item = (p, extra={}) => ({ownerId:-123,itemId:900,fields:normalizeProduct(p).fields,...extra});
const snapshot = items => ({ownerId:-123,complete:true,checkedAt:NOW,items});
function preview(p=product(), options={}) {return planSync({source:source([p]),vk:snapshot([item(p)]),bindings:[binding(p)],now:NOW,...options});}

test('edited price updates the same bound VK identity; no replacement',()=>{
  const old=product({prices:[68500]}); const p=product();
  const r=preview(p,{vk:snapshot([item(old)])});
  assert.equal(r.rows[0].status,'update_candidate');
  assert.deepEqual(r.rows[0].target,{ownerId:-123,itemId:900});
  assert.deepEqual(r.rows[0].changedFields,['price']);
  assert.equal(r.rows[0].desired.price.amountRub,71800);
  assert.equal(r.summary.creates,0);assert.equal(r.summary.deletes,0);
  assert.equal(r.writesEnabled,false);assert.equal(r.applySupported,false);
});

test('repeating an applied state proposes no duplicate or repeated update',()=>{
  const r=preview();assert.equal(r.summary.unchanged,1);assert.equal(r.summary.updateCandidates,0);
  assert.deepEqual(r,preview());
});

test('unknown mapping never matches a name and never creates a duplicate',()=>{
  const r=preview(product(),{bindings:[]});
  assert.equal(r.rows[0].status,'review_required');
  assert.ok(r.rows[0].reasons.includes('mapping_required_no_automatic_creation'));
  assert.equal(r.rows[0].target,null);assert.equal(r.summary.creates,0);
});

test('price on request remains null and waits for VK verification',()=>{
  const r=preview(product({prices:[]}));
  assert.deepEqual(r.rows[0].desired.price,{mode:'on_request',amountRub:null,currency:'RUB'});
  assert.ok(r.rows[0].reasons.includes('price_on_request_vk_unverified'));
});

test('two colour prices are retained without choosing min/max',()=>{
  const r=preview(product({id:538,prices:[38900,41900],telegram:'https://t.me/nelli_leotards/538'}));
  assert.deepEqual(r.rows[0].desired.price.amountsRub,[38900,41900]);
  assert.ok(r.rows[0].reasons.includes('multiple_prices_need_offer_mapping'));
});

test('sale and rental with the same title remain distinct',()=>{
  const a=product({id:4197,name:'Ярко-красный',telegram:'https://t.me/nelli_leotards/4197'});
  const b=product({id:4206,name:'Ярко-красный',condition:'rental',prices:[4500],telegram:'https://t.me/nelli_leotards/1865/4206'});
  const r=planSync({source:source([a,b]),vk:snapshot([item(a),item(b,{itemId:901})]),
    bindings:[binding(a),{...binding(b),itemId:901}],now:NOW});
  assert.equal(r.summary.unchanged,2);assert.notEqual(r.rows[0].sourceKey,r.rows[1].sourceKey);
  assert.equal(r.rows[1].desired.transactionType,'rent');
  assert.equal(r.rows[1].desired.name,'Аренда · Ярко-красный');
  assert.doesNotMatch(r.rows[1].desired.description,/сутк|день|недел/);
});

test('two offers cannot overwrite the same VK item',()=>{
  const a=product(),b=product({id:4206,condition:'rental',telegram:'https://t.me/nelli_leotards/4206'});
  const r=planSync({source:source([a,b]),vk:snapshot([item(a)]),bindings:[binding(a),binding(b)],now:NOW});
  assert.ok(r.blockers.includes('vk_item_bound_to_multiple_offers'));assert.equal(r.summary.updateCandidates,0);
});

test('a missing Telegram item is retained in VK, never deleted',()=>{
  const r=preview(product(),{source:source([])});
  assert.equal(r.retained[0].action,'retain');assert.equal(r.summary.deletes,0);
});

test('partial and absent snapshots block all updates',()=>{
  for(const overrides of [{source:{...source([product()]),complete:false}}, {vk:null},
    {vk:{...snapshot([item(product())]),complete:false}}]){
    const r=preview(product(),overrides);assert.equal(r.summary.updateCandidates,0);assert.equal(r.summary.needsReview,1);
  }
});

test('stale snapshots cannot plan updates',()=>{
  const r=preview(product(),{vk:{...snapshot([item(product())]),checkedAt:'2026-09-28T13:48:00Z'}});
  assert.ok(r.blockers.includes('vk_snapshot_stale_or_unverified'));
});

test('wrong community or channel blocks changes',()=>{
  let r=preview(product(),{bindings:[{...binding(product()),ownerId:-456}]});
  assert.ok(r.blockers.includes('binding_owner_mismatch'));
  r=preview(product(),{source:{...source([product()]),channel:'NelliGarkusha'}});
  assert.ok(r.blockers.includes('wrong_telegram_channel'));
});

test('unconfirmed, duplicate and missing bindings fail closed',()=>{
  for(const overrides of [{bindings:[{...binding(product()),confirmed:false}]},
    {bindings:[binding(product()),binding(product())]}, {vk:snapshot([])}]){
    const r=preview(product(),overrides);assert.equal(r.summary.updateCandidates,0);assert.equal(r.summary.needsReview,1);
  }
});

test('malformed prices, removed products and unknown offer type need review',()=>{
  for(const change of [{prices:[0]},{prices:[-10]},{prices:['71800']},{prices:[Infinity]},
    {prices:[NaN]}, {prices:null}, {condition:'unknown'}, {removed:true}, {sold:true}]){
    const r=preview(product(change));assert.equal(r.summary.needsReview,1);
  }
});

test('duplicate source or target identities are not silently collapsed',()=>{
  let r=preview(product(),{source:source([product(),product({prices:[68500]})])});
  assert.equal(r.rows.length,2);assert.ok(r.rows.every(x=>x.reasons.includes('duplicate_source_id')));
  r=preview(product(),{vk:snapshot([item(product()),item(product())])});
  assert.ok(r.blockers.includes('duplicate_vk_item_identity'));
});

test('unverified VK fields and sale/rental mismatch block changes',()=>{
  let r=preview(product(),{vk:snapshot([item(product(),{fields:{name:'Кармин'}})])});
  assert.ok(r.rows[0].reasons.includes('vk_fields_not_verified'));
  r=preview(product(),{vk:snapshot([item(product(),{fields:{...normalizeProduct(product()).fields,transactionType:'rent'}})])});
  assert.ok(r.rows[0].reasons.includes('sale_rental_conflict'));
});

test('concurrent manual VK edits invalidate the observed-state guard',()=>{
  const old=item(product({prices:[68500]}));const r=preview(product(),{vk:snapshot([old])});
  assert.equal(targetStillMatches(r.rows[0],old),true);
  assert.equal(targetStillMatches(r.rows[0],{...old,fields:{...old.fields,price:{...old.fields.price,amountRub:70000}}}),false);
  assert.equal(targetStillMatches(r.rows[0],{...old,itemId:901}),false);
});

test('free-text personal contact data are omitted; source URL stays exact',()=>{
  const p=normalizeProduct(product());assert.doesNotMatch(p.fields.description,/900 123|адрес|Контакт/);
  assert.match(p.fields.description,/https:\/\/t.me\/nelli_leotards\/3062/);
});

test('photos and Telegram source links cannot silently switch origin or identity',()=>{
  for(const change of [{photos:['https://wrong.example/a.jpg']},{photos:[]},
    {telegram:'https://t.me/nelli_leotards/999'},{telegram:'https://t.me/NelliGarkusha/3062'}]){
    assert.ok(normalizeProduct(product(change)).issues.length>0);
  }
});

test('planner makes no network requests and does not mutate inputs',()=>{
  const p=product(),args={source:source([p]),vk:snapshot([item(p)]),bindings:[binding(p)],now:NOW};
  const before=JSON.stringify(args),original=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('Network is forbidden in preflight')};
  try{planSync(args);assert.equal(JSON.stringify(args),before)}finally{globalThis.fetch=original}
});

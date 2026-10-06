import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPostsFromAlbums,normalizeHistoryObservation,withHistoryMessageIds} from './catalog-observation.mjs';
import {recordCatalogHistory} from './catalog-history.mjs';
const known=[{id:5461,name:'Изумруд',telegramTopicId:1864},{id:2827,name:'Peach',telegramTopicId:1865}];
const album={rootId:5455,mainId:5455,isAlbum:true,memberIds:[5455,5456,5457,5458,5459,5460,5461],
  topicId:1864,ownText:'Продаётся купальник «Изумруд». Рост 140–150 см'};
test('a published caption ID remains present when Telegram displays a different album root',()=>{
  const first={channel:'nelli_leotards',source:'authenticated-telegram-catalog',scope:'all-product-topics',
    complete:true,reachedStart:true,reachedEnd:true,allProductTopicsRead:true,checkedAt:'2026-10-06T06:00:00Z',albums:[album]};
  let state=recordCatalogHistory(null,normalizeHistoryObservation(first,known),known);
  state=recordCatalogHistory(state,normalizeHistoryObservation({...first,checkedAt:'2026-10-06T06:11:00Z'},known),known);
  assert.equal(state.records.find(p=>p.id===5461).removed,false);
  assert.equal(state.records.find(p=>p.id===2827).removed,true);
  assert.equal(state.records.some(p=>p.id===5455),false);
  assert.equal(state.records.find(p=>p.id===5461).observedAlbumRootId,5455);
});
test('unobserved gaps and matching names never prove a published message is present',()=>{
  const posts=catalogPostsFromAlbums([{...album,memberIds:[5455,5462]}],known);
  assert.ok(!posts.some(p=>p.id===5461));
});
test('partial albums without member metadata are rejected before advancing absence counters',()=>{
  assert.throws(()=>catalogPostsFromAlbums([{...album,memberIds:[]}],known));
});
test('a later virtualized album fragment retains the full observed member set',()=>{
  const [post]=catalogPostsFromAlbums([album,{...album,rootId:5459,mainId:5459,memberIds:[5459,5460,5461],ownText:''}],known);
  assert.equal(post.observedAlbumRootId,5455);
  assert.deepEqual(post.observedMessageIds,album.memberIds);
});
test('quoted price replies are not separate catalogue products',()=>{
  assert.deepEqual(catalogPostsFromAlbums([{rootId:5602,memberIds:[],isAlbum:false,isReply:true,
    ownText:'Продаётся купальник «Green fantasy», рост 125-135 см. Стоимость снижена до 30 000 ₽.'}],known),[]);
});
test('separate rentals and sales with the same name keep their own IDs',()=>{
  const products=[{id:5726,name:'Танец огня'},{id:5733,name:'Танец огня'}];
  assert.deepEqual(catalogPostsFromAlbums([{rootId:5726,memberIds:[5726],topicId:1865},
    {rootId:5733,memberIds:[5733],topicId:1864}],products).map(p=>p.id),[5726,5733]);
});
test('removing one photo does not delete a still present album',()=>{
  const products=withHistoryMessageIds(known,{records:[{id:5461,observedAlbumRootId:5455,
    observedMessageIds:album.memberIds}]});
  const remaining={...album,rootId:5456,mainId:5456,memberIds:[5456,5457,5458]};
  assert.equal(catalogPostsFromAlbums([remaining],products)[0].id,5461);
  assert.ok(!catalogPostsFromAlbums([{...remaining,rootId:5500,mainId:5500,memberIds:[5500]}],products)
    .some(p=>p.id===5461));
});

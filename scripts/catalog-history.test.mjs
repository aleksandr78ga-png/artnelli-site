import test from 'node:test';
import assert from 'node:assert/strict';
import {recordCatalogHistory,confirmedCatalogRemovalIds} from './catalog-history.mjs';
const observation={channel:'nelli_leotards',source:'authenticated-telegram-catalog',scope:'all-product-topics',
  complete:true,reachedStart:true,reachedEnd:true,allProductTopicsRead:true,checkedAt:'2026-10-06T01:00:00Z',posts:[{id:8,name:'Монохром'}]};
test('partial, rental-only and failed reads cannot remove a stock card',()=>{
  const previous=recordCatalogHistory(null,observation,[{id:8},{id:5426}]);
  for(const change of [{complete:false},{allProductTopicsRead:false},{reachedStart:false},{source:'authenticated-telegram-topic'}])
    assert.equal(recordCatalogHistory(previous,{...observation,...change,checkedAt:'2026-10-06T02:00:00Z'}),previous);
  assert.deepEqual(confirmedCatalogRemovalIds(previous),[]);
});
test('two full separated reads remove an absent post and reappearance resets evidence',()=>{
  let state=recordCatalogHistory(null,observation,[{id:8},{id:5426}]);
  state=recordCatalogHistory(state,{...observation,checkedAt:'2026-10-06T01:09:59Z'});
  assert.deepEqual(confirmedCatalogRemovalIds(state),[]);
  state=recordCatalogHistory(state,{...observation,checkedAt:'2026-10-06T02:00:00Z'});
  assert.deepEqual(confirmedCatalogRemovalIds(state),[5426]);
  state=recordCatalogHistory(state,{...observation,checkedAt:'2026-10-06T03:00:00Z',posts:[{id:8},{id:5426}]});
  assert.deepEqual(confirmedCatalogRemovalIds(state),[]);
});

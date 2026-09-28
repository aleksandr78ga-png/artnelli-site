import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRentalHistory, confirmedRentalRemovalIds} from './rental-history.mjs';

const observation = (minute, ids = [2827,2840,4206,5726]) => ({
  channel:'nelli_leotards', topicId:1865, source:'authenticated-telegram-topic',
  checkedAt:new Date(Date.UTC(2026,8,28,10,minute)).toISOString(),
  complete:true, reachedStart:true, reachedEnd:true, posts:ids.map(id=>({id})),
});
const initial = () => recordRentalHistory(null, observation(0));

test('partial history, another topic, and a login failure cannot remove products',()=>{
  const state = initial();
  for (const override of [{complete:false},{reachedStart:false},{reachedEnd:false},{topicId:2},{source:'public-widget'}]) {
    assert.equal(recordRentalHistory(state,{...observation(60,[]),...override}),state);
  }
});
test('absence needs two complete observations separated by ten minutes',()=>{
  const one = recordRentalHistory(initial(),observation(60,[2840,4206,5726]));
  assert.deepEqual(confirmedRentalRemovalIds(one),[]);
  const tooSoon = recordRentalHistory(one,observation(61,[2840,4206,5726]));
  assert.deepEqual(confirmedRentalRemovalIds(tooSoon),[]);
  const two = recordRentalHistory(tooSoon,observation(120,[2840,4206,5726]));
  assert.deepEqual(confirmedRentalRemovalIds(two),[2827]);
});
test('returning publication clears deletion evidence without touching other IDs',()=>{
  const missing = recordRentalHistory(recordRentalHistory(initial(),observation(60,[])),observation(120,[]));
  const restored = recordRentalHistory(missing,observation(180,[2827]));
  assert.deepEqual(confirmedRentalRemovalIds(restored),[2840,4206,5726]);
  assert.equal(restored.records.find(p=>p.id===2827).missingChecks,0);
});
test('a rental arriving via bot between history checks is tracked; a sale is not',()=>{
  const known = [{id:6000,telegramTopicId:1865,name:'New rental'},{id:2499,telegramTopicId:1864,name:'Yellow gold'}];
  const next = recordRentalHistory(initial(),observation(60),known);
  assert.equal(next.records.find(p=>p.id===6000).missingChecks,1);
  assert.equal(next.records.some(p=>p.id===2499),false);
});
test('stale snapshots and forged deletion without evidence are rejected',()=>{
  assert.throws(()=>recordRentalHistory(initial(),observation(0)),/newer/);
  const bad = initial(); bad.records[0].removed = true;
  assert.throws(()=>confirmedRentalRemovalIds(bad),/two complete/);
});

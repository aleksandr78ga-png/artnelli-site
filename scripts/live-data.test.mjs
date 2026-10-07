import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const source=readFileSync(new URL('site/api/live-data.js',root),'utf8');
test('shared loader applies successive edits, avoids duplicate renders and survives upstream errors',async()=>{
  let poll,pollDelay,reply={telegram:{ok:true,products:[{id:8,prices:[38900]}],statuses:[]}},fail=false,calls=0;
  const events=[],listeners={};const document={hidden:false,addEventListener(type,listener){listeners[type]=listener}};
  const window={addEventListener(type,listener){listeners[type]=listener},dispatchEvent(event){events.push(event)}};
  const context=vm.createContext({window,document,navigator:{onLine:true},AbortController,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    setInterval(fn,delay){poll=fn;pollDelay=delay},setTimeout(){return 1},clearTimeout(){},fetch:async()=>{calls++;return {ok:!fail,json:async()=>reply}}});
  vm.runInContext(source,context);await new Promise(setImmediate);
  assert.equal(pollDelay,15000);assert.equal(typeof listeners.focus,'function');
  assert.equal(events.length,1);await poll();assert.equal(events.length,1);
  reply={telegram:{ok:true,products:[{id:8,prices:[41900]}],statuses:[]}};await poll();assert.equal(events.length,2);
  fail=true;await poll();assert.equal(window.NELLI_LIVE.telegram.products[0].prices[0],41900);
  document.hidden=true;const previous=calls;await poll();assert.equal(calls,previous);
});
for(const platform of ['telegram','max'])test(platform+' applies repeated price updates and confirmed removals with valid absolute media URLs',()=>{
  const source=readFileSync(new URL('site/'+platform+'/app.js',root),'utf8');
  assert.ok(!source.includes('{ once: true }'));
  const helpers=source.slice(source.indexOf('  const normalize ='),source.indexOf('  function modelWord'));
  const products=[{id:8,name:'Монохром',prices:[38900],photos:['assets/catalog/a.webp'],date:'2023-09-11'}];
  const window={NELLI_CATALOG:products,NELLI_LIVE:{telegram:{products:[],statuses:[]}}};
  const context=vm.createContext({window,state:{products:[]},updateConditionCounts(){}});
  vm.runInContext(helpers+';globalThis.merge=mergeProducts;globalThis.photo=photoUrl;',context);
  context.merge();window.NELLI_LIVE.telegram.products=[{...products[0],prices:[41900],photos:['https://artnelli.com/assets/catalog/a.webp']}];
  context.merge();assert.equal(context.state.products[0].prices[0],41900);
  assert.equal(context.photo(context.state.products[0].photos[0]),'https://artnelli.com/assets/catalog/a.webp');
  window.NELLI_LIVE.telegram.products[0].prices=[45000];context.merge();assert.equal(context.state.products[0].prices[0],45000);
  window.NELLI_LIVE.telegram.statuses=[{id:8,removed:true}];context.merge();assert.equal(context.state.products.length,0);
});

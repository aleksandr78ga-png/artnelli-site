import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogOffer, reconcileImportedRentals } from './catalog-offer.mjs';

test('rental offer stays rental when the upstream feed labels it new', () => {
  const input = {id:5726, condition:'new', prices:[4500], description:'Аренда ❤️\nКупальник «Танец огня»\nСтоимость аренды — 4 500 ₽', descriptionEn:'For sale\nNew rhythmic gymnastics leotard “Tanets ognya”'};
  const output = normalizeCatalogOffer(input);
  assert.equal(output.condition,'rental');
  assert.deepEqual(output.prices,[4500]);
  assert.equal(output.description,input.description);
  assert.match(output.descriptionEn,/^For rent\nrhythmic/);
  assert.deepEqual(normalizeCatalogOffer({...output, condition:'new'}),output);
});

test('pre-owned sale mentioning rental keeps its sale category and price', () => {
  for (const description of ['Продаётся б/у (аренда) купальник «Танец огня»','Б/у, (аренда)\nКупальник «Ярко-красный»']) {
    const input = {condition:'used',prices:[39000],description};
    assert.deepEqual(normalizeCatalogOffer(input),input);
  }
});

test('new sales are unaffected; decorated rental heading is recognized', () => {
  const sale={condition:'new',description:'🌟 Новый купальник',prices:[83700]};
  assert.deepEqual(normalizeCatalogOffer(sale),sale);
  assert.equal(normalizeCatalogOffer({...sale,description:'🔥 Аренда ❤️\nКупальник'}).condition,'rental');
});

test('confirmed rental topic determines the category even without a heading', () => {
  assert.equal(normalizeCatalogOffer({telegramTopicId:1865, condition:'new', description:'Купальник «Peach»'}).condition, 'rental');
});

test('real rental replaces its screenshot import; sale and ambiguous matches do not', () => {
  const imported = {id:-186501, name:'Peach', height:'105-125', specs:{chest:'54-64',waist:'48-56',hips:'54-64',girth:'102-112'}, condition:'rental', prices:[3500], sourceImport:'owner-screenshots-2026-09-28'};
  const sale = {...imported,id:2833,condition:'used',prices:[26700],sourceImport:undefined};
  assert.equal(reconcileImportedRentals([imported,sale]).length,2);
  const rental = {...imported,id:6000,sourceImport:undefined,prices:[4000]};
  const result = reconcileImportedRentals([imported,sale,rental]);
  assert.deepEqual(result.map(p=>p.id),[2833,6000]);
  assert.deepEqual(result[1].prices,[4000]);
  assert.equal(reconcileImportedRentals([imported,rental,{...rental,id:6001}]).length,3);
});

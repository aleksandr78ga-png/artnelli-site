import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogOffer } from './catalog-offer.mjs';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeProduct} from './planner.mjs';

// Reuse the existing parser; do not install another bot or change its webhook.
const parserPath = process.env.NELLI_TELEGRAM_PARSER_PATH;
const parse = parserPath ? (await import(pathToFileURL(resolve(parserPath)))).parseTelegramBotUpdates : null;
const options = {skip:parse ? false : 'Set NELLI_TELEGRAM_PARSER_PATH to the existing server/index.js'};
const caption = 'Продается купальник «Кармин»\nРост 144-155 см\nСтарая стоимость 68 500 рублей\nСтоимость 71 800 рублей';
const message = {message_id:3062,chat:{username:'nelli_leotards'},date:1700000000,edit_date:1700001000,caption,
  caption_entities:[{type:'strikethrough',offset:caption.indexOf('68 500'),length:6}],photo:[{file_id:'test-photo-no-network'}]};

test('existing Telegram parser: edited channel caption keeps 71800 and removes struck price',options,()=>{
  const p=parse([{edited_channel_post:message}]).products[0];
  assert.deepEqual(p.prices,[71800]);assert.equal(normalizeProduct(p).fields.price.amountRub,71800);
});
test('existing Telegram parser: another workshop channel is not the product source',options,()=>{
  assert.equal(parse([{channel_post:{...message,chat:{username:'NelliGarkusha'}}}]).products.length,0);
});
test('existing Telegram parser: forum rental topic stays rental through preflight',options,()=>{
  const p=parse([{message:{...message,message_id:4206,message_thread_id:1865,
    caption:'Аренда\nКупальник «Ярко-красный»\nРост 140-150 см\nСтоимость 4 500 рублей',caption_entities:[]}}]).products[0];
  const normalized=normalizeProduct(p);assert.equal(normalized.fields.transactionType,'rent');
  assert.equal(normalized.fields.price.amountRub,4500);assert.equal(normalized.issues.length,0);
});

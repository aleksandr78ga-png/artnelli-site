import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {recordRentalHistory} from './rental-history.mjs';
import {normalizeHistoryObservation,withHistoryMessageIds} from './catalog-observation.mjs';

if (!process.argv[2]) throw new Error('Pass a JSON observation from the authenticated rental topic');
const stateFile = fileURLToPath(new URL('../data/telegram-rental-history.json', import.meta.url));
const catalogFile = fileURLToPath(new URL('../site/catalog-data.js', import.meta.url));
const previous = JSON.parse(await readFile(stateFile, 'utf8'));
const observation = JSON.parse(await readFile(process.argv[2], 'utf8'));
const source = await readFile(catalogFile, 'utf8');
const catalog = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
const next = recordRentalHistory(previous, normalizeHistoryObservation(observation, withHistoryMessageIds(catalog,previous)), catalog);
if (next === previous) throw new Error('Incomplete topic observation: history and catalogue left unchanged');
await writeFile(stateFile, JSON.stringify(next, null, 2) + '\n');
console.log(JSON.stringify({checkedAt:next.checkedAt, tracked:next.records.length,
  pending:next.records.filter(p=>p.missingChecks && !p.removed).map(p=>p.id),
  removed:next.records.filter(p=>p.removed).map(p=>p.id)}));

import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCatalog, photoPath, fingerprint, prepareSource, verifiedRemovals } from './avito-source.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function optionalJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function buildAvitoSource(root = defaultRoot, requireCheckpoint = false) {
  const source = await readFile(path.join(root, 'site/catalog-data.js'), 'utf8');
  const products = parseCatalog(source);
  const connection = await optionalJson(path.join(root, 'data/avito-connection.json'));
  const checkpoint = await optionalJson(path.join(root, '.avito-source-input.json'));
  if (requireCheckpoint && !checkpoint) throw new Error('Successful shared catalogue sync checkpoint required');
  const removedIds = checkpoint ? verifiedRemovals(checkpoint, source) : [];
  const output = path.join(root, 'site/feeds/avito-source.json');
  const previous = await optionalJson(output);
  const imageInfo = new Map();
  for (const value of new Set(products.flatMap(p => p.photos))) {
    let relative;
    try { relative = photoPath(value); } catch { continue; }
    try {
      const bytes = await readFile(path.join(root, 'site', relative));
      if (bytes.length) imageInfo.set(relative, {sha256:fingerprint(bytes)});
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const payload = prepareSource({products, imageInfo, connection, previous, removedIds});
  const json = JSON.stringify(payload, null, 2) + '\n';
  if (JSON.stringify(previous) !== JSON.stringify(payload)) {
    await mkdir(path.dirname(output), {recursive:true});
    // Only replace the previous payload after the complete preparation succeeds.
    const tmp = output + '.tmp';
    await writeFile(tmp, json);
    await rename(tmp, output);
  }
  const count = status => payload.offers.filter(p => p.status === status).length;
  console.log(`Avito source only: ${products.length} source cards, ${count('ready_for_template')} ready for template, ${count('needs_review')} need review, ${count('held')} held. No Avito requests.`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildAvitoSource(defaultRoot, process.argv.includes('--require-checkpoint')).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}

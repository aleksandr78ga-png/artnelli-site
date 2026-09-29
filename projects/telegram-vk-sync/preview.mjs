import { readFileSync } from 'node:fs';
import { planSync } from './planner.mjs';

// Local files only. No tokens, API calls, database writes or implicit clock.
const [sourcePath, vkPath, bindingsPath, now] = process.argv.slice(2);
if (!sourcePath || !now || process.argv.length !== 6) {
  console.error('Usage: node preview.mjs source.json vk.json|- bindings.json|- NOW_ISO');
  process.exitCode = 2;
} else {
  try {
    const read = path => {
      if (/^\w+:\/\//.test(path)) throw new Error('Only local input files are allowed');
      return JSON.parse(readFileSync(path,'utf8'));
    };
    const result = planSync({source:read(sourcePath), vk:vkPath === '-' ? null : read(vkPath),
      bindings:bindingsPath === '-' ? [] : read(bindingsPath), now});
    process.stdout.write(JSON.stringify(result,null,2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}

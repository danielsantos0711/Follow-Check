// Runs the native 2.5.9 regression suite against the current engine.
// The 2.5.11 engine deliberately replaces the 2.5.9 rendered-list Watchlist reader
// with validated REST pagination and discards checkpoints without v4 proof.
// FollowCheck 2.6 (build 37) restores the rendered list reader for other accounts'
// followers; it returns a terminal list even when the counter differs, and the engine
// decides. The tests for those replaced behaviours must fail; every other test must pass.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const superseded = new Set([
  'List checkpoints persist across engine recreation and expire without becoming snapshots',
  'Terminal duplicates and a one-person gap never become fabricated complete lists',
  'Watchlist collection prefers the rendered list and rejects an incomplete native reply',
]);

const suite = fileURLToPath(new URL('./runtime-regression.mjs', import.meta.url));
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', suite], {encoding: 'utf8'});
const results = [...run.stdout.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(([, status, name]) => ({name, ok: status === 'ok'}));
if (!results.length) throw new Error('The 2.5.9 suite produced no results.\n' + run.stderr);

const unexpectedFailures = results.filter(r => !r.ok && !superseded.has(r.name));
const unexpectedPasses = results.filter(r => r.ok && superseded.has(r.name));
const missing = [...superseded].filter(name => !results.some(r => r.name === name));
if (unexpectedFailures.length || unexpectedPasses.length || missing.length) {
  for (const r of unexpectedFailures) console.error('REGRESSION:', r.name);
  for (const r of unexpectedPasses) console.error('Superseded test now passes; review the list:', r.name);
  for (const name of missing) console.error('Superseded test not found:', name);
  process.exit(1);
}
console.log(`PASS native 2.5.9 suite: ${results.length - superseded.size} passed, ${superseded.size} superseded by engine 2.5.11/2.6 as expected.`);

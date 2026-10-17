// Runs the native 2.5.9 regression suite against the current engine.
// The 2.5.11 engine deliberately replaces the 2.5.9 rendered-list Watchlist reader
// with validated REST pagination and discards checkpoints without v4 proof.
// The tests for those replaced behaviours must fail; every other test must pass.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const superseded = new Set([
  'List checkpoints persist across engine recreation and expire without becoming snapshots',
  'Rendered list counts unique people across overlapping pages and scrolls the actual dialog',
  'Terminal duplicates and a one-person gap never become fabricated complete lists',
  'The current viewer is added only with an explicit fresh membership proof',
  'Wrong target and wrong direction responses cannot contaminate a rendered list',
  'GraphQL dialog connections need a matching target and list direction',
  'Rendered lists cannot finish at the expected count while the source still has more pages',
  'Rendered lists wait for an outstanding list response even after an apparent terminal page',
  'A nested foreign profile connection cannot supply the watched profile followers',
  'A direct follower connection owned by the watched profile remains valid',
  'Watchlist collection prefers the rendered list and rejects an incomplete native reply',
  'Rendered list completion requires unambiguous pagination evidence from the latest page',
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

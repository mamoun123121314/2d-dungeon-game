/**
 * Run every browser suite in order and report a single verdict.
 *
 *   node tests/run-all.mjs            # everything
 *   node tests/run-all.mjs browser save   # just those
 *
 * Each suite is a separate node process so one crash cannot take down the
 * rest, and so they get a fresh browser (and fresh localStorage) each time.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALL = ['browser', 'save', 'mobile', 'gameplay', 'hero', 'vault', 'audio', 'perf'];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = wanted.length ? wanted : ALL;

const run = (name) => new Promise((resolve) => {
  const file = path.join(HERE, `${name}.mjs`);
  const started = Date.now();
  const child = spawn(process.execPath, [file], { stdio: 'inherit', cwd: path.dirname(HERE) });
  child.on('exit', (code) => resolve({ name, code, ms: Date.now() - started }));
});

const results = [];
for (const name of suites) {
  console.log(`\n${'='.repeat(64)}\n  ${name}\n${'='.repeat(64)}`);
  results.push(await run(name));
}

console.log(`\n${'='.repeat(64)}`);
let bad = 0;
for (const r of results) {
  const status = r.code === 0 ? 'PASS' : 'FAIL';
  if (r.code !== 0) bad++;
  console.log(`  ${status}  ${r.name.padEnd(10)} ${(r.ms / 1000).toFixed(1)}s`);
}
console.log('='.repeat(64));
console.log(bad === 0 ? '\nAll suites passed.' : `\n${bad} suite(s) failed.`);
process.exitCode = bad === 0 ? 0 : 1;

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
  /* Keep a copy of each suite's output. Locally it is only useful when a suite
     fails; in CI it is essential, because a failure there has to be readable
     without downloading the job log — the log lives in blob storage that some
     sandboxes cannot reach. */
  let output = '';
  const child = spawn(process.execPath, [file], { cwd: path.dirname(HERE) });
  child.stdout.on('data', (b) => { output += b; process.stdout.write(b); });
  child.stderr.on('data', (b) => { output += b; process.stderr.write(b); });
  child.on('exit', (code) => resolve({ name, code, ms: Date.now() - started, output }));
});

/* Emit the failing lines as workflow annotations so the reason is visible on
   the run summary page itself. */
const annotate = (r) => {
  if (r.code === 0 || !process.env.GITHUB_ACTIONS) return;
  /* keep the failing lines plus any diagnostic the suite printed */
  const all = r.output.split('\n');
  const failed = all.filter((l) => /FAIL|Error|error:|threw|diag/i.test(l)).slice(0, 6);
  if (!failed.length) {
    /* no marker: keep the tail, which is where a crash usually explains itself */
    failed.push(...all.filter((l) => l.trim()).slice(-4));
  }
  const body = (failed.length ? failed.join(' | ') : 'suite exited ' + r.code)
    .replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=${r.name} suite failed::${body.slice(0, 900)}`);
};

const results = [];
for (const name of suites) {
  console.log(`\n${'='.repeat(64)}\n  ${name}\n${'='.repeat(64)}`);
  const result = await run(name);
  results.push(result);
  annotate(result);
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

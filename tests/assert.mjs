/**
 * Minimal assertion + reporting helpers shared by the test files.
 * Each file prints one line per check so a failing run is readable on its own.
 */
let passed = 0;
let failed = 0;
const failures = [];

export function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    const line = detail === undefined ? name : `${name}  [${typeof detail === 'string' ? detail : JSON.stringify(detail)}]`;
    failures.push(line);
    console.log(`  FAIL ${line}`);
  }
  return !!condition;
}

export function equal(name, actual, expected) {
  return check(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

export function between(name, value, lo, hi) {
  const ok = typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
  return check(name, ok, `got ${value}, expected ${lo}..${hi}`);
}

export function section(title) {
  console.log(`\n${title}`);
}

export function summary(label) {
  const total = passed + failed;
  console.log(`\n${label}: ${passed}/${total} passed`);
  if (failed) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  return failed === 0;
}

export function counts() {
  return { passed, failed, failures };
}

export function exitCode() {
  return failed === 0 ? 0 : 1;
}

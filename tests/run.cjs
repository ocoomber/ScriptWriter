// Run the Electron regression suite one process at a time. Keep render-icon.cjs
// out: it is a manual asset generator, not a test.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tests = [
  'electron-smoke.cjs',
  'writing-flow.cjs',
  'frictionless-writing.cjs',
  'user-reported-writing.cjs',
  'edge-flows.cjs',
  'library-integrity.cjs',
  'security-sanitization.cjs',
  'spell-language.cjs',
  'review-regressions.cjs',
  'pagination.cjs',
  'persistence.cjs',
];

for (const test of tests) {
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Could not start ${test}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.signal) console.error(`${test} terminated by ${result.signal}`);
    else console.error(`${test} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nPASS: ${tests.length} ScriptWriter regression tests`);

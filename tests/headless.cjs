// These checks do not launch Electron or touch the personal library.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const name of ['fountain-import.cjs', 'library-menu.cjs', 'import-titles.cjs', 'header-zoom-geometry.cjs', 'headless-pagination.cjs']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS: all headless checks');

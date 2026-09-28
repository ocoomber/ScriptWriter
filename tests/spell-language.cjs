// Exercise the real spellcheck language bridge with an isolated library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `spell-language-${Date.now()}`);
const libraryPath = path.join(output, 'library');
const env = { ...process.env, SCRIPTWRITER_LIBRARY: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
let app;

async function launch() {
  app = await playwright._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.neo && typeof window.neo.spellSettings === 'function', null, { timeout: 15000 });
  return page;
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let page = await launch();
  const initial = await page.evaluate(() => window.neo.spellSettings());
  assert.equal(initial.language, 'en-GB', 'new libraries default to English (UK)');
  assert.deepEqual(initial.languages, [
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'en-US', label: 'English (US)' }
  ]);

  const switched = await page.evaluate(() => window.neo.setSpellLanguage('en-US'));
  assert.deepEqual(switched, { ok: true, language: 'en-US' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(libraryPath, 'library.json'), 'utf8')).spellLanguage, 'en-US');
  await app.close(); app = null;

  page = await launch();
  assert.equal((await page.evaluate(() => window.neo.spellSettings())).language, 'en-US', 'chosen language survives restart');
  console.log('PASS: UK default and persistent US spellcheck selection');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

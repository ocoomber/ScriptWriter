// A damaged library must remain recoverable, and recovery journals must not
// bloat the daily screenplay archive.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const playwright = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `library-integrity-${Date.now()}`);
const libraryPath = path.join(output, 'library');
const libraryFile = path.join(libraryPath, 'library.json');
const env = { ...process.env, SCRIPTWRITER_LIBRARY: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
let app;

async function launch() {
  app = await playwright._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.neo && typeof library !== 'undefined' && !!library, null, { timeout: 15000 });
  return page;
}

(async () => {
  fs.mkdirSync(libraryPath, { recursive: true });
  const damaged = '{ "shelves": [';
  fs.writeFileSync(libraryFile, damaged, 'utf8');
  const page = await launch();

  const restored = JSON.parse(fs.readFileSync(libraryFile, 'utf8'));
  assert.ok(Array.isArray(restored.shelves), 'the replacement library is usable');
  const backups = fs.readdirSync(libraryPath).filter(name => /^library\.json\.corrupt-/.test(name));
  assert.equal(backups.length, 1, 'the damaged library is preserved once');
  assert.equal(fs.readFileSync(path.join(libraryPath, backups[0]), 'utf8'), damaged, 'the preserved file retains its original bytes');

  const book = await page.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Archive fixture', author: 'Tester' });
    meta.chapterOrder = ['scene-archive'];
    await window.neo.writeChapter(meta.id, 'scene-archive', '<p data-element="action" data-id="archive-a">The archive is clean.</p>');
    await window.neo.writeBookMeta(meta.id, meta);
    await window.neo.writeJSON(meta.id, 'recovery', { book: meta, chapters: {}, darlings: [], stickies: [], outline: [] });
    return meta.id;
  });
  await page.waitForTimeout(5500);
  const archiveNames = await page.evaluate(id => window.neo.listBackups(id), book);
  assert.ok(archiveNames.length, 'the fixture receives a daily archive');
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(libraryPath, book, 'Backups', archiveNames[0])));
  assert.equal(zip.file('recovery.json'), null, 'recovery journals are excluded from screenplay ZIPs');
  assert.ok(zip.file('chapters/scene-archive.html'), 'the screenplay chapter remains in the archive');

  console.log('PASS: corrupt library is preserved and recovery journals stay out of ZIP backups');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

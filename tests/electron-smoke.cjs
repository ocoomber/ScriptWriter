// Exercise the real Electron window and disk bridge with an isolated library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `smoke-${Date.now()}`);
const libraryPath = path.join(output, 'library');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];

async function launch() {
  app = await playwright._electron.launch({
    executablePath: process.env.SCRIPTWRITER_EXECUTABLE || require('electron'),
    args: process.env.SCRIPTWRITER_EXECUTABLE ? [] : [root], cwd: root, env, timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => !!window.neo && typeof library !== 'undefined' && !!library);
  await page.waitForTimeout(300);
  return page;
}

(async () => {
  let page = await launch();
  assert.equal(await page.title(), 'ScriptWriter');
  assert.equal(await page.locator('#firstrun').isVisible(), false, 'No setup wizard');
  assert.equal(path.resolve(await page.evaluate(() => window.neo.libraryPath())), libraryPath);
  await page.screenshot({ path: path.join(output, 'library.png') });
  console.log('PASS: isolated desktop startup, no wizard');

  // Exercise persistence independently of the editor before the typing rehearsal.
  const saved = await page.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Round trip', author: 'Test Writer' });
    meta.chapterOrder = ['scene-roundtrip'];
    const html = '<p data-element="heading" data-id="heading-1">INT. SCHOOL HALL - NIGHT</p><p data-element="action" data-id="action-1">A door opens.</p>';
    await window.neo.writeChapter(meta.id, meta.chapterOrder[0], html);
    await window.neo.writeBookMeta(meta.id, meta);
    library.shelves[0].bookIds.push(meta.id);
    await window.neo.writeLibrary(library);
    return { id: meta.id, html, read: await window.neo.readChapter(meta.id, meta.chapterOrder[0]) };
  });
  assert.equal(saved.read, saved.html);
  assert.equal(fs.readFileSync(path.join(libraryPath, saved.id, 'chapters/scene-roundtrip.html'), 'utf8'), saved.html);
  console.log('PASS: semantic HTML round trip through real IPC/files');
  await app.close(); app = null;
  page = await launch();
  assert.equal(await page.evaluate(id => window.neo.readChapter(id, 'scene-roundtrip'), saved.id), saved.html);
  await page.evaluate(id => openBook(id), saved.id);
  await page.waitForSelector('#editor-view:not([hidden])');
  const beforeZoom = await page.locator('#chapters').evaluate(node => node.getBoundingClientRect().width);
  await page.locator('#zoom-in').click();
  const afterZoom = await page.locator('#chapters').evaluate(node => node.getBoundingClientRect().width);
  assert(afterZoom > beforeZoom * 1.05, 'Zoom control scales screenplay pages');
  await page.screenshot({ path: path.join(output, 'editor.png') });
  assert.deepEqual(errors, [], 'Renderer must have no uncaught errors');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, output, libraryPath, errors }, null, 2));
  console.log('PASS: close/reopen and editor render');
  console.log(`Artifacts: ${output}`);
})().catch(async error => {
  console.error(error);
  if (app) {
    try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }); } catch {}
  }
  fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${errors.join('\n')}`);
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

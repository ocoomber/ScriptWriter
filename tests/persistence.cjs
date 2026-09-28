// Verify per-screenplay ZIP recovery and acknowledged-save durability in Electron.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const playwright = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `persistence-${Date.now()}`);
const libraryPath = path.join(output, 'library');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
let app = null;

async function launch() {
  app = await playwright._electron.launch({
    executablePath: require('electron'), args: [root], cwd: root, env, timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.neo && typeof library !== 'undefined' && !!library);
  return page;
}

async function stopCleanly() {
  if (!app) return;
  const closing = app;
  app = null;
  await closing.close();
}

async function stopAbruptly() {
  if (!app) return;
  const closing = app;
  app = null;
  const child = closing.process();
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    assert.equal(result.status, 0, `taskkill failed: ${result.stderr && result.stderr.toString()}`);
  } else {
    child.kill('SIGKILL');
  }
  await new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.once('error', reject);
    setTimeout(() => reject(new Error('Electron process did not exit after forced termination')), 10000).unref();
  });
}

(async () => {
  const page = await launch();
  const initial = await page.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Backup Round Trip', author: 'Persistence Test' });
    meta.chapterOrder = ['scene-backup'];
    const html = '<p data-element="heading" data-id="scene-h">INT. ARCHIVE ROOM - NIGHT</p><p data-element="action" data-id="scene-a">A light flickers.</p>';
    await window.neo.writeChapter(meta.id, 'scene-backup', html);
    await window.neo.writeBookMeta(meta.id, meta);
    library.shelves[0].bookIds.push(meta.id);
    await window.neo.writeLibrary(library);
    return { id: meta.id, html };
  });
  assert.equal(fs.readFileSync(path.join(libraryPath, initial.id, 'chapters', 'scene-backup.html'), 'utf8'), initial.html);
  await stopCleanly();

  // A clean close must synchronously leave today's changed screenplay backup.
  const pageAfterClose = await launch();
  const backupNames = await pageAfterClose.evaluate((id) => window.neo.listBackups(id), initial.id);
  assert.ok(backupNames.length >= 1, 'close should create a daily ZIP backup');
  assert.match(backupNames[0], /^scriptwriter-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const recovered = await pageAfterClose.evaluate(async ({ id, archiveName }) => {
    const meta = await window.neo.restoreBackup(id, archiveName);
    return { meta, html: await window.neo.readChapter(meta.id, 'scene-backup') };
  }, { id: initial.id, archiveName: backupNames[0] });
  assert.notEqual(recovered.meta.id, initial.id, 'restore must create a separate screenplay folder');
  assert.match(recovered.meta.title, /\(Recovered Copy\)$/);
  assert.equal(recovered.html, initial.html, 'restored screenplay HTML must match archived content');
  assert.equal(fs.readFileSync(path.join(libraryPath, initial.id, 'chapters', 'scene-backup.html'), 'utf8'), initial.html,
    'restore must leave the original screenplay untouched');
  console.log('PASS: daily ZIP restores to a separate screenplay with matching HTML');

  const recovery = await pageAfterClose.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Journal Recovery', author: 'Persistence Test' });
    meta.chapterOrder = ['scene-journal'];
    const savedHtml = '<p data-element="action" data-id="journal-a">Saved before the last edit.</p>';
    const draftHtml = '<p data-element="action" data-id="journal-a">The newer journal keeps this final line.</p>';
    await window.neo.writeChapter(meta.id, 'scene-journal', savedHtml);
    await window.neo.writeBookMeta(meta.id, meta);
    const draft = {
      revision: 'revision-recovery-test', updated: new Date().toISOString(),
      book: structuredClone(meta), chapters: { 'scene-journal': draftHtml },
      darlings: [], stickies: [], outline: [],
    };
    await window.neo.writeJSON(meta.id, 'recovery', draft);
    const offer = await window.neo.inspectRecovery(meta.id);
    const copy = await window.neo.recoverCopy(meta.id);
    return {
      originalId: meta.id, savedHtml, draftHtml, offer, copy,
      originalHtml: await window.neo.readChapter(meta.id, 'scene-journal'),
      recoveredHtml: await window.neo.readChapter(copy.id, 'scene-journal'),
    };
  });
  assert.ok(recovery.offer, 'newer journal should present a recovery offer');
  assert.notEqual(recovery.copy.id, recovery.originalId, 'journal recovery must create a separate screenplay');
  assert.match(recovery.copy.title, /\(Recovered Copy\)$/);
  assert.equal(recovery.originalHtml, recovery.savedHtml, 'recovery must preserve the canonical screenplay');
  assert.equal(recovery.recoveredHtml, recovery.draftHtml, 'recovery copy must contain the newer journal HTML');
  console.log('PASS: newer recovery journal is offered and copied separately with latest HTML');

  // An acknowledged atomic save must remain readable even when Electron is killed
  // without its normal shutdown/backup path.
  const crashCase = await pageAfterClose.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Abrupt Close', author: 'Persistence Test' });
    meta.chapterOrder = ['scene-crash'];
    const html = '<p data-element="heading" data-id="crash-h">EXT. RIVER BANK - DAWN</p><p data-element="action" data-id="crash-a">The sun rises.</p>';
    await window.neo.writeChapter(meta.id, 'scene-crash', html);
    await window.neo.writeBookMeta(meta.id, meta);
    return { id: meta.id, html, read: await window.neo.readChapter(meta.id, 'scene-crash') };
  });
  assert.equal(crashCase.read, crashCase.html, 'save IPC acknowledgment follows durable HTML write');
  await stopAbruptly();

  const reopened = await launch();
  const afterCrash = await reopened.evaluate(({ id }) => window.neo.readChapter(id, 'scene-crash'), crashCase);
  assert.equal(afterCrash, crashCase.html, 'acknowledged screenplay content must survive abrupt process termination');
  await stopCleanly();
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, output, libraryPath }, null, 2));
  console.log('PASS: acknowledged HTML save survives abrupt Electron termination and restart');
  console.log(`Artifacts: ${output}`);
})().catch(async (error) => {
  console.error(error);
  if (app) {
    try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }); } catch {}
    try { await stopAbruptly(); } catch {}
  }
  fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n`);
  process.exitCode = 1;
});

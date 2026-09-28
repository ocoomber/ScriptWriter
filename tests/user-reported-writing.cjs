// Regressions for the reported writing and screenplay management failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `user-reported-writing-${Date.now()}`);
const libraryPath = path.join(output, 'library');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const press = key => page.keyboard.press(key);
const type = text => page.keyboard.type(text);

(async () => {
  app = await pw._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForFunction(() => !!window.neo && typeof openBook === 'function');
  const revealControls = async () => page.mouse.move(500, (await page.evaluate(() => innerHeight)) - 2);

  const book = await page.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Regression Script', author: 'Anonymous' });
    meta.chapterOrder = ['scene-one'];
    await window.neo.writeBookMeta(meta.id, meta);
    await window.neo.writeChapter(meta.id, 'scene-one', [
      '<p data-element="scene-heading" data-id="heading">INT. ROOM - DAY</p>',
      '<p data-element="action" data-id="action-one">Gillian waits by the door.</p>',
      '<p data-element="character" data-id="cue-one">GILLIAN</p>',
      '<p data-element="dialogue" data-id="dialogue-one">I am here.</p>',
      '<p data-element="action" data-id="direction-one">She checks the clock.</p>',
      '<p data-element="action" data-id="empty-before-cue"><br></p>',
      '<p data-element="character" data-id="cue-two">GILLIAN</p>',
      '<p data-element="dialogue" data-id="dialogue-two">Still here.</p>'
    ].join(''));
    library.shelves[0].bookIds.push(meta.id);
    await window.neo.writeLibrary(library);
    await openBook(meta.id);
    return { id: meta.id };
  });

  assert.equal(await page.locator('#title-page').isVisible(), false,
    'Title page should not appear in the default writing view');

  // Backspace at the beginning of a cue removes an intervening empty block,
  // while preserving the cue and its speaker identity.
  await page.locator('.chapter-body [data-id="cue-two"]').evaluate(element => {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    element.closest('.chapter-body').focus();
  });
  await press('Backspace');
  assert.equal(await page.locator('.chapter-body [data-id="empty-before-cue"]').count(), 0,
    'Backspace should remove the empty paragraph before a cue');
  assert.equal(await page.locator('.chapter-body [data-id="cue-two"]').innerText(), 'GILLIAN',
    'Backspace should not merge a cue into its preceding action');

  // Re-select an existing name by typing its first letter. Enter accepts the
  // existing GILLIAN choice instead of creating a new one-letter character.
  await page.locator('.chapter-body [data-id="dialogue-two"]').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.closest('.chapter-body').focus();
  });
  await press('Shift+Enter');
  await type('She pauses for a moment.');
  await press('Tab');
  await type('G');
  assert.equal(await page.locator('#sp-picker .selected').innerText(), 'GILLIAN',
    'Typing G should highlight the existing GILLIAN character');
  await press('Enter');
  const cues = page.locator('.chapter-body [data-element="character"]');
  assert.equal(await cues.count(), 3, 'Selecting GILLIAN must not create a new character cue');
  assert.equal(await cues.last().innerText(), "GILLIAN (CONT'D)",
    'The same speaker returning after a stage direction should be marked CONT\'D');

  // Title and writer credit edited through Title Page and Paper Size settings
  // must persist on the book record used by later exports.
  const settings = page.evaluate(() => window.openScreenplaySettings());
  await page.locator('.modal-backdrop input').last().fill('Regression Title');
  await page.locator('.modal-backdrop .m-ok').last().click();
  await page.locator('.modal-backdrop input').last().fill('Riley Writer');
  await page.locator('.modal-backdrop .m-ok').last().click();
  await page.locator('.modal-backdrop input').last().fill('');
  await page.locator('.modal-backdrop .m-ok').last().click();
  await page.locator('.modal-backdrop .fr-choice').filter({ hasText: 'A4' }).click();
  await settings;
  await page.waitForFunction(async id => {
    await flushAllSaves();
    return (await window.neo.readBookMeta(id))?.author === 'Riley Writer';
  }, book.id);
  const saved = await page.evaluate(id => window.neo.readBookMeta(id), book.id);
  assert.equal(saved.title, 'Regression Title');
  assert.equal(saved.author, 'Riley Writer', 'Writer credit should not fall back to Anonymous');

  // The Edit panel keeps a selection while it is opened, and offers both
  // deliberate uppercase and sentence-case repair for accidental Caps Lock.
  const selectText = async (selector, start, end) => page.locator(selector).evaluate((element, offsets) => {
    const text = element.firstChild;
    const range = document.createRange();
    range.setStart(text, offsets[0]); range.setEnd(text, offsets[1]);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.closest('.chapter-body').focus();
  }, [start, end]);
  const firstAction = page.locator('.chapter-body [data-id="action-one"]');
  const actionText = await firstAction.innerText();
  await selectText('.chapter-body [data-id="action-one"]', 0, actionText.length);
  await revealControls(); await page.locator('#edit-toggle').click();
  await page.locator('#edit-uppercase').click();
  assert.equal(await firstAction.innerText(), actionText.toUpperCase(), 'Uppercase applies to selected script text');
  await selectText('.chapter-body [data-id="action-one"]', 0, actionText.length);
  await revealControls(); await page.locator('#edit-toggle').click();
  await revealControls(); await page.locator('#edit-toggle').click();
  await page.locator('#edit-normalize-case').click();
  assert.equal(await firstAction.innerText(), actionText, 'Sentence case repairs accidental all-caps text');

  // Spelling language is an app preference exposed in Edit and persisted by
  // the same UI control a writer uses.
  await page.locator('#edit-spell-locale').selectOption('en-US');
  await page.waitForFunction(async () => (await window.neo.spellSettings()).language === 'en-US');
  await page.locator('#edit-spell-locale').selectOption('en-GB');
  await page.waitForFunction(async () => (await window.neo.spellSettings()).language === 'en-GB');

  // Character maintenance renames every cue and moves deleted cues plus
  // dialogue to the recoverable Darlings collection.
  await page.locator('#edit-character-select').selectOption({ label: 'GILLIAN' });
  await page.locator('#edit-character-name').fill('GILLIAN JONES');
  await page.locator('#edit-character-rename').click();
  await page.getByRole('button', { name: 'Rename everywhere' }).click();
  assert.equal(await page.locator('.chapter-body [data-element="character"]').count(), 3);
  assert.equal(await page.locator('.chapter-body [data-element="character"]').filter({ hasText: 'GILLIAN JONES' }).count(), 3,
    'Rename should update all of that character\'s cues');
  await page.locator('#edit-character-delete').click();
  await page.getByRole('button', { name: 'Move to Darlings and delete' }).click();
  assert.equal(await page.locator('.chapter-body [data-element="character"]').count(), 0,
    'Deleting a character should remove their cues from the script');
  const savedDarlings = await page.evaluate(id => window.neo.readJSON(id, 'darlings', []), book.id);
  assert.equal(savedDarlings.length, 3, 'Each deleted cue and its dialogue should be retained as a Darling');

  await page.locator('#edit-find-replace').click();
  assert.equal(await page.locator('#edit-panel').isVisible(), false);
  assert.equal(await page.locator('#searchbar').isVisible(), true, 'Find and replace opens the search bar');

  console.log('PASS: writing flow, title metadata, Edit case tools, character rename/delete, spelling locale and find/replace');
  console.log(`Artifacts: ${output}`);
})().catch(async error => {
  console.error(error);
  if (page) {
    try { await page.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }); } catch {}
    try { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); } catch {}
  }
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

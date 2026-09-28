const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `frictionless-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: path.join(output, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const press = key => page.keyboard.press(key);
const type = text => page.keyboard.type(text);

(async () => {
  app = await pw._electron.launch({ executablePath: process.env.SCRIPTWRITER_EXECUTABLE || require('electron'), args: process.env.SCRIPTWRITER_EXECUTABLE ? [] : [root], cwd: root, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.new-book');

  await page.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Frictionless Writing', author: 'Tester' });
    meta.chapterOrder = ['scene-one'];
    await window.neo.writeBookMeta(meta.id, meta);
    await window.neo.writeChapter(meta.id, 'scene-one', '<p data-element="scene-heading" data-id="heading-one">INT. ROOM - DAY</p><p data-element="action" data-id="action-one"><br></p>');
    library.shelves[0].bookIds.push(meta.id);
    await window.neo.writeLibrary(library);
    await openBook(meta.id);
  });

  const action = page.locator('.chapter-body [data-id="action-one"]');
  await action.evaluate(element => {
    element.closest('.chapter-body').focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  await type('the door opens. another door opens');
  assert.equal(await action.innerText(), 'The door opens. Another door opens', 'Sentence starts should capitalize as the writer types');

  await press('Tab');
  assert.equal(await action.innerText(), 'The door opens. Another door opens.', 'Tab should finish an unpunctuated line before opening a character cue');
  await page.waitForSelector('#sp-picker:not([hidden])');
  const picker = page.locator('#sp-picker');
  await type('Phone');
  await press('Space');
  assert.equal(await picker.isVisible(), true, 'A space in a new name should stay in the character picker');
  assert.equal(await page.locator('.chapter-body [data-element="character"]').count(), 0, 'Typing a space must not confirm a partial character name');
  await type('Voice');
  assert.match(await picker.locator('.sp-picker-query').innerText(), /Phone Voice/i);

  const pickerPosition = await picker.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.bottom, viewport: innerHeight };
  });
  assert(pickerPosition.top >= 0 && pickerPosition.bottom < pickerPosition.viewport - 30, 'Tab should scroll the character picker fully into view');
  await press('Enter');
  const cue = page.locator('.chapter-body [data-element="character"]').last();
  assert.equal(await cue.innerText(), 'PHONE VOICE', 'Enter should confirm the complete multiword name');
  await page.waitForFunction(() => document.querySelector('.chapter-body [data-element="character"]')?.hasAttribute('data-layout-y'));
  const cuePosition = await cue.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  assert(Math.abs(pickerPosition.left - cuePosition.left) < 24, `Picker should align with the future character cue horizontally (picker ${pickerPosition.left}, cue ${cuePosition.left})`);
  assert(Math.abs(pickerPosition.top - cuePosition.top) < 36, `Picker should open at the future character cue vertically (picker ${pickerPosition.top}, cue ${cuePosition.top})`);
  await type('hello. can you hear me?');
  assert.equal(await page.locator('.chapter-body [data-element="dialogue"]').last().innerText(), 'Hello. Can you hear me?', 'Dialogue sentences should capitalize as typed');
  await type(" i know phone voice is here. i think i'm ready.");
  assert.equal(await page.locator('.chapter-body [data-element="dialogue"]').last().innerText(),
    "Hello. Can you hear me? I know PHONE VOICE is here. I think I'm ready.",
    'Standalone I and established character names should capitalize while writing dialogue');
  await press('Tab');
  assert.equal(await picker.locator('.selected').innerText(), 'PHONE VOICE', 'Tab should suggest the recent speaker');
  await press('Enter');
  assert.equal(await page.locator('.chapter-body [data-element="character"]').last().innerText(), "PHONE VOICE (CONT'D)",
    'A new cue for the same speaker needs CONT\'D even without an action line');
  await page.evaluate(() => { library.settings = { ...(library.settings || {}), questionMarkAutofill: true }; });
  await type('who left the door open');
  await press('Tab');
  assert.equal(await page.locator('.chapter-body [data-element="dialogue"]').last().innerText(), 'Who left the door open?', 'Question-leading dialogue should receive a question mark when the setting is enabled');
  await press('Escape');
  await page.evaluate(() => { library.settings.questionMarkAutofill = false; });
  await type(' what happened');
  await press('Tab');
  assert.equal(await page.locator('.chapter-body [data-element="dialogue"]').last().innerText(),
    'Who left the door open? What happened.', 'Turning the question-mark setting off should use a full stop');
  await press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: sentence capitalization, multiword character entry, and character picker insertion position');
  console.log(`Artifacts: ${output}`);
  await app.close();
  app = null;
})().catch(async error => {
  console.error(error);
  if (page) {
    try { await page.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }); } catch {}
    fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${errors.join('\n')}`);
  }
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

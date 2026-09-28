const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `writing-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: path.join(output, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
const press = async key => page.keyboard.press(key);
const type = async text => page.keyboard.type(text);
async function caret(selector, offset) {
  const loc = page.locator('.chapter-body '+selector).last();
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((element, offset) => {
    element.closest('[contenteditable]')?.focus();
    const r = document.createRange(); r.selectNodeContents(element);
    if (offset !== undefined && element.firstChild?.nodeType === 3) r.setStart(element.firstChild, offset);
    r.collapse(offset !== undefined);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, offset);
}
(async () => {
  app = await pw._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('.new-book');
  await page.locator('.new-book').first().click();
  await page.waitForSelector('#sp-picker:not([hidden])');
  // New screenplay begins with a real keyboard-driven heading.
  await type('i'); await press('Space');
  await type('School Hall'); await press('Space'); await press('Space');
  await type('n'); await press('Enter');
  assert.equal(await page.locator('[data-element="scene-heading"]').last().innerText(), 'INT. SCHOOL HALL - NIGHT');
  assert.equal(await page.locator('#sp-picker').isVisible(), false);
  await press('Control+z');
  assert.equal(await page.locator('#sp-picker .sp-picker-label').innerText(),'TIME');
  await press('Enter');
  assert.equal(await page.locator('[data-element="scene-heading"]').last().innerText(), 'INT. SCHOOL HALL - NIGHT');
  await type('A door opens.');
  assert.equal(await page.locator('[data-element="action"]').last().innerText(), 'A door opens.');
  await press('Tab'); await type('ALICE'); await press('Enter');
  await press('Control+z');
  assert.equal(await page.locator('#sp-picker .sp-picker-label').innerText(),'CHARACTER');
  await press('Enter');
  assert.equal(await page.locator('[data-element="character"]').last().innerText(), 'ALICE');
  await type('Is anyone here?');
  assert.match(await page.locator('.chapter-body').innerText(), /A door opens\./, 'Tab must preserve existing prose');
  assert.equal(await page.locator('[data-element="character"]').last().innerText(), 'ALICE');
  console.log('PASS: new location with spaces, heading, action and character selection');

  await press('Tab'); await type('BOB'); await press('Enter');
  await type('Just me.');
  await press('Tab');
  assert.equal(await page.locator('#sp-picker .selected').innerText(), 'ALICE', 'Other scene participant should be highlighted');
  await press('Escape');
  assert.match(await page.locator('.chapter-body').innerText(), /Just me\./);
  await press('Shift+Enter'); await type('The light flickers.');
  assert.equal(await page.locator('[data-element="action"]').last().innerText(), 'The light flickers.');
  console.log('PASS: two-speaker ranking, cancel, dialogue to action');

  // Enter must split at the caret, not move the whole paragraph.
  await caret('[data-element="action"]', 4);
  await press('Enter');
  const actionTexts = await page.locator('[data-element="action"]').allTextContents();
  assert(actionTexts.includes('The ') && actionTexts.includes('light flickers.'), JSON.stringify(actionTexts));
  await press('Control+z');
  assert((await page.locator('[data-element="action"]').allTextContents()).includes('The light flickers.'), 'Undo restores split');
  await caret('[data-element="action"]');
  await press('Enter'); await press('Enter'); await press('Enter');
  await page.waitForSelector('#sp-picker:not([hidden])');
  await type('e'); await press('Space'); await type('Street'); await press('Space'); await press('Space'); await press('Enter');
  assert.equal(await page.locator('.chapter-body').count(), 2);
  assert.equal(await page.locator('[data-element="scene-heading"]').last().innerText(), 'EXT. STREET - DAY');
  await type('Rain falls.');
  console.log('PASS: mid-paragraph Enter, undo, new scene');

  await press('Shift+Space'); await type('A taxi stops.');
  assert.equal(await page.locator('.ph-mark').count(),1);
  assert.match(await page.locator('.chapter-body').last().innerText(),/A taxi stops\./);
  const sceneOrder=await page.evaluate(()=>[...book.chapterOrder]);
  await page.mouse.move(500, (await page.evaluate(() => innerHeight)) - 2);
  await page.locator('[data-tab="outline"]').click();
  await page.locator('.sp-outline-add').click();
  await page.locator('.sp-o-heading').fill('INT. CAFE - DAY');
  await page.locator('.sp-o-notes').fill('A cup rattles.');
  assert.deepEqual(await page.evaluate(()=>book.chapterOrder),sceneOrder,'Outline editing must be independent');
  await page.locator('.sp-o-insert').click();
  assert.equal(await page.locator('.chapter-body').count(),3);
  assert.match(await page.locator('.chapter-body').last().innerText(),/A cup rattles\./);
  console.log('PASS: placeholders and independent outline insertion');

  // Move a mixed character/dialogue passage and restore at a new cursor.
  await page.evaluate(()=>{
    const cue=document.querySelector('[data-element="character"]');
    const dialogue=cue.nextElementSibling;
    cue.closest('.chapter-body').focus();
    const r=document.createRange();r.setStartBefore(cue);r.setEndAfter(dialogue);
    const s=getSelection();s.removeAllRanges();s.addRange(r);
  });
  await press('Control+Shift+d');
  await page.waitForFunction(()=>darlings.length===1);
  assert.equal(await page.locator('.chapter-body [data-element="character"]').filter({hasText:'ALICE'}).count(),0);
  await caret('[data-element="action"]');
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await page.mouse.move(viewport.width-3,100);
  await page.locator('#sticky-list').getByRole('button',{name:'Place in script',exact:true}).click();
  await page.locator('.chapter-body').last().locator('[data-element="action"]').first().click();
  await page.waitForFunction(()=>darlings.length===0);
  assert.equal(await page.locator('.chapter-body').last().locator('[data-element="character"]').innerText(),'ALICE');
  assert.match(await page.locator('.chapter-body').last().locator('[data-element="dialogue"]').innerText(),/Is anyone here/);
  console.log('PASS: Darlings preserves mixed element types and inserts at a new cursor');

  // Export through the real Electron PDF path, replacing only the OS save picker.
  await app.evaluate(({dialog},out)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:out});},path.join(output,'sample-a4.pdf'));
  const exportPending=page.evaluate(()=>doExport('pdf'));
  await page.getByRole('button',{name:/Export PDF anyway/}).click();
  await exportPending;
  assert(fs.statSync(path.join(output,'sample-a4.pdf')).size>1000);
  const layout=await page.evaluate(()=>({pages:Number(document.querySelector('#chapters').dataset.pageCount),width:document.querySelector('#chapters').offsetWidth,html:buildHtml()}));
  assert(!layout.html.includes('ph-mark'),'PDF omits placeholder markup');
  fs.writeFileSync(path.join(output,'sample-a4.html'),layout.html);
  fs.writeFileSync(path.join(output,'layout.json'),JSON.stringify(layout,null,2));
  console.log('PASS: real A4 PDF export and unresolved-placeholder review');

  await page.screenshot({ path: path.join(output, 'writing.png'), animations: 'disabled' });
  const state = await page.evaluate(async() => {await flushAllSaves();return { id: book.id, scenes: book.chapterOrder, html: { ...chapterHTML } };});
  await app.close(); app = null;
  for (const id of state.scenes) {
    const html = fs.readFileSync(path.join(env.SCRIPTWRITER_LIBRARY, state.id, 'chapters', `${id}.html`), 'utf8');
    assert.equal(html, state.html[id]);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: close flush preserves all typed scenes');
  console.log(`Artifacts: ${output}`);
})().catch(async error => {
  console.error(error);
  if (page) {
    try { await page.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' });
      fs.writeFileSync(path.join(output, 'state.json'), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, html: document.querySelector('#chapters')?.innerHTML, active: document.activeElement?.outerHTML, errors: [] })), null, 2));
    } catch {}
  }
  fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${errors.join('\n')}`);
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

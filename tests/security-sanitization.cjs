const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `security-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: path.join(output, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;

(async () => {
  app = await pw._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  await page.waitForSelector('.new-book');

  const state = await page.evaluate(async () => {
    const meta = await window.neo.createBook({ title: 'Safe <title>', author: 'Tester' });
    meta.chapterOrder = ['scene-one'];
    await window.neo.writeBookMeta(meta.id, meta);
    await window.neo.writeChapter(meta.id, 'scene-one', [
      '<p class="screenplay-element sp-block evil" data-element="action" data-id="keep-me" onclick="window.__chapterPwned=1">',
      '<b>Safe</b><img src="x" onerror="window.__chapterPwned=2"><svg onload="window.__chapterPwned=3"><circle></circle></svg>',
      '<span class="ph-mark extra" data-sid="sid" onclick="window.__chapterPwned=4">wrong flag</span></p>',
      '<script>window.__chapterPwned=5</script>'
    ].join(''));
    library.shelves[0].bookIds.push(meta.id);
    await window.neo.writeLibrary(library);
    await openBook(meta.id);
    return { html: document.querySelector('.chapter-body').innerHTML, pwned: window.__chapterPwned };
  });
  assert.equal(state.pwned, undefined);
  assert.match(state.html, /data-element="action"/);
  assert.match(state.html, /data-id="keep-me"/);
  assert.match(state.html, /class="screenplay-element sp-block"/);
  assert.match(state.html, /<b>Safe<\/b>/);
  assert.match(state.html, /class="ph-mark" data-sid="sid" contenteditable="false">⚑/);
  const chapterSafety = await page.evaluate(() => [...document.querySelector('.chapter-body').querySelectorAll('*')].map((el) => ({ tag: el.tagName, attrs: [...el.attributes].map((a) => a.name) })));
  assert(!chapterSafety.some((el) => ['IMG', 'SVG', 'SCRIPT'].includes(el.tag) || el.attrs.some((name) => name.startsWith('on'))), JSON.stringify(chapterSafety));

  const paste = await page.evaluate(() => cleanPasteHtml('<p onclick="window.__pastePwned=1"><strong>Bold</strong><iframe src="x"></iframe><span class="ph-mark" data-sid="a" onmouseenter="window.__pastePwned=2">x</span></p>'));
  assert.match(paste, /<b>Bold<\/b>/);
  assert.match(paste, /data-sid="a"/);
  const pasteSafety = await page.evaluate((html) => {
    const holder = document.createElement('div'); holder.innerHTML = html;
    return [...holder.querySelectorAll('*')].map((el) => ({ tag: el.tagName, attrs: [...el.attributes].map((a) => a.name) }));
  }, paste);
  assert(!pasteSafety.some((el) => el.tag === 'IFRAME' || el.attrs.some((name) => name.startsWith('on'))), JSON.stringify(pasteSafety));

  await page.evaluate(() => { askInput('<img src=x onerror="window.__modalPwned=1">', 'a\" autofocus onfocus=\"window.__modalPwned=2'); });
  assert.equal(await page.locator('.modal img').count(), 0);
  assert.equal(await page.locator('.m-title').innerText(), '<img src=x onerror="window.__modalPwned=1">');
  assert.equal(await page.locator('.modal input').getAttribute('placeholder'), 'a" autofocus onfocus="window.__modalPwned=2');
  await page.keyboard.press('Escape');

  await page.evaluate(() => { optionModal('<svg onload="window.__modalPwned=3">', '<b>message</b>', [{ label: '<img src=x>', desc: '<i>description</i>', value: 'ok' }]); });
  assert.equal(await page.locator('.modal svg, .modal img').count(), 0);
  assert.equal(await page.locator('.m-title').innerText(), '<svg onload="window.__modalPwned=3">');
  assert.equal(await page.locator('.m-message').innerText(), '<b>message</b>');
  assert.equal(await page.locator('.fr-choice strong').innerText(), '<img src=x>');
  assert.equal(await page.locator('.fr-choice span').innerText(), '<i>description</i>');
  assert.equal(await page.evaluate(() => window.__modalPwned), undefined);
  await page.keyboard.press('Escape');

  console.log('PASS: library, clipboard, and modal HTML are sanitized');
})().finally(async () => { if (app) await app.close(); });

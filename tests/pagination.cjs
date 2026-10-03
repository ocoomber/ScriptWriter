// Real Electron pagination/export regression. Run with:
//   node tests/pagination.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pw = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `pagination-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: path.join(output, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];

function pdfFacts(file) {
  // PDF structure checks need optional pypdf. Electron export assertions still run without Python.
  const script = [
    'import json, sys',
    'from pypdf import PdfReader',
    'r=PdfReader(sys.argv[1])',
    'print(json.dumps({"pages":len(r.pages),"sizes":[[float(p.mediabox.width),float(p.mediabox.height)] for p in r.pages],"text":"".join((p.extract_text() or "") for p in r.pages)}))'
  ].join(';');
  const candidates = [process.env.PYTHON, 'python', 'py'].filter(Boolean);
  for (const python of candidates) {
    try { return JSON.parse(execFileSync(python, python === 'py' ? ['-3', '-c', script, file] : ['-c', script, file], { encoding: 'utf8' })); } catch { /* try next */ }
  }
  if (!globalThis.pdfInspectionSkipReported) {
    console.warn('SKIP PDF inspection: Python with pypdf was not found. PDF export and editor pagination checks still run. Install with: python -m pip install pypdf');
    globalThis.pdfInspectionSkipReported = true;
  }
  return null;
}

function assertUniformPageSizes(facts, expected, label) {
  for (const [index, size] of facts.sizes.entries()) {
    assert(Math.abs(size[0] - expected[0]) < 4 && Math.abs(size[1] - expected[1]) < 4,
      `${label} page ${index + 1} has unexpected size: ${JSON.stringify(size)}`);
  }
}

async function exportPdf(target) {
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, target);
  const pending = page.evaluate(() => doExport('pdf'));
  const review = page.getByRole('button', { name: /Export PDF anyway/ });
  if (await review.isVisible().catch(() => false)) await review.click();
  await pending;
  assert(fs.statSync(target).size > 1000, 'Electron export produced a nontrivial PDF');
}

(async () => {
  app = await pw._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('.new-book');
  await page.locator('.new-book').first().click();
  await page.waitForSelector('#sp-picker:not([hidden])');

  // Use real chapter persistence but seed a deliberately long fixture without
  // spending minutes sending keystrokes through Playwright.
  await page.evaluate(() => {
    const first = book.chapterOrder[0];
    const line = Array.from({ length: 180 }, (_, i) => `LONG-ACTION-${String(i).padStart(3, '0')} This is a deliberately long action line for page-break validation.`).join('<br>');
    const make = (heading, action) => `<p class="screenplay-element sp-block" data-element="scene-heading">${heading}</p><p class="screenplay-element sp-block" data-element="action">${action}</p>`;
    chapterHTML[first] = make('INT. PAGINATION LAB - DAY', line);
    book.chapterTitles[first] = 'INT. PAGINATION LAB - DAY';
    for (let i = 1; i < 4; i++) {
      const id = createChapterAt(book.chapterOrder.length);
      chapterHTML[id] = make(`EXT. TEST STREET ${i} - NIGHT`, `UNIQUE-SCENE-${i} End-to-end pagination token.`);
      book.chapterTitles[id] = `EXT. TEST STREET ${i} - NIGHT`;
    }
    renderChapters();
    for (const id of book.chapterOrder) { const body = document.querySelector(`.chapter[data-id="${id}"] .chapter-body`); body.innerHTML = chapterHTML[id]; syncChapter(body, id); }
    book.screenplay = { ...(book.screenplay || {}), title: 'Pagination Fixture', writer: 'Test Writer', pageSize: 'A4' };
    return typeof window.paginateScreenplay;
  }).then(kind => assert.equal(kind, 'function', 'pagination engine must be exposed as window.paginateScreenplay'));

  await page.evaluate(() => window.paginateScreenplay());
  const pageInfo = await page.evaluate(() => ({
    pageCount: Number(document.querySelector('#chapters').dataset.pageCount),
    gaps: document.querySelectorAll('.sp-page-gap').length,
    numbers: [...document.querySelectorAll('#chapters > .sp-page-number')].map(n => n.textContent),
    sceneNumbers: [...document.querySelectorAll('.chapter-body > [data-element="scene-heading"]')].map(n => n.dataset.sceneNumber),
    geometry: [...document.querySelectorAll('.chapter-body > [data-element]')].map(p => ({ element: p.dataset.element, y: Number(p.dataset.layoutY), height: p.getBoundingClientRect().height }))
  }));
  fs.writeFileSync(path.join(output, 'pagination.json'), JSON.stringify(pageInfo, null, 2));
  assert(pageInfo.pageCount > 1, 'long action creates multiple visible editor pages');
  assert.equal(pageInfo.numbers.length, pageInfo.pageCount, 'every script page has a visible page number');
  assert.equal(pageInfo.numbers[0], '1.', 'page numbering begins on the first script page');
  assert.deepEqual(pageInfo.sceneNumbers, ['1', '2', '3', '4'], 'scene headings number in script order');
  assert(pageInfo.gaps > 0, 'single long action has rendered page-boundary spacers');
  const screenTokens = await page.locator('#chapters').innerText();
  for (const n of ['000', '090', '179']) assert.match(screenTokens, new RegExp(`LONG-ACTION-${n}`));
  await page.screenshot({ path: path.join(output, 'a4-editor.png'), fullPage: true, animations: 'disabled' });

  const a4 = path.join(output, 'pagination-a4.pdf');
  await exportPdf(a4);
  const a4facts = pdfFacts(a4);
  if (a4facts) {
    assert.equal(a4facts.pages, pageInfo.pageCount + 1, 'A4 PDF has one title page plus exactly the editor manuscript pages');
    assert(a4facts.text.trim(), 'A4 PDF contains manuscript text');
    assertUniformPageSizes(a4facts, [595, 842], 'A4');
    for (const n of ['000', '090', '179']) {
      const hits = (a4facts.text.match(new RegExp(`LONG-ACTION-${n}`, 'g')) || []).length;
      assert.equal(hits, 1, `A4 exports LONG-ACTION-${n} once, without duplicated cross-page text`);
    }
  }

  await page.evaluate(() => { book.screenplay.pageSize = 'letter'; document.body.dataset.pageSize = 'letter'; });
  await page.evaluate(() => window.paginateScreenplay());
  const letterEditorPages = await page.locator('#chapters').getAttribute('data-page-count');
  await page.screenshot({ path: path.join(output, 'letter-editor.png'), fullPage: true, animations: 'disabled' });
  const letter = path.join(output, 'pagination-letter.pdf');
  await exportPdf(letter);
  const letterFacts = pdfFacts(letter);
  if (letterFacts) {
    assert.equal(letterFacts.pages, Number(letterEditorPages) + 1, 'Letter PDF has one title page plus exactly the editor manuscript pages');
    assertUniformPageSizes(letterFacts, [612, 792], 'Letter');
    assert.equal((letterFacts.text.match(/UNIQUE-SCENE-3/g) || []).length, 1, 'Letter retains later-scene token exactly once');
  }
  assert.deepEqual(errors, []);
  console.log(`PASS pagination artifacts: ${output}`);
})().catch(async error => {
  console.error(error);
  if (page) { try { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); } catch {} }
  fs.writeFileSync(path.join(output, 'failure.txt'), error.stack || String(error));
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

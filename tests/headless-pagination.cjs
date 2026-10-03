// Actual layout/export code in headless Chrome. Optional argument is a private
// library book folder; copied data and all PDF output stay in ignored test output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { parseFountain } = require('../fountain-import.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `headless-pagination-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const line = Array.from({ length: 180 }, (_, i) => `LONG-ACTION-${String(i).padStart(3, '0')} This is a deliberately long action line for page-break validation.`).join('<br>');
let meta = { title: 'Pagination Fixture', author: 'Test Writer', screenplay: { pageSize: 'A4' } };
let chapters = [`<p data-element="scene-heading">INT. PAGINATION LAB - DAY</p><p data-element="action">${line}</p>`, '<p data-element="scene-heading">EXT. TEST STREET - NIGHT</p><p data-element="action">UNIQUE-LAST-SCENE End of script.</p>'];
const privateBook = process.argv[2];
if (privateBook) {
  const copy = path.join(output, 'library-copy');
  fs.cpSync(path.resolve(privateBook), copy, { recursive: true });
  meta = JSON.parse(fs.readFileSync(path.join(copy, 'book.json'), 'utf8'));
  chapters = meta.chapterOrder.map(id => fs.readFileSync(path.join(copy, 'chapters', id + '.html'), 'utf8'));
}
const python = process.env.SCRIPTWRITER_PDF_PYTHON || 'python';
function pdfFacts(file) {
  return JSON.parse(execFileSync(python, ['-c', 'import json,sys,pdfplumber; from pypdf import PdfReader; r=PdfReader(sys.argv[1]); d=pdfplumber.open(sys.argv[1]); print(json.dumps({"pages":len(r.pages),"sizes":[[float(p.mediabox.width),float(p.mediabox.height)] for p in r.pages],"texts":[" ".join(w["text"] for w in p.extract_words() if w["x0"]>=107.9 and w["x0"]<p.width-72-.1 and w["top"]>=60 and w["bottom"]<=p.height-24) for p in d.pages]}))', file], { encoding: 'utf8' }));
}
const words = text => (text.match(/[\p{L}\p{N}]+/gu) || []).map(word => word.toLowerCase());
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SCRIPTWRITER_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<body class="screenplay-mode"><div id="editor-view"><div id="paper"><div id="chapters">${chapters.map(html => `<div class="chapter"><div class="chapter-body">${html}</div></div>`).join('')}</div></div></div></body>`);
    await page.addStyleTag({ path: path.join(root, 'styles.css') });
    await page.addStyleTag({ path: path.join(root, 'screenplay.css') });
    await page.evaluate(value => { window.book = value; window.library = { pageZoom: 1 }; window.$ = selector => document.querySelector(selector); window.captureBody = () => {}; }, meta);
    await page.addScriptTag({ path: path.join(root, 'screenplay-layout.js') });
    const original = await page.locator('.chapter-body > [data-element]').evaluateAll(items => items.map(item => ({ type: item.dataset.element, text: item.innerText })));
    // Force Fountain element types so uppercase action and mixed-case cues are
    // unambiguous. Compare all words after parsing, not merely scene counts.
    const prefixes = { 'scene-heading': '.', action: '!', character: '@', transition: '>' };
    const fountain = `Title: ${meta.title}\n\n` + original.map((item, index) => {
      const gap = ['dialogue', 'parenthetical'].includes(item.type) && ['character', 'parenthetical', 'dialogue'].includes(original[index - 1]?.type) ? '\n' : '\n\n';
      return gap + (prefixes[item.type] || '') + item.text;
    }).join('');
    const imported = parseFountain(fountain, meta.title);
    assert.equal(imported.chapters.filter(scene => scene.some(item => item.type === 'scene-heading')).length, original.filter(item => item.type === 'scene-heading').length, 'Fountain import retains every scene');
    assert(JSON.stringify(words(imported.chapters.flat().map(item => item.text).join(' '))) === JSON.stringify(words(original.map(item => item.text).join(' '))), 'Fountain import retains every screenplay word in order');
    fs.writeFileSync(path.join(output, 'roundtrip.fountain'), fountain);
    for (const size of ['A4', 'letter']) {
      await page.evaluate(size => { book.screenplay = { ...(book.screenplay || {}), pageSize: size }; document.body.dataset.pageSize = size.toLowerCase(); window.paginateScreenplay(); }, size);
      const count = Number(await page.locator('#chapters').getAttribute('data-page-count'));
      assert(count > 1, 'fixture must exercise multiple pages');
      assert.equal(await page.locator('#chapters > .sp-page-number').count(), count);
      const html = await page.evaluate(() => window.screenplayPrintHtml());
      const print = await browser.newPage();
      await print.setContent(html);
      const file = path.join(output, `${size.toLowerCase()}.pdf`);
      await print.pdf({ path: file, preferCSSPageSize: true, printBackground: false, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
      const facts = pdfFacts(file);
      assert.equal(facts.pages, count + 1, 'PDF has exactly the editor pages plus the title page');
      const dimensions = size === 'A4' ? [595.28, 841.89] : [612, 792];
      assert(facts.sizes.every(value => value.every((dimension, i) => Math.abs(dimension - dimensions[i]) < 1)), 'every PDF page has the chosen dimensions');
      // Extract the manuscript rectangle, excluding margin scene/page numbers.
      const pdfText = facts.texts.slice(1).join(' ');
      const expected = words(original.map(item => item.text).join(' '));
      fs.writeFileSync(path.join(output, `${size.toLowerCase()}-text-check.json`), JSON.stringify({ expected, actual: words(pdfText) }));
      assert(JSON.stringify(words(pdfText)) === JSON.stringify(expected), 'PDF retains every manuscript word exactly once and in order');
      if (!privateBook) for (const token of ['000', '090', '179']) assert.equal((pdfText.match(new RegExp('LONG-ACTION-' + token, 'g')) || []).length, 1);
      await print.close();
      console.log(`PASS: ${size}, ${count} script pages plus title; full text, page size, numbering, and Fountain round trip`);
    }
    assert.equal(errors.length, 0, 'layout produces no browser errors');
    console.log(`Artifacts: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

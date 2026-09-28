// Focused regression coverage for review fixes that do not originate from a
// browser input event. Run with: node tests/review-regressions.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', `review-regressions-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, SCRIPTWRITER_LIBRARY: path.join(output, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;

(async () => {
  app = await pw._electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForSelector('.new-book');
  await page.locator('.new-book').first().click();
  await page.waitForSelector('#sp-picker:not([hidden])');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#editor-view').isVisible(), true, 'Escape keeps the current screenplay open');

  const pages = await page.evaluate(() => {
    const id = book.chapterOrder[0];
    const body = document.querySelector('.chapter-body');
    body.innerHTML = '<p data-element="action">ORIGINAL TEXT</p>';
    syncChapter(body, id);
    window.paginateScreenplay();
    document.querySelector('#search-input').value = 'ORIGINAL';
    document.querySelector('#replace-input').value = Array.from({ length: 150 }, () => 'replacement').join(' ');
    let layouts = 0;
    const actual = window.scheduleScreenplayLayout;
    window.scheduleScreenplayLayout = () => { layouts++; actual(); };
    runSearch();
    replaceCurrent();
    return layouts;
  });
  assert(pages > 0, 'replace schedules screenplay repagination');

  const theme = await page.evaluate(() => {
    library.pageTheme = 'night';
    applyFonts();
    const night = getComputedStyle(document.querySelector('#chapters')).backgroundImage;
    library.pageTheme = 'paper';
    applyFonts();
    const paper = getComputedStyle(document.querySelector('#chapters')).backgroundImage;
    return { night, paper };
  });
  assert.notEqual(theme.night, theme.paper, 'Paper and Night visibly change the screenplay page');
  console.log('PASS: Escape, replace reflow, and Paper/Night screenplay page theme');
})().catch(async error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });

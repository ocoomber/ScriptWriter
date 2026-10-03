// Checks real CSS geometry in headless Chrome without launching Electron.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.setContent(`<body class="screenplay-mode" data-page-size="a4">
      <div id="dragstrip"></div>
      <div id="editor-view">
        <nav id="nav-pane" class="open"><div id="nav-head"><span id="nav-label">Scenes</span><button id="nav-close">×</button></div></nav>
        <aside id="side-pane" class="open"><div id="side-head"><span>Darlings</span><button id="side-close">×</button></div></aside>
        <div id="paper-scroll"><div id="paper"><div id="chapters" class="sp-paginated"
          style="width:794px;--sp-page-height:1123px;--sp-stride:1151px;height:1123px">
          <div class="chapter sheet screenplay-page"><div class="chapter-body">
            <p class="screenplay-element" data-element="action"
              style="position:absolute;left:144px;top:96px;width:554px;margin:0;padding:0;font:12pt/16px 'Courier New';white-space:pre-wrap">A line of screenplay action that is long enough to wrap on the page at the same words for both zoom levels.</p>
          </div></div></div></div></div>
        <header id="topbar">ScriptWriter</header>
      </div>`);
    await page.addStyleTag({ path: path.join(__dirname, '..', 'styles.css') });
    await page.addStyleTag({ path: path.join(__dirname, '..', 'screenplay.css') });
    await page.addStyleTag({ content: '#topbar { transition: none !important; }' });
    const measure = async zoom => page.evaluate(value => {
      document.documentElement.style.setProperty('--page-zoom', value);
      const paper = document.querySelector('#chapters');
      const text = document.querySelector('[data-element="action"]');
      return {
        pageWidth: paper.getBoundingClientRect().width,
        scrollWidth: document.querySelector('#paper-scroll').getBoundingClientRect().width,
        textWidth: text.getBoundingClientRect().width,
        textHeight: text.getBoundingClientRect().height,
        textLayoutHeight: text.offsetHeight,
        headerBottom: document.querySelector('#topbar').getBoundingClientRect().bottom
      };
    }, zoom);
    const normal = await measure(1);
    const enlarged = await measure(1.5);
    assert(normal.headerBottom <= 0, 'hidden header leaves no strip over the page');
    assert(Math.abs(enlarged.pageWidth / normal.pageWidth - 1.5) < 0.01, 'whole page scales with zoom');
    assert(Math.abs(enlarged.textWidth / normal.textWidth - 1.5) < 0.01, 'text position and width scale with page');
    assert(Math.abs(enlarged.textHeight / normal.textHeight - 1.5) < 0.01, 'text height scales with page');
    assert.equal(enlarged.textLayoutHeight, normal.textLayoutHeight, 'line wrapping stays unchanged');
    assert(enlarged.scrollWidth > normal.scrollWidth, 'scroll area follows enlarged page');
    await page.locator('#editor-view').evaluate(element => element.classList.add('controls-visible'));
    const shown = await page.locator('#topbar').boundingBox();
    assert.equal(shown.y, 0, 'visible header covers the gap above its controls');
    for (const id of ['nav-close', 'side-close']) {
      const target = await page.locator(`#${id}`).evaluate(button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit?.id;
      });
      assert.equal(target, id, `${id} stays clickable while the header is visible`);
    }
    await page.setContent('<body class="screenplay-mode"><div id="bookshelf-view"><div class="shelf-books"><div class="book">A screenplay</div><button class="new-book">New screenplay</button><button class="import-book">Import screenplay</button></div></div></body>');
    await page.addStyleTag({ path: path.join(__dirname, '..', 'styles.css') });
    await page.addStyleTag({ path: path.join(__dirname, '..', 'screenplay.css') });
    for (const width of [1500, 700]) {
      await page.setViewportSize({ width, height: 900 });
      const cards = await page.locator('.shelf-books > *').evaluateAll(items => items.map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })));
      assert(cards.every(card => card.height === 112), 'all library cards have equal height');
      assert(cards.every(card => Math.abs(card.width - cards[0].width) < 1), 'all library cards fill their grid column');
    }
    console.log('PASS: header cover, panel close buttons, page zoom, and equal library card dimensions');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

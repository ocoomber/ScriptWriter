const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function reserveImportedTitle(');
const end = source.indexOf('\nasync function importBooks(', start);
let context;
const writes = [], shelf = { name: 'Tests', bookIds: ['one', 'two', 'three'] };
context = vm.createContext({
  library: { shelves: [shelf] },
  shelvesFor: () => [shelf], currentAuthor: () => ({ id: 'a1' }), displayAuthor: () => 'Test',
  countWords: text => text.trim().split(/\s+/).filter(Boolean).length,
  escHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  $: () => ({ hidden: true }), toast: () => {}, renderShelves: () => {},
  window: { neo: {
    readBookMeta: async id => ({ title: id === 'one' ? 'The Helper' : id === 'two' ? 'THE HELPER' : 'The Helper (2)' }),
    createBook: async options => ({ id: 'import-' + writes.length, chapterOrder: [], ...options }),
    writeChapter: async () => {}, writeBookMeta: async (id, meta) => writes.push(meta), writeLibrary: async () => {}
  } }
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  context.results = [
    { name: 'first.fountain', screenplay: { title: ' THE  HELPER ', chapters: [[{ type: 'action', text: 'First copy.' }]] } },
    { name: 'second.fountain', screenplay: { title: 'The Helper', chapters: [[{ type: 'action', text: 'Second copy.' }]] } },
    { name: 'third.txt', title: 'the helper', chapters: [[{ text: 'Third copy.' }]] },
    { name: 'bad.fountain', error: 'invalid input' }
  ];
  await vm.runInContext('addImportedBooks(results, library.shelves[0])', context);
  assert.deepEqual(writes.map(meta => meta.title), ['THE  HELPER (3)', 'The Helper (4)', 'the helper (5)']);
  assert.equal(shelf.bookIds.length, 6);
  assert.equal(writes[0].screenplay.title, writes[0].title);
  const titles = new Set();
  context.titles = titles;
  assert.equal(vm.runInContext("reserveImportedTitle('   ', titles)", context), 'Untitled');
  assert.equal(vm.runInContext("reserveImportedTitle('UNTITLED', titles)", context), 'UNTITLED (2)');
  console.log('PASS: case-insensitive import titles, existing suffixes, batch duplicates, and blank titles');
})().catch(error => { console.error(error); process.exitCode = 1; });

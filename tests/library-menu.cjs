// Exercise the actual library handlers without launching Electron or deleting files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'screenplay.js'), 'utf8');
const start = source.indexOf('  bookTile=function(meta){');
const end = source.indexOf('  trackDailyWords=', start);
assert(start >= 0 && end > start, 'Library tile implementation exists');
function fixture(choice, deleteResult = true) {
  const calls = { open: [], deleted: [], writes: 0, renders: 0, errors: [], options: [] };
  const library = { shelves: [{ bookIds: ['test', 'other'] }, { bookIds: ['test'] }] };
  const context = {
    el: (tag, text) => ({ tag, text, children: [], attrs: {}, dataset: {},
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attrs[name] = value; } }),
    optionModal: async (_title, _message, options) => { calls.options = options; return choice; },
    askInput: async () => 'Renamed screenplay',
    openBook: id => calls.open.push(id), library,
    renderShelves: async () => { calls.renders++; },
    toast: message => calls.errors.push(message),
    window: { neo: {
      deleteBook: async (...args) => {
        calls.deleted.push(args);
        if (deleteResult instanceof Error) throw deleteResult;
        return deleteResult;
      },
      writeBookMeta: async (_id, meta) => { calls.meta = structuredClone(meta); },
      writeLibrary: async () => { calls.writes++; }
    } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const tile = context.bookTile({ id: 'test', title: 'Original', screenplay: { title: 'Original' } });
  const event = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  return { calls, library, tile, menu: tile.children[1], event };
}
(async () => {
  const canceledMenu = fixture(null);
  await canceledMenu.menu.onclick(canceledMenu.event);
  assert(canceledMenu.event.prevented && canceledMenu.event.stopped, 'Menu click must not open the screenplay');
  assert.deepEqual(Array.from(canceledMenu.calls.options, o => o.value), ['rename', 'trash']);
  assert.equal(canceledMenu.menu.attrs['aria-label'], 'Options for Original');
  assert.equal(canceledMenu.calls.deleted.length, 0);
  canceledMenu.tile.onkeydown({ target: canceledMenu.menu, key: 'Enter' });
  assert.equal(canceledMenu.calls.open.length, 0, 'Enter on the options button must not open the screenplay');
  canceledMenu.tile.onkeydown({ target: canceledMenu.tile, key: 'Enter' });
  assert.deepEqual(canceledMenu.calls.open, ['test']);

  const canceledDelete = fixture('trash', false);
  await canceledDelete.tile.oncontextmenu(canceledDelete.event);
  assert.deepEqual(canceledDelete.calls.deleted, [['test', 'Original']]);
  assert.equal(canceledDelete.calls.writes, 0, 'Canceling native confirmation must retain the catalog');
  assert.deepEqual(canceledDelete.library.shelves[0].bookIds, ['test', 'other']);

  const deleted = fixture('trash');
  await deleted.menu.onclick(deleted.event);
  assert.deepEqual(Array.from(deleted.library.shelves[0].bookIds), ['other']);
  assert.equal(deleted.library.shelves[1].bookIds.length, 0);
  assert.equal(deleted.calls.writes, 1);
  assert.equal(deleted.calls.renders, 1);

  const renamed = fixture('rename');
  await renamed.tile.oncontextmenu(renamed.event);
  assert.equal(renamed.calls.meta.title, 'Renamed screenplay');
  assert.equal(renamed.calls.meta.screenplay.title, 'Renamed screenplay');
  assert.equal(renamed.calls.deleted.length, 0);

  const failed = fixture('trash', new Error('Recycle Bin unavailable'));
  await failed.menu.onclick(failed.event);
  assert.equal(failed.calls.writes, 0);
  assert.deepEqual(failed.library.shelves[0].bookIds, ['test', 'other']);
  assert.match(failed.calls.errors[0], /Recycle Bin unavailable/);
  console.log('PASS: library options, rename, confirmed deletion, cancel, failure, and keyboard isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });

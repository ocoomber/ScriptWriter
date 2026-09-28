const assert = require('node:assert/strict');
const { inspectRecoveryState } = require('../recovery-state.cjs');

const book = {
  id: 'book-test', title: 'A Screenplay', chapterOrder: ['ch-one'],
  modified: 'later', savedRevision: 'saved', lastPosition: { scroll: 200 }, wordCount: 2
};
const saved = { book, chapters: { 'ch-one': '<p>Two words</p>' }, darlings: [], stickies: [], outline: [] };
const draft = {
  revision: 'saved', updated: 'earlier',
  book: { ...book, modified: 'earlier', savedRevision: 'older', lastPosition: { scroll: 0 }, wordCount: 1 },
  chapters: { 'ch-one': '<p>Two words</p>' }, darlings: [], stickies: [], outline: []
};

assert.equal(inspectRecoveryState(saved, draft), null, 'cursor and bookkeeping changes are not a second version');
assert.deepEqual(inspectRecoveryState(saved, { ...draft, chapters: { 'ch-one': '<p>Three words here</p>' } }),
  { updated: 'earlier', revision: 'saved' }, 'unsaved scene text stays recoverable');
assert.deepEqual(inspectRecoveryState(saved, { ...draft, book: { ...draft.book, title: 'Changed title' } }),
  { updated: 'earlier', revision: 'saved' }, 'unsaved title stays recoverable');
assert.deepEqual(inspectRecoveryState(saved, { ...draft, darlings: [{ text: 'cut line' }] }),
  { updated: 'earlier', revision: 'saved' }, 'unsaved supporting content stays recoverable');
assert.equal(inspectRecoveryState(saved, { ...draft, chapters: {} }), null, 'incomplete journals are ignored');
console.log('PASS: recovery inspection distinguishes bookkeeping from unsaved writing');

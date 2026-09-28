const { isDeepStrictEqual } = require('node:util');

// Return a recovery candidate only when writing or project content differs.
// Cursor position, timestamps, and word counts are bookkeeping, not versions.
function inspectRecoveryState(saved, draft) {
  if (!draft?.book || !Array.isArray(draft.book.chapterOrder) || !draft.chapters || typeof draft.chapters !== 'object') return null;
  if (draft.book.chapterOrder.some(id => typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id) || typeof draft.chapters[id] !== 'string')) return null;
  const candidate = { updated: draft.updated, revision: draft.revision };
  if (!saved?.book) return candidate;

  const contentFields = book => {
    const { modified, savedRevision, lastPosition, wordCount, ...content } = book;
    return content;
  };
  const sameBook = isDeepStrictEqual(contentFields(saved.book), contentFields(draft.book));
  const sameChapters = isDeepStrictEqual(saved.book.chapterOrder, draft.book.chapterOrder) &&
    draft.book.chapterOrder.every(id => saved.chapters?.[id] === draft.chapters[id]);
  const sameSupportingData =
    isDeepStrictEqual(saved.darlings, draft.darlings || []) &&
    isDeepStrictEqual(saved.stickies, draft.stickies || []) &&
    isDeepStrictEqual(saved.outline, draft.outline || []);
  return sameBook && sameChapters && sameSupportingData ? null : candidate;
}

module.exports = { inspectRecoveryState };

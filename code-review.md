# ScriptWriter — Code Review / Bug Report

**Scope reviewed:** `main.js` (1172), `preload.js` (54), `app.js` (4598), `screenplay.js` (605), `screenplay-layout.js` (110), `screenplay.css`, `covers.js`, `art.js`, `index.html`, `package.json`, `tests/*.cjs` (7), `.github/workflows/*`, `screenplay-editor-spec.md`.
**Context:** ScriptWriter is a permanent fork of NEO's *book* editor into a *screenplay* editor. There is no book mode and there never will be. This matters for the last section — a large block of `app.js` is unreachable as a direct result and should be deleted rather than fixed.

Reference spec: `screenplay-editor-spec.md` (cited below as `spec:N`).

---

## CRITICAL

### C1 — The recovery journal serializes the entire screenplay on every keystroke
`screenplay.js:182-188` (`journal`), called from `screenplay.js:189` (`save`), which is the tail of the `input` handler at `screenplay.js:368`.

```js
const journal = () => {
  journalRevision = uid('revision');
  const project = book.id, draft = { ..., book: clone(book),
    chapters: Object.fromEntries(book.chapterOrder.map(id =>
      [id, bodyFor(id) ? captureBody(bodyFor(id)) : chapterHTML[id] || ''])), ... };
  pendingJournal = window.neo.writeJSON(project, 'recovery', draft);
```

Per keystroke this does: `clone(book)`, one `cloneNode(true)` of every scene body (`captureBody` is `cleanBody`, `screenplay-layout.js:25`), a full `JSON.stringify` of the result, an IPC round trip, and — in `main.js:281` — an `atomicWrite` with `fsync`. There is **no debounce and no coalescing.**

Two failures:
1. **Input latency scales with manuscript size.** A 60-scene script makes every character press write megabytes.
2. **Out-of-order writes.** `pendingJournal` is *reassigned* each call, never chained. Two `writeJSON` calls can land in either order. `persist()` (`screenplay.js:499`) awaits only the latest promise, then sets `book.savedRevision = journalRevision` (`screenplay.js:503`). A stale draft can therefore be the file on disk while the metadata claims a newer revision — and `recovery:inspect` (`main.js:197`) compares *content*, so the app offers to "recover" older text after a clean shutdown.

**Fix:** debounce/coalesce `journal()` on the same timer as `scheduleChapterSave` (150 ms is already the pattern at `screenplay.js:495`), and chain writes so the last write always wins — e.g. keep a single in-flight promise and re-issue once on completion. Fire-and-forget is fine; the recovery journal does not need to be synchronous with typing.

---

### C2 — Pagination performs one forced synchronous reflow per character, per keystroke
`screenplay-layout.js:56-73`, inside `layout()`, which is scheduled from the document `input` listener at `screenplay-layout.js:87` and iterates every `[data-element]` in the book (`screenplay-layout.js:34`).

```js
for(let i=0;i<text.length;i++){
  const r=document.createRange();r.setStart(text,i);r.setEnd(text,i+1);
  const rect=r.getBoundingClientRect();
  if((rect.top-p.getBoundingClientRect().top)/zoom>=threshold-0.5){ ... }
```

`p.getBoundingClientRect()` is called **inside** the per-character loop. A single 3,000-character action paragraph is ~3,000 forced layouts, repeated on every keystroke, plus the outer `guard++<100` loop can re-enter the whole scan up to 100 times per element.

**Fix:** hoist `p.getBoundingClientRect()` out of the loop; better, binary-search the character index using `Range` rects (~log n instead of n), or measure once with a hidden mirror element. Also short-circuit: if `h <= usable`, never enter the split branch at all (the branch is already guarded at `:52`, but the `forEach` still pays `offsetHeight` at `:43` for every element on every call).

---

### C3 — `Escape` exits the screenplay and discards your place
`app.js:1724-1727`

```js
if (e.key === 'Escape') {
  if (!$('#searchbar').hidden) closeSearch();
  else window.neo.fullscreenEscape().then((exited) => { if (!exited) backToShelf(); });
}
```

`fullscreenEscape` (`main.js:471`) returns `false` when not fullscreen, so a single stray Escape calls `backToShelf` — which in screenplay mode is `screenplay.js:511`: `await persist(); ... book = null; history.length = 0; currentChapterId = null;` and switches to the bookshelf. No data is lost, but the caret, undo history and `lastPosition` are gone. `screenplay.js:301` shields Escape only while a picker is open, so any other moment is exposed.

This also contradicts `spec:56` ("If the writer cancels a menu with Escape, the text and caret return to their prior state") — Escape is specified as a menu-cancel key, not a navigation key.

**Fix:** remove the `backToShelf()` fallback. If a "return to library" binding is wanted, give it an explicit chord (the Library button already exists at `index.html:111`).

---

### C4 — HTML injection from clipboard and from the library, with full IPC capability
`app.js:1620-1621` (`cleanPasteHtml`)

```js
const holder = document.createElement('div');
holder.innerHTML = html;                                    // untrusted text/html
holder.querySelectorAll('script,style,meta,link,img,table').forEach(n => n.remove());
```

Assigning untrusted `text/html` to `innerHTML` **on a detached node still executes**: `<img src=x onerror=…>` begins loading immediately and the `remove()` on the next line does not reliably cancel the pending error event.

Same class, separate vector: `app.js:971` `body.innerHTML = chapterHTML[chId]` injects raw chapter HTML into a `contenteditable` on every book open. The README states the library folder is meant to be "stored in your Windows Documents folder" and openable in Explorer, and `main.js:53` writes a human-readable `_catalog.txt` there — i.e. the library is explicitly designed to be synced and browsed. A single hostile chapter file in a synced library executes on open.

Impact is not cosmetic: `contextIsolation` is on (`main.js:936`) but `preload.js` exposes the entire `window.neo` surface, so injected script can read/write/delete any file in the library, set secrets, call `email:draft` (which reaches `shell.openExternal`), and run `execFile('osascript', …)`.

**Fix:** sanitize the paste path with a real allowlist sanitizer rather than a tag blacklist — the current blocklist misses `svg`, `math`, `object`, `embed`, `iframe`, `a`, `form`, `input`, event-handler attributes, and `style`/`srcset` payloads. Whitelist to `p, b, strong, i, em, br, span.ph-mark` and attributes `data-sid`, `class`. Apply the same sanitizer to `body.innerHTML` at `app.js:971` and to `holder.innerHTML` at `screenplay.js:406`.

---

### C5 — Attribute injection via `escHtml` in the paste path
`app.js:1630` combined with `app.js:3293`

```js
const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
...
? `<span class="ph-mark" data-sid="${escHtml(r.mark)}" contenteditable="false">⚑</span>`
```

`escHtml` escapes `& < >` but **not `"`**, and the result is interpolated into a double-quoted attribute. `r.mark` originates from `child.dataset.sid` in `paraRuns` (`app.js:4113-4115`), read out of already-parsed clipboard HTML. A `data-sid` containing `"` breaks out of the attribute and injects arbitrary attributes onto the span.

**Fix:** add `.replace(/"/g, '&quot;')` to `escHtml` (and `'`), or use a dedicated attribute escaper at the two attribute-interpolation sites.

---

### C6 — `Enter` across a scene boundary permanently deletes whole scene files
`screenplay.js:168-178`, reached from `onEnter` (`screenplay.js:345`) whenever a non-collapsed selection spans two `.chapter-body` elements.

```js
const removed = book.chapterOrder.splice(startIndex+1, endIndex-startIndex);
for (const scene of removed) { bodyFor(scene)?.closest('.chapter')?.remove();
  delete chapterHTML[scene];
  window.neo.deleteChapter(book.id, scene).catch(...); }
```

Intermediate scenes are spliced out of `chapterOrder` and deleted from disk, un-awaited. `spec:56` only says "Enter replaces the selection with a new line in the current element." Two consequences:
- The user loses entire scenes to a stray drag-select + Enter.
- Recovery depends solely on `recovery.json`, which per **C1** may itself be stale.

**Fix:** clamp the operation to the current scene — insert the new element in `first`'s scene and drop the out-of-scene suffix without deleting intervening scenes, or require an explicit confirm. If cross-scene Enter must stay, at minimum remove the `deleteChapter` calls and leave the scenes orphaned rather than destroyed.

---

### C7 — The PDF very likely emits a blank page between every content page
`screenplay-layout.js:104-105`

```css
@page{size:${width}px ${height}px;margin:0}
.page{position:relative;width:${width}px;height:${height}px;overflow:hidden;break-after:page}
```

A block whose height exactly equals the page box, followed by an explicit `break-after: page`, is the classic Chromium double-page trigger. Combined with `main.js:493-498` (`preferCSSPageSize: true`, zero margins) there is no slack to absorb it.

**The test suite cannot catch this.** `tests/pagination.cjs:89` asserts only `a4facts.pages > 2` — a doubling satisfies it — and the per-token assertions at `:93`/`:105` still pass. `spec:82` and acceptance scenario 10 require the PDF to match the editor's page breaks, so this is a direct spec failure that is currently invisible.

**Fix:** verify by exporting a 3-scene fixture and counting pages. If blank pages appear, make content pages one shorter than the page box (e.g. `height: ${height - 1}px`) or drop `break-after` in favour of a trailing spacer, then **add an exact page-count assertion** to `tests/pagination.cjs` so it cannot regress silently.

---

### C8 — Six IPC handlers join renderer-supplied strings into paths unvalidated
`main.js` — a `safeBookDir` helper already exists (`main.js:256`) but is used only for recovery and backups:

| Handler | Line | Unvalidated input |
|---|---|---|
| `chapter:read` | 173 | `chapterId` |
| `chapter:write` | 184 | `chapterId` |
| `chapter:delete` | 190 | `chapterId` |
| `aux:read` | 263 | `name` |
| `aux:write` | 272 | `name` |
| `json:read` | 278 | `name` |
| `json:write` | 282 | `name` |
| `book:readMeta` / `book:writeMeta` | 161 / 166 | `bookId` |

`path.join(bookDir(bookId), 'chapters', chapterId + '.html')` with `chapterId = '../../..'` escapes the book folder. Chainable with **C4**: injected script can read or overwrite arbitrary paths reachable from the library directory.

**Fix:** validate `bookId` with `safeBookDir` everywhere; validate `chapterId` against `/^ch-[a-z0-9-]+$/i`; whitelist `name` to the known set (`notes`, `outline`, `darlings`, `stickies`, `screenplay-outline`, `recovery`); validate `bookId` in `cover:set` / `cover:remove` / `cover:read` too.

---

## HIGH

### H1 — A corrupt `library.json` destroys every shelf
`main.js:108-117` returns `null` when `readJSON` hits a parse error. `app.js:138` (`loadLibrary`) then does `if (!library.firstRunDone)` on `null` and throws. The window never finishes loading, and the next `writeLibrary` call — there are 30 of them across `app.js` — overwrites `library.json` wholesale with whatever partial object the renderer held. Every shelf and `bookIds` list is lost; the book folders survive as orphans labelled `(none — removed from shelves)` by `writeCatalog` (`main.js:65`).

There is no repair path and no log entry.

**Fix:** back up a corrupt `library.json` to `library.json.corrupt-<ts>` and reseed with `authorName: ''`, preserving the original file for the user. Reject `writeLibrary` payloads that are not objects with a `shelves` array. Log it.

### H2 — `Cmd+Z` does nothing on macOS
`screenplay.js:79`

```js
if (event.ctrlKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
```

`metaKey` is not tested. On macOS `Cmd+Z` has `metaKey: true, ctrlKey: false`, so it falls through to `app.js:3109-3117`, which returns early at `:3114` because `document.activeElement.isContentEditable` is true. The native browser undo then runs against a document the app considers corrupt — precisely the scenario `snapshotStructure`/`resetNativeUndo` exist to prevent. `package.json:19-42` builds and notarizes a mac dmg, so this ships.

**Fix:** `(event.ctrlKey || event.metaKey) && ...` in the `screenplay.js:79` guard.

### H3 — `Ctrl+Enter` both splits a paragraph and toggles fullscreen
`screenplay.js:386` calls `onEnter` for any `Enter` reaching the body keydown, and `onEnter` (`screenplay.js:322`) only bails on `e.metaKey`, never `e.ctrlKey`. `app.js:1738-1743` then preventDefaults and calls `fullscreenToggle` on the same keypress. Result: a new paragraph *and* a fullscreen transition. `enterSequence.count` is also incremented spuriously at `screenplay.js:370` only for arrows, but `app.js:1068` is dead, so the visible effect is the stray split.

**Fix:** bail from `onEnter` when `e.ctrlKey || e.metaKey || e.altKey`.

### H4 — Stale save timers write empty chapter files into the wrong book
`openBook` (`app.js:864-919`) resets `chapterHTML = {}` (`:870`) but never clears `saveTimers`. A pending per-chapter timer from book A fires 150 ms later (`screenplay.js:495`), after `book` now points at B:

```js
const project = book?.id;                                  // captured: book B
const html = chapterHTML[id] || '';                        // read later: undefined → ''
saveTimers[id] = setTimeout(() => window.neo.writeChapter(project, id, html)...)
```

`project` is captured safely, but `html` is **not** — it is read at schedule time from a map that `openBook` has already cleared. The result is an empty `ch-*.html` written into book B's folder. These orphans are invisible to the UI (only `chapterOrder` is enumerated) but they are picked up by `screenplayFiles` (`main.js:741`) and land in **every daily ZIP backup** forever. Rapid shelf→book switching accumulates them.

**Fix:** `Object.values(saveTimers).forEach(clearTimeout); saveTimers = {};` at the top of `openBook`, and capture `html` and `project` together at schedule time.

### H5 — Replace / Replace All never repaginate
`replaceCurrent` (`app.js:3208-3227`) and `replaceAllMatches` (`app.js:3230-3256`) mutate text nodes programmatically. No `input` event fires, so the listener at `screenplay-layout.js:87` never runs and `layout()` is never rescheduled. Because `layout()` positions every `[data-element]` with `position:absolute; top:<px>` (`screenplay-layout.js:42,49`), the stale values remain and paragraphs overlap. `syncChapter` schedules a save and `updateCounters` but not a layout.

**Fix:** call `window.scheduleScreenplayLayout?.()` at the end of both functions.

### H6 — The keybinding collision check cannot detect the collisions it exists to prevent
`screenplay.js:566-567`

```js
const reserved = new Set(['Ctrl+C','Ctrl+V','Ctrl+X','Ctrl+Z','Ctrl+Y','Ctrl+A','Ctrl+F',
  'Ctrl+Shift+Z','Ctrl+Shift+V','Enter','Space','Backspace','Delete','Escape',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
```

`reserved` contains no `Ctrl+`-prefixed entries beyond the listed ones and no `Ctrl+Enter` / `Ctrl+Space`. `defaultBindings('Ctrl')` (`screenplay.js:109`) produces `action: 'Ctrl+Enter'` and `placeholder: 'Ctrl+Space'`. Setting the action modifier to Ctrl therefore saves cleanly and silently collides with the fullscreen toggle at `app.js:1739` and with Chromium's own Ctrl+Space (open emoji/character picker). `spec:58` requires: "Where a binding would collide with ordinary typing or an existing command, show the conflict and require the writer to resolve it before saving."

**Fix:** build `reserved` from the app's own live bindings (the fullscreen chord, all `defaultBindings` for both modifier values) plus the platform-reserved editing set, and check the *resolved* value rather than the literal string so modifier spelling differences are caught.

### H7 — `headingParts` silently destroys hand-edited scene headings
`screenplay.js:246-249`

```js
const m = heading.match(/^(INT\.|EXT\.)\s+(.+?)\s+-\s+(.+)$/i);
return m ? [m[1].toUpperCase(), m[2].toUpperCase(), m[3].toUpperCase()] : ['INT.', '', 'DAY'];
```

The fallback discards the entire location. Entering the heading flow on `INT. KITCHEN` (no time), `INT./EXT. HOUSE`, or `I/E CAR` — all forms `spec:16` and `spec:27` treat as valid — produces `['INT.','','DAY']`, and `completeHeading` (`screenplay.js:271`) then writes `INT.  - DAY`, wiping the location.

This also propagates: `usedLocations()` (`:250`) and `sceneName()` (`:114`) both read through `headingParts`, so one heading without a time removes that location from the suggestion list for the rest of the book.

**Fix:** parse tolerantly — split on the first ` - ` (or `-`/`–`/`—`), treat a missing time as empty rather than `DAY`, and accept `INT./EXT.`, `I/E`, and `EXT./INT.` prefixes.

### H8 — A single Space commits a highlighted location suggestion
`screenplay.js:305-313`

```js
if (e.key === ' ' && !e.shiftKey) {
  if (picker.kind === 'character') { picker.query += ' '; ... return true; }
  if (picker.kind === 'heading-location' && !picker.visible?.length) {
    if (picker.query.endsWith(' ')) acceptPicker(); else { picker.query += ' '; renderPicker(); }
    return true;
  }
  acceptPicker(); return true;
}
```

The double-Space rule is gated on `!picker.visible?.length`. As soon as *any* previously-used location prefix-matches the query, `picker.visible` is non-empty, the branch is skipped, and a **single Space accepts the suggestion** instead of inserting an internal space. Concretely: type `s` in a book that has `SCHOOL HALL`, and one Space commits `SCHOOL HALL` — you cannot type a different location beginning with `s`. `spec:32` is explicit: "When typing a new location, a single Space remains an ordinary internal space; **double Space** ends the location."

**Fix:** always accumulate the first Space; only accept on a second consecutive Space, or on Enter. Accepting a suggestion needs Enter or an explicit highlighted-selection commit, per `spec:33`.

### H9 — Undo history retains up to 150 full-manuscript deep clones
`screenplay.js:42-52`

```js
const captureState = () => ({ book: clone(book),
  html: Object.fromEntries(book.chapterOrder.map(id => [id, bodyFor(id)?.innerHTML ?? chapterHTML[id] ?? ''])),
  darlings: clone(darlings), stickies: clone(stickies), outline: clone(outline), ... });
...
if (!typing || now - lastTypingAt > 650) { history.push(captureState()); if (history.length > 150) history.shift(); }
```

Every entry is a full `JSON.parse(JSON.stringify(book))` plus every scene's `innerHTML`. Typed input is coalesced on a 650 ms sliding window (`:50`), which is correct — but `recordHistory` is called with `typing=false` for every other `inputType`, including `deleteContentBackward` (`:104`). **Holding Backspace to delete a paragraph pushes one full-manuscript clone per character.** Same for `insertFromPaste` and `insertParagraph` bursts.

**Fix:** coalesce on `historyUndo` boundaries rather than only `insertText` — treat any rapid sequence of destructive `inputType`s as one entry by keeping the original snapshot until a non-typing event settles. Or store a diff of changed scenes instead of the whole book.

### H10 — `.docx` import loses non-breaking spaces and merges tab-separated columns
`main.js:584-586, 599-607`

```js
const decodeEntities = (s) => s
  .replace(/&amp;/g,'&amp;').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'");
...
const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map(t => decodeEntities(t[1])).join('');
```

`&nbsp;` (extremely common in Word output) and all numeric entities (`&#160;`, `&#8212;`) pass through as literal text into the manuscript. Separately, the deliberate `w:tab` exclusion — correct as far as it goes, since `<w:tab>` shares a prefix with `<w:tabs>` — means a tab-separated line joins with no separator: `"Name<tab>Address"` becomes `"NameAddress"`.

**Fix:** add `&nbsp;` and a numeric-entity decode pass; emit a single space for `<w:tab .../>` between runs (guard against `<w:tabs>` with a word-boundary-anchored regex, e.g. `/<w:tab\s*\/>/`).

### H11 — macOS `Cmd+Q` closes the window but never quits
`main.js:917-921` + `main.js:869-878` + `main.js:1170-1172`

```js
app.on('before-quit', (event) => {
  if (allowShutdown || !BrowserWindow.getAllWindows().length) return;
  event.preventDefault();
  requestRendererFlush();
});
```

`completeShutdown` (`:869`) sets `allowShutdown = true` and calls `win.close()`. On darwin, `window-all-closed` (`:1170`) deliberately does **not** call `app.quit()`, and nothing re-triggers quit — the original `app.quit()` was cancelled by `preventDefault`. The app ends up alive in the dock with no window; `app.on('activate')` (`:1165`) then silently recreates one.

**Fix:** in `completeShutdown`, after closing the window, call `app.quit()` on all platforms once `allowShutdown` is true.

### H12 — `renderPDF` fails on a long screenplay
`main.js:489`

```js
await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
```

Chromium caps top-level `data:` URL navigation length at roughly 2 MB. A screenplay whose print HTML exceeds that (very reachable at 100+ scenes, since every scene is inlined at `screenplay-layout.js:108`) rejects, the `finally` at `:499` destroys the window, and the rejection propagates out of `export:save` (`:530`) to the renderer as a failed save with no explanation.

Also note `printBackground: false` at `:497` — currently harmless because the print CSS sets `color:#111` and no backgrounds, but it is a silent trap for any future themed export.

**Fix:** write the HTML to a temp file and `loadFile()` it, or register a custom scheme. Either way the export path should surface the failure reason rather than a bare rejection.

### H13 — Stray empty chapter files pollute the library and every backup
Follows from **H4**. `screenplayFiles` (`main.js:741-754`) walks the whole book directory and excludes only `Backups`, so orphan `ch-*.html` files are fingerprinted into the digest and zipped into the daily archive at `main.js:782`. They accumulate across every book switch.

**Fix:** H4's timer clear. Additionally, `main.js:801` should skip chapter files not referenced by `book.json`'s `chapterOrder` when zipping.

---

## MEDIUM

### M1 — `optionModal` / `askInput` are `innerHTML` sinks with unescaped caller data
`askInput` interpolates `title` (`app.js:43`) and `placeholder` (`app.js:44`) into markup. `optionModal` interpolates `title`, `message` (`app.js:78`) and every `o.label` / `o.desc` (`app.js:72-73`).

Three call sites pass unescaped user data while a fourth gets it right:
- `app.js:335` — `` optionModal(`Shelf “${shelf.name}”`, …) ``
- `app.js:604` — `` optionModal(`“${meta.title}”`, …) ``
- `app.js:621` — `` askInput(`Word count goal for “${meta.title}”`, …) ``
- `app.js:743` — `` optionModal(`Cover for “${escHtml(meta.title)}”`, …) `` ✅

Book titles reach the renderer from imported manuscript text (`main.js:659-684` harvests the first line of a `.txt`/`.md`/`.docx` as the title), so this is reachable via import, not just local typing.

**Fix:** escape inside `askInput`/`optionModal` rather than at call sites, so the sinks are safe by construction.

### M2 — `renderShelves` and `openBook` race
`renderShelves` (`app.js:238-455`) awaits `readBookMeta` once per book inside the render loop (`:436`), then does `wrap.replaceChildren(built)` at `:453`. Two concurrent calls — `loadLibrary` fires one unawaited at `:141`, and any of the ~15 `renderShelves()` calls can overlap — can interleave so the *older* render lands last, showing stale shelf contents. `openBook` has the same shape at `app.js:866` (`book = await readBookMeta(bookId)` with no generation guard), so two rapid tile clicks can leave `book` pointing at the wrong project.

**Fix:** add a monotonic render token; bail if it is stale before `replaceChildren`. Same for `openBook`.

### M3 — `switchTab('outline')` creates a chapter
`app.js:2384`

```js
if (book.chapterOrder.length === 0) createChapterAt(0);
```

Opening the Outline tab mutates the screenplay — a render function with a script side effect. `spec:66` is explicit: the Outline is "an independent scratchpad… Moving or editing an outline entry never changes the main script." `createChapterAt` also calls `renderChapters()` (`:1751`), destroying the caret and scroll position as a side effect of clicking a tab.

**Fix:** remove the line. `spec:67`'s "Insert into script" (`screenplay.js:524`) is the only sanctioned path that creates scenes.

### M4 — The Notes tab is re-read asynchronously and overwrites typing
`app.js:2391-2395`

```js
window.neo.readAux(book.id, name).then((html) => {
  auxEditor.innerHTML = html || '';
  auxEditor.focus({ preventScroll: true });
  returnTo();
});
```

Anything typed into the Notes editor during the IPC round trip is silently discarded when the promise resolves, and `focus()` steals focus even if the user has already moved to another tab. Two rapid Notes↔Manuscript switches can interleave two reads into one editor.

**Fix:** load the aux HTML once per book and cache it; only write `innerHTML` when the tab is still active, and only focus if the editor was not already focused.

### M5 — `dailyBackup()` reads and hashes the entire library on a 5-second debounce
`main.js:798-805, 807-815`

```js
for (const name of fs.readdirSync(LIBRARY_DIR)) {
  if (!/^book-[a-z0-9-]+$/i.test(name)) continue;
  try { await backupScreenplay(path.join(LIBRARY_DIR, name), name); }
```

`backupScreenplay` calls `screenplayFiles` (`:766`) then `screenplayFingerprint` (`:768`), which walks again and `readFileSync`s every file — so each file is read twice — all synchronously on the main process, for **every book in the library**, on a timer that `chapter:write`/`aux:write`/`json:write` all reset (`:185`, `:273`, `:283`). UI latency scales with total library size.

**Fix:** back up only the book that changed (pass the id through from the write handlers), and compute the fingerprint from the already-read buffers.

### M6 — Every daily ZIP stores the manuscript twice
`recovery.json` is written into the book directory (`screenplay.js:186`), and `screenplayFiles` (`main.js:741-754`) excludes only `Backups`. Each daily archive therefore contains the full chapter set *and* a full `recovery.json` copy of it.

**Fix:** exclude `recovery.json` in `screenplayFiles`, same as `Backups`.

### M7 — Custom dictionary words are lost on restart
`main.js:987-990`

```js
ipcMain.handle('spell:learn', (_e, word) => {
  if (neoSpell && typeof word === 'string') neoSpell.add(word);
  return true;
});
```

`spell:learn` mutates only the in-memory `nspell` instance. `initSpell` (`main.js:970`) restores from `library.customWords`, which is written at `app.js:3473-3475` — but only from the spellcheck context-menu "always accept" path. Words added through any other route, and all words after a restart unless the pass is re-run, are gone.

**Fix:** have `spell:learn` append to `library.customWords` in `userData` (or reuse the existing library field) so the handler is the single source of truth.

### M8 — `book.tabNames` is read unguarded
`app.js:884-885`

```js
$$('.tab[data-tab="notes"]')[0].textContent = book.tabNames.notes;
```

`book:create` (`main.js:149`) always writes `tabNames`, but any `book.json` produced by an older build, hand-edited, or arriving via a synced library without that key throws a `TypeError` inside `openBook` — after `book` has been assigned but before the view is shown, so the app is stuck on a hidden editor with a loaded book. `screenplay.js:597` also assumes `book.title`/`book.author` exist.

**Fix:** `(book.tabNames || {}).notes || 'Notes'`, and default the object on read.

### M9 — `insertDarlingAtCursor` re-injects stored `darlings.json` HTML
`screenplay.js:406`

```js
const holder = document.createElement('div'); holder.innerHTML = d.html || `...`;
```

`d.html` is whatever was persisted — previously-pasted content passed through `cleanPasteHtml` (and therefore subject to **C4/C5**), or anything a synced/hand-edited `darlings.json` contains. It is normalized through `block()` before insertion, which limits the blast radius, but the parse itself is the hazard.

**Fix:** sanitize `d.html` on read, or store darlings as structured data (`[{element, runs:[{text,b,i}]}]`) rather than raw HTML.

### M10 — No-op undo entries
Two paths push a snapshot and then bail, leaving a dead step in the screenplay history stack:
- `app.js:3233` `snapshotStructure('replace all')` pushes, then `app.js:3253` `undoStack.pop()` pops the **dead** `undoStack` (`screenplay.js:74` reassigned `snapshotStructure` to `recordHistory`, which pushes to `history`). So when nothing matched, the real snapshot remains and the next Ctrl+Z appears to do nothing.
- `screenplay.js:426` `snapshotStructure('darling')` fires, then `:437` `if (!portions.length) return;`.

**Fix:** move the snapshot to after the bail, or pop from the correct stack.

### M11 — `renderNav` override pairs DOM nodes to `chapterOrder` by index
`screenplay.js:401`

```js
$$('#nav-list .nav-item').forEach((item, i) => { const n = item.querySelector('.n-label');
  if (n) n.textContent = sceneName(book.chapterOrder[i]); ... });
```

Positional pairing. If the two lists ever differ in length or order — during an async `renderChapters`, or if `originalRenderNav` skips a chapter — scenes get mislabelled with no error. Also removes the per-scene note editor (`:1973-1986`), so `book.chapterNotes` is unreachable in the UI.

**Fix:** key off `item.dataset.id` (`app.js:1952` already sets it) rather than the loop index.

### M12 — The `screenplayHtml` fallback silently produces a different, unpaginated document
`screenplay.js:525-528` is used only when `window.screenplayPrintHtml` is undefined. With the current load order (`index.html:143-146`: covers, app, screenplay, **screenplay-layout**) it is defined, so the fallback should be unreachable — but it is a live wrong-output path: it concatenates all scenes into one flat flow with no page breaks, hard-coded percentage indents, and its own `@page{size:${paper};margin:25mm 20mm}` that ignores `screenplay-layout.js` geometry entirely. Any future reorder of the script tags in `index.html` degrades every PDF export with no error.

**Fix:** delete the fallback and throw if `window.screenplayPrintHtml` is missing, so a load-order regression is loud rather than silent.

---

## LOW / Housekeeping

- **`showFirstRun` and the Enter hint are unreachable.** `main.js:111-115` force-sets `firstRunDone` and `hintShown` to `true` on the first `library:read`, and the seed at `main.js:34-41` sets them `true` too — so `showFirstRun` (`app.js:144`) and `app.js:914-917` can never run. `tests/electron-smoke.cjs:36` asserts `#firstrun` is hidden ("No setup wizard"), so this appears deliberate. If so, delete `showFirstRun`, the `#firstrun` block in `index.html:27-67`, and the `penNames`/`writingStyle`/`fonts` first-run plumbing in `app.js:147-214`. If it is *not* deliberate, the wizard is broken — worth a one-line confirmation from the author.
- **`library.customWords` and `writingStyle` are write-only** (`writingStyle` is read at `app.js:895` and only ever written by the unreachable `showFirstRun`).
- **`window.neo.deleteBook`, `checkForUpdate`, `update:openRelease` are unreachable** from the UI — `bookTile` is replaced wholesale at `screenplay.js:484-490`, which drops the context menu that called them. There is currently **no way to delete or rename a screenplay except by right-click rename**; the "Move to Recycle Bin" path is gone.
- **`buildTxt`, `buildMd`, `buildDocxEntries`, `buildEpubEntries`, `exportShelfAnthology`, `emailDraft` are all dead** — reachable only from `doExport` (`app.js:4398`), which `screenplay.js:531` replaces with a PDF-only version. Roughly 350 lines (`app.js:3937-4560`). `main.js:539` (`email:draft`) is likewise dead, and it contains the only `execFile` in the app.
- **`main.js:1109` looks for `build/icon.png`** while `package.json:18` declares `build/scriptwriter-icon.png`. Both exist, and the lookup is darwin-only and `existsSync`-guarded, so this is cosmetic — but it is a latent icon-regression if `icon.png` is ever removed.
- **`main.js:64` `writeCatalog` re-reads every book's `book.json` synchronously** on every `library:write` / `book:writeMeta`. It is called from `main.js:123` and `:167`, i.e. on essentially every meta save. Should be debounced with the backups.
- **`screenplay.js:302-303`** — the `w`/`s` navigation exemption for location and character pickers (`spec:34`) is correctly scoped to `heading-type` and `extension` only. No change needed; noting it because it looks like an oversight at a glance and a future refactor could easily "fix" it wrongly.
- **`screenplay.js:83-105`** — the capture-phase `beforeinput` handler runs before `screenplay.js:369`'s body handler and before `app.js`. Correct as written. Any change to load order or phase would break undo and auto-capitalisation simultaneously.
- **`screenplay.js:371`** — `pickerKey` intercepts any `e.key.length === 1` without checking `e.shiftKey`, so `Shift+X` with the picker open types `X` into the query. Cosmetic.
- **`screenplay.js:186`** — `pendingJournal.catch(...)` on the reassigned promise is fine, but see C1.
- **`main.js:832`** — `backup:restore` does `fs.mkdirSync(targetDir, { recursive: false })`; a collision throws outside the `try`, so the error escapes uncaught by the handler's cleanup. Practically unreachable (random id), but move it inside the `try` for consistency.
- **`main.js:455`** — `job.finally(...)` returns a promise nobody handles. Safe today only because the job body is fully wrapped in `try`/`catch` (`:423-452`); a throw from `readSecret` or `String(text)` before the `try` would produce an unhandled rejection.

---

## Dead-code inventory (no book mode — delete, don't fix)

`screenplay.js:395` replaces `wireChapterBody`, so the entire `app.js` keydown pipeline below is unreachable. Confirmed by reference count: every symbol below is referenced only from its own definition and from the dead `wireChapterBody` (the only live call site is `app.js:990`).

| Symbol | Definition | Also live at |
|---|---|---|
| `styleKeepScroll` (body half) | `app.js:1169` | `app.js:2639` (aux editor) — keep the function, drop the body call site |
| `sceneBreakDelete` | `app.js:1540` | — |
| `spaceSafeDelete` | `app.js:1302` | — |
| `emptyChapterBackspace` | `app.js:1146` | — |
| `chapterStartBackspace` | `app.js:1182` | — |
| `guardMarkerDelete` | `app.js:1354` | — |
| `handleEnter` (`***` version) | `app.js:1445` | — |
| `handleTabSpacing` | `app.js:1234` | — |
| `healSelectionSeams` | `app.js:1339` | — |
| `smartKeys` | `app.js:1646` | — |
| `splitChapterAt` | `app.js:1422` | — |
| `flatOffset` / `flatPoint` | `app.js:1261` / `1287` | only from `spaceSafeDelete` |
| `captureBody` (original) | `app.js:1570` | **name is live** — reassigned to `cleanBody` at `screenplay-layout.js:25`. Delete only the original body. |
| `undoStack` / `structuralUndo` (originals) | `app.js:2936` / `3032` | reassigned at `screenplay.js:75` |
| `rejoinAtCaret`, `captureCaret`, `restoreCaret`, `resetNativeUndo`, `snapshotStructure` (originals) | `app.js:3062`–`3030` | `captureCaret`/`restoreCaret` are live via `switchTab` (`app.js:2346,2366`) |
| `findDarlingPosition`, `textPosToRange`, `restoreDarling` (original) | `app.js:2193`, `2176`, `2706` | — |
| `moveSelectionToDarlings` (original) | `app.js:2213` | reassigned at `screenplay.js:420` |
| `renderStickies` (original) | `app.js:1835` | reassigned at `screenplay.js:474` |
| `renderOutline`, `outlineLine`, `syncGhosts` | `app.js:2407`–`2636` | reassigned at `screenplay.js:515` |
| `bookTile` (original) + `dressTile`, `coverMode`, `paintable`, `requestPaint`, `refreshCover`, `markPainting` | `app.js:503`–`760` | reassigned/short-circuited at `screenplay.js:484,491` |
| `buildHtml`, `doExport`, `showHelp`, `showAbout`, `trackDailyWords` (originals) | `app.js:4040`, `4398`, `3871`, `4510`, `2809` | reassigned at `screenplay.js:530,531,571,578,491` |
| `buildTxt`, `buildMd`, `buildDocxEntries`, `buildEpubEntries`, `exportShelfAnthology`, `emailDraft`, `checkForUpdate`, `statsChartSvg`, `openCoverArt`, `openStats`, `applyAlign` | `app.js:4003`–`4560` | — |

**Live and must be kept:** `syncChapter`, `stripJunkSpans` (called from the live `renderChapters` at `app.js:975`), `reconcileMarks` (live from `openBook:890` and the paste handler at `app.js:1052`), `migrateDarlingAnchors` (live at `app.js:889`, though a permanent no-op — the screenplay Darlings flow never creates `.darling-anchor` spans), `bookPlainText` (live at `app.js:749`, `2792`), `safeName` (live at `screenplay.js:539`), `applyFonts` / `setPageZoom` (live from the menu).

**Three behaviours lost with the deletion, which need replacements rather than restoration:**

1. **No scene deletion or merging.** `emptyChapterBackspace` and `chapterStartBackspace` were the only paths. A screenplay editor needs at least "delete scene" and "merge with previous" reachable from the nav pane (`app.js:963-966` already has a per-scene `contextmenu` → `chapterMenu` at `app.js:1019`, currently offering only "Delete chapter" via `deleteChapterToDarlings`, which *does* still work — so this is a merge gap, not a delete gap).
2. **No smart typography.** `smartKeys` (`app.js:1646`) was responsible for curly quotes, em dashes and ellipses. None of it survives. A screenplay is dialogue-heavy, so straight quotes throughout is a visible quality regression. Note `smartKeys` was itself broken — `document.execCommand('delete')` on a collapsed selection is a no-op, so typing `--` produced `-—` and `...` produced `..…`. Port the *behaviour*, not the code: use a `Range` over `[startOffset-1, startOffset]` instead of `execCommand('delete')`.
3. **Chromium workarounds gone.** `healSelectionSeams` (`:1339`) guarded against a known Chromium bug where deleting a selection spanning fragmented text nodes duplicates a character; `guardMarkerDelete` (`:1354`) guarded against mangled deletes beside `contenteditable="false"` inline elements — which `insertPlaceholder` still creates (`app.js:1812`). Both are likely to resurface. Consider porting `guardMarkerDelete` at minimum, since placeholder markers are a core `spec:62` feature.

---

## Test & CI

The tests are genuinely good — real Electron via Playwright, isolated library per run via `SCRIPTWRITER_LIBRARY`, real `assert` calls, and a `pageerror` collector asserted empty at the end. The problems are all in the harness.

- **T1 (HIGH) — `playwright` is not in `package.json`.** All six functional tests do:
  ```js
  let pw; try { pw = require('playwright'); }
  catch { pw = require(process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE,
    '~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node_modules/playwright')); }
  ```
  That hardcoded Codex runtime cache path does not exist on any normal machine or CI runner, so **none of the six load anywhere except the machine that wrote them.** Add `playwright` to `devDependencies` and delete the fallback.
- **T2 (HIGH) — no runner, and CI never runs them.** `package.json:8-14` has no `test` script. `.github/workflows/build.yml` runs only `npm ci` and `npm run package:win`; `pocket.yml` has no test step. The suite is manual-only, so **no regression in this report would have been caught by anything.**
- **T3 (MEDIUM) — `tests/render-icon.cjs` is not a test.** No assertions; it writes `build/scriptwriter-icon.png` as a side effect. Keep it, but move it out of `tests/` or rename it so a suite sweep doesn't fail confusingly on a missing icon dependency.
- **T4 (MEDIUM) — `tests/pagination.cjs` depends on Python + pypdf and degrades silently.** `:28` swallows the probe with `catch { /* try next */ }`, so a missing `pypdf` surfaces later as an unrelated `assert.equal` failure on `a4facts.sizes`. Skip the PDF assertions with a clear message, or vendor the check.
- **T5 (MEDIUM) — C7 is invisible to the suite.** `:89` asserts `a4facts.pages > 2`; a blank-page doubling passes. Add an exact expected page count, and an assertion that page sizes are uniform across *all* pages (not just `sizes[0]`, cf. `:90` and `:104`).
- **T6 (LOW) — coverage gaps.** Untested: the first-run path, action-modifier collision rejection (H6), Darlings round-trip with formatting preserved, the 14-backup retention cap (`main.js:792-795`), `importFile` for `.docx`/`.txt`/`.md` (H10), and the Notes tab aux round-trip (M4).
- **T7 (LOW) — `tests/persistence.cjs` is Windows-only** (`taskkill` at `:44`) with no skip guard, so the file throws on macOS/Linux rather than skipping.

---

## Suggested fix order

| Batch | Items | Rationale |
|---|---|---|
| 1 | **C1, C2** | Two un-debounced O(manuscript) operations on the keystroke path. Everything else feels slow until these land. Self-contained, low risk. |
| 2 | **C4, C5, C8, M1** | The injection + traversal cluster. Fix the sinks at their source (`cleanPasteHtml`, `askInput`/`optionModal`, `escHtml`) and validate every IPC path argument. |
| 3 | **C3, H1, H4, H13** | Cheap, and each is a distinct way to lose work or lose the app. H1 needs the corrupt-file backup path. |
| 4 | **C6, C7, H5, H11, H12** | Output correctness: cross-scene Enter, PDF pagination, repagination after replace, macOS quit, long-document export. |
| 5 | **H2, H3, H6, H7, H8, H9** | Spec conformance for the interaction model (`spec:27-58`). Each needs a test written first. |
| 6 | **T1, T2, then dead-code removal** | Fix the harness so batches 1-5 can't regress, then delete the dead-code inventory and port the three lost behaviours. |

Batches 1-3 are independent of each other and can run in parallel. Batch 6's dead-code removal should come last so the batch 1-5 diffs stay reviewable.

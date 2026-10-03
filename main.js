// ScriptWriter — main process
// Owns the window and all file-system access. The renderer talks to this
// through the IPC handlers below (see preload.js for the exposed API).

const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { inspectRecoveryState } = require('./recovery-state.cjs');

// macOS Chromium's "smart delete" also removes whitespace around a deleted
// selection, and that pass can duplicate characters. Deletes stay literal.
app.setName('ScriptWriter');
const isolatedLibrary = process.env.SCRIPTWRITER_LIBRARY;
const userDataPath = isolatedLibrary
  ? isolatedLibrary + '-user-data'
  : path.join(app.getPath('appData'), 'ScriptWriter');
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
app.commandLine.appendSwitch('blink-settings', 'smartInsertDeleteEnabled=false');

// ---------------------------------------------------------------------------
// Library location: a folder of plain files the user can inspect, sync, back up.
// ---------------------------------------------------------------------------
// Resolved properly at startup via app.getPath('documents') — this default
// covers any early access and non-redirected setups.
let LIBRARY_DIR = process.env.SCRIPTWRITER_LIBRARY || path.join(os.homedir(), 'Documents', 'ScriptWriter Library');
let LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');

function newLibrary() {
  return {
    authorName: '',
    penNames: [],
    firstRunDone: true,
    hintShown: true,
    pageTheme: 'night',
    shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
  };
}

function corruptLibraryName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return LIBRARY_FILE + '.corrupt-' + stamp;
}

function ensureLibrary() {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  if (!fs.existsSync(LIBRARY_FILE)) {
    const seed = newLibrary();
    atomicWrite(LIBRARY_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }

  let library;
  try { library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')); }
  catch { library = null; }
  if (library && typeof library === 'object' && !Array.isArray(library) && Array.isArray(library.shelves)) return library;

  // Keep the original bytes intact for manual recovery before making a fresh,
  // usable library. Never overwrite an unreadable library in place.
  const backup = corruptLibraryName();
  fs.renameSync(LIBRARY_FILE, backup);
  const seed = newLibrary();
  atomicWrite(LIBRARY_FILE, JSON.stringify(seed, null, 2), 'utf8');
  logError('library', new Error(`Invalid library.json saved as ${path.basename(backup)} and replaced with a new library.`));
  return seed;
}

function bookDir(bookId) {
  return path.join(LIBRARY_DIR, bookId);
}

// A human-readable map of the library, regenerated on every change:
// which folder is which book, and what shelf it lives on. Sorts to the
// top of the folder so browsing writers can always find their way.
function writeCatalog() {
  try {
    const lib = readJSON(LIBRARY_FILE, { shelves: [] });
    const onShelf = {};
    for (const s of lib.shelves || []) {
      for (const id of s.bookIds) onShelf[id] = s.name;
    }
    const lines = [];
    for (const d of fs.readdirSync(LIBRARY_DIR)) {
      if (!d.startsWith('book-')) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(LIBRARY_DIR, d, 'book.json'), 'utf8'));
        lines.push(`${m.title || 'Untitled'}  —  ${d}  —  shelf: ${onShelf[m.id] || '(none — removed from shelves)'}`);
      } catch { /* not a valid book folder */ }
    }
    lines.sort((a, b) => a.localeCompare(b));
    atomicWrite(path.join(LIBRARY_DIR, '_catalog.txt'),
      'SCRIPTWRITER LIBRARY CATALOG — which folder is which screenplay\n' +
      '(regenerated automatically; edits here do nothing)\n\n' +
      lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    logError('catalog', err);
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  atomicWrite(file, JSON.stringify(data, null, 2), 'utf8');
}

function atomicWrite(file, data, encoding) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, data, encoding ? { encoding } : undefined); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* cleanup only */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// IPC — the renderer's whole view of the disk
// ---------------------------------------------------------------------------

ipcMain.handle('library:read', () => {
  const library = ensureLibrary();
  if (library && (!library.firstRunDone || !library.hintShown)) {
    library.firstRunDone = true;
    library.hintShown = true;
    writeJSON(LIBRARY_FILE, library);
  }
  return library;
});
ipcMain.handle('library:openFolder', () => require('electron').shell.openPath(LIBRARY_DIR));

ipcMain.handle('library:write', (_e, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.shelves)) {
    throw new Error('Invalid library data');
  }
  ensureLibrary();
  writeJSON(LIBRARY_FILE, data);
  writeCatalog();
  scheduleBackups();
  return true;
});

// A book is a folder: book.json + chapters/*.html + notes.html + outline.html + darlings.json
ipcMain.handle('book:create', (_e, meta) => {
  ensureLibrary();
  // folders carry a slug of the title when it's known at creation (imports),
  // so the library reads like a bookshelf in Finder too
  const slug = String(meta.title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const id = 'book-' + (slug ? slug + '-' : '') +
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const dir = bookDir(id);
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
  const book = {
    id,
    title: meta.title || 'Untitled',
    subtitle: '',
    series: '',
    author: meta.author || 'Anonymous',
    wordGoal: 0,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    chapterOrder: [],
    tabNames: { notes: 'Notes', outline: 'Outline' }
  };
  writeJSON(path.join(dir, 'book.json'), book);
  atomicWrite(path.join(dir, 'notes.html'), '', 'utf8');
  atomicWrite(path.join(dir, 'outline.html'), '', 'utf8');
  writeJSON(path.join(dir, 'darlings.json'), []);
  writeJSON(path.join(dir, 'stickies.json'), []);
  scheduleBackups();
  return book;
});

ipcMain.handle('book:readMeta', (_e, bookId) => {
  return readJSON(path.join(safeBookDir(bookId), 'book.json'), null);
});

ipcMain.handle('book:writeMeta', (_e, bookId, meta) => {
  meta.modified = new Date().toISOString();
  writeJSON(path.join(safeBookDir(bookId), 'book.json'), meta);
  writeCatalog();
  scheduleBackups();
  return true;
});

ipcMain.handle('chapter:read', (_e, bookId, chapterId) => {
  const file = path.join(safeBookDir(bookId), 'chapters', safeChapterId(chapterId) + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('chapter:write', (_e, bookId, chapterId, html) => {
  const dir = path.join(safeBookDir(bookId), 'chapters');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWrite(path.join(dir, safeChapterId(chapterId) + '.html'), html, 'utf8');
  scheduleBackups();
  return true;
});

ipcMain.handle('chapter:delete', (_e, bookId, chapterId) => {
  const file = path.join(safeBookDir(bookId), 'chapters', safeChapterId(chapterId) + '.html');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
});

// A renderer journal can be newer than the debounced manuscript files after
// a crash. Recovery always creates a separate project, never replaces one.
function inspectRecovery(bookId) {
  const dir = safeBookDir(bookId);
  const draft = readJSON(path.join(dir, 'recovery.json'), null);
  const meta = readJSON(path.join(dir, 'book.json'), null);
  const chapters = {};
  if (Array.isArray(draft?.book?.chapterOrder)) {
    for (const id of draft.book.chapterOrder) {
      if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id)) return null;
      try { chapters[id] = fs.readFileSync(path.join(dir, 'chapters', id + '.html'), 'utf8'); }
      catch { /* a missing saved scene is a real recovery difference */ }
    }
  }
  return inspectRecoveryState({
    book: meta, chapters,
    darlings: readJSON(path.join(dir, 'darlings.json'), []),
    stickies: readJSON(path.join(dir, 'stickies.json'), []),
    outline: readJSON(path.join(dir, 'screenplay-outline.json'), [])
  }, draft);
}
ipcMain.handle('recovery:inspect', (_e, bookId) => inspectRecovery(bookId));
ipcMain.handle('recovery:preserve', (_e, bookId) => {
  if (!inspectRecovery(bookId)) return false;
  const dir = safeBookDir(bookId);
  const source = fs.readFileSync(path.join(dir, 'recovery.json'));
  const archiveDir = path.join(dir, 'Recovery Drafts');
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 20);
  const archive = path.join(archiveDir, `recovery-${digest}.json`);
  if (fs.existsSync(archive)) return false;
  atomicWrite(archive, source);
  return true;
});
ipcMain.handle('recovery:copy', (_e, bookId) => {
  const sourceDir = safeBookDir(bookId);
  const archiveDir = path.join(sourceDir, 'Recovery Drafts');
  const archives = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir)
    .filter(name => /^recovery-[a-f0-9]{20}\.json$/.test(name))
    .map(name => ({ name, modified: fs.statSync(path.join(archiveDir, name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified) : [];
  const draft = archives.length
    ? readJSON(path.join(archiveDir, archives[0].name), null)
    : inspectRecovery(bookId) ? readJSON(path.join(sourceDir, 'recovery.json'), null) : null;
  if (!draft) return null;
  if (!draft?.book || !Array.isArray(draft.book.chapterOrder) || !draft.chapters || typeof draft.chapters !== 'object') {
    throw new Error('No recoverable draft');
  }
  const scenes = draft.book.chapterOrder;
  if (scenes.some((scene) => typeof scene !== 'string' || !/^[a-z0-9-]+$/i.test(scene))) {
    throw new Error('Invalid scene ID in recovery draft');
  }
  for (const scene of scenes) {
    if (draft.chapters[scene] !== undefined && typeof draft.chapters[scene] !== 'string') {
      throw new Error('Invalid scene content in recovery draft');
    }
  }

  const id = 'book-recovered-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  const dir = safeBookDir(id);
  const meta = { ...draft.book, id, title: (draft.book.title || 'Untitled') + ' (Recovered Copy)', savedRevision: draft.revision };
  try {
    fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
    for (const scene of scenes) atomicWrite(path.join(dir, 'chapters', scene + '.html'), draft.chapters[scene] || '', 'utf8');
    writeJSON(path.join(dir, 'book.json'), meta);
    writeJSON(path.join(dir, 'darlings.json'), draft.darlings || []);
    writeJSON(path.join(dir, 'stickies.json'), draft.stickies || []);
    writeJSON(path.join(dir, 'screenplay-outline.json'), draft.outline || []);
    return meta;
  } catch (err) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* preserve the original recovery error */ }
    throw err;
  }
});

function safeBookDir(bookId) {
  if (typeof bookId !== 'string' || !/^book-[a-z0-9-]+$/i.test(bookId)) throw new Error('Invalid screenplay ID');
  return bookDir(bookId);
}

function safeChapterId(chapterId) {
  // Current scenes begin `ch-`; accepting the older `scene-` fixture shape is
  // safe too. The important boundary is that no path separator can enter.
  if (typeof chapterId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(chapterId)) {
    throw new Error('Invalid scene ID');
  }
  return chapterId;
}

function safeAuxName(name) {
  if (name !== 'notes' && name !== 'outline') throw new Error('Invalid auxiliary document');
  return name;
}

function safeJSONName(name) {
  const names = new Set(['notes', 'outline', 'darlings', 'stickies', 'screenplay-outline', 'recovery']);
  if (!names.has(name)) throw new Error('Invalid screenplay data name');
  return name;
}

ipcMain.handle('aux:read', (_e, bookId, name) => {
  // name: 'notes' | 'outline'
  const file = path.join(safeBookDir(bookId), safeAuxName(name) + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('aux:write', (_e, bookId, name, html) => {
  atomicWrite(path.join(safeBookDir(bookId), safeAuxName(name) + '.html'), html, 'utf8');
  scheduleBackups();
  return true;
});

ipcMain.handle('json:read', (_e, bookId, name, fallback) => {
  return readJSON(path.join(safeBookDir(bookId), safeJSONName(name) + '.json'), fallback);
});

ipcMain.handle('json:write', (_e, bookId, name, data) => {
  writeJSON(path.join(safeBookDir(bookId), safeJSONName(name) + '.json'), data);
  scheduleBackups();
  return true;
});

ipcMain.handle('book:delete', async (_e, bookId, title) => {
  const dir = safeBookDir(bookId);
  const win = BrowserWindow.getFocusedWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancel', process.platform === 'win32' ? 'Move to Recycle Bin' : 'Move to Trash'],
    defaultId: 0,
    cancelId: 0,
    message: `Move “${title}” to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}?`,
    detail: 'The book folder goes to your system trash, so you can recover it.'
  });
  if (response === 1) {
    const { shell } = require('electron');
    try {
      await shell.trashItem(dir);
      return true;
    } catch (err) {
      // Some filesystems have no Trash (network mounts, odd drives).
      // Words are never lost: leave the book alone and show the writer where it lives.
      logError('trash', err);
      shell.showItemInFolder(dir);
      dialog.showMessageBox(win, {
        message: 'ScriptWriter couldn’t move that folder to the Recycle Bin.',
        detail: 'The book is untouched. Its folder is highlighted so you can deal with it yourself.'
      });
      return false;
    }
  }
  return false;
});

// ---------------------------------------------------------------------------
// Cover art: images live inside the book's folder, so covers travel with
// the library. Timestamped filenames sidestep every caching gremlin.
// ---------------------------------------------------------------------------

const COVER_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

ipcMain.handle('library:path', () => LIBRARY_DIR);

ipcMain.handle('cover:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose cover art',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: COVER_EXTS }]
  });
  return canceled || !filePaths.length ? null : filePaths[0];
});

function clearCovers(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (/^cover-\d+\./.test(f)) fs.unlinkSync(path.join(dir, f));
  }
}

ipcMain.handle('cover:set', (_e, bookId, srcPath) => {
  const ext = path.extname(srcPath).toLowerCase().replace('.', '');
  if (!COVER_EXTS.includes(ext)) return null;
  const dir = safeBookDir(bookId);
  if (!fs.existsSync(dir)) return null;
  clearCovers(dir);
  const fname = 'cover-' + Date.now() + '.' + (ext === 'jpeg' ? 'jpg' : ext);
  fs.copyFileSync(srcPath, path.join(dir, fname));
  return fname;
});

ipcMain.handle('cover:remove', (_e, bookId) => {
  const dir = safeBookDir(bookId);
  if (fs.existsSync(dir)) clearCovers(dir);
  return true;
});

ipcMain.handle('cover:read', (_e, bookId, fname) => {
  try {
    if (!/^(cover|art)-\d+\.(png|jpg|webp)$/.test(fname)) return null;
    const buf = fs.readFileSync(path.join(safeBookDir(bookId), fname));
    const ext = path.extname(fname).slice(1);
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { base64: buf.toString('base64'), mime, ext };
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// Painted covers: once a story passes a thousand words, NEO reads it and
// paints an abstract cover (art.js). The API key lives encrypted in the
// app's own data folder — never in the library, which gets synced and
// backed up as plain files.
// ---------------------------------------------------------------------------

const SECRETS_FILE = () => path.join(app.getPath('userData'), 'secrets.json');

function readSecret(name) {
  try {
    const { safeStorage } = require('electron');
    const all = readJSON(SECRETS_FILE(), {});
    if (!all[name]) return null;
    if (all[name].enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(all[name].value, 'base64'));
    }
    return all[name].value;
  } catch (err) {
    logError('secret', err);
    return null;
  }
}

ipcMain.handle('secret:set', (_e, name, value) => {
  const { safeStorage } = require('electron');
  const all = readJSON(SECRETS_FILE(), {});
  if (!value) {
    delete all[name];
  } else if (safeStorage.isEncryptionAvailable()) {
    all[name] = { enc: true, value: safeStorage.encryptString(String(value)).toString('base64') };
  } else {
    all[name] = { enc: false, value: String(value) };
  }
  writeJSON(SECRETS_FILE(), all);
  return true;
});

ipcMain.handle('secret:has', (_e, name) => !!readSecret(name));

// One painting at a time per book; a second request while one is running
// simply gets the running one's answer.
const paintJobs = new Map();

ipcMain.handle('cover:paint', (_e, bookId, text, options) => {
  if (paintJobs.has(bookId)) return paintJobs.get(bookId);
  const job = (async () => {
    const provider = (options && options.provider) || 'openai';
    const apiKey = readSecret(provider);
    if (!apiKey) return { error: 'No API key for ' + provider + ' — add one under File → Cover Art…' };
    const dir = safeBookDir(bookId);
    if (!fs.existsSync(dir)) return { error: 'Book folder is missing' };
    try {
      const art = require('./art.js');
      const out = await art.paintCover({
        provider,
        apiKey,
        text: String(text || ''),
        textModel: options && options.textModel,
        imageModel: options && options.imageModel,
        quality: options && options.quality
      });
      // sweep older paintings; the writer's own cover-*.png files are untouched
      for (const f of fs.readdirSync(dir)) {
        if (/^art-\d+\.(png|jpg|webp)$/.test(f)) fs.unlinkSync(path.join(dir, f));
      }
      const fname = 'art-' + Date.now() + '.' + (out.ext || 'jpg');
      fs.writeFileSync(path.join(dir, fname), out.buffer);
      // the brief sits beside the picture, so a future repaint can start from it
      writeJSON(path.join(dir, 'art.json'), {
        file: fname,
        brief: out.brief,
        provider,
        textModel: out.textModel,
        imageModel: out.imageModel,
        painted: new Date().toISOString()
      });
      return { file: fname, brief: out.brief };
    } catch (err) {
      logError('paint', err);
      return { error: String((err && err.message) || err) };
    }
  })();
  paintJobs.set(bookId, job);
  job.finally(() => paintJobs.delete(bookId));
  return job;
});

// ---------------------------------------------------------------------------
// Fullscreen
// ---------------------------------------------------------------------------

// ⌘Enter / Ctrl+Enter toggles fullscreen
ipcMain.handle('fullscreen:toggle', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
  return true;
});

// Regular fullscreen: Esc walks you out like any civilized app
ipcMain.handle('fullscreen:escape', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win.isFullScreen()) {
    win.setFullScreen(false);
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Export + email
// ---------------------------------------------------------------------------

async function renderPDF(html, requestedPageSize) {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // Letter is a North American habit; most of the world prints A4.
  const letterCountries = ['US', 'CA', 'MX', 'PH'];
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pageSize = requestedPageSize === 'Letter' || requestedPageSize === 'A4'
      ? requestedPageSize
      : (letterCountries.includes(app.getLocaleCountryCode()) ? 'Letter' : 'A4');
    return await pdfWin.webContents.printToPDF({
      pageSize,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: false
    });
  } finally {
    pdfWin.destroy();
  }
}

// zipEntries: [{path, content, base64?, store?}] — order matters (EPUB mimetype first)
async function buildZip(zipEntries) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  for (const e of zipEntries) {
    zip.file(e.path, e.base64 ? Buffer.from(e.content, 'base64') : e.content, {
      compression: e.store ? 'STORE' : 'DEFLATE'
    });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/epub+zip'
  });
}

ipcMain.handle('export:save', async (_e, { format, defaultName, content, zipEntries, pageSize }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(os.homedir(), 'Documents', defaultName + '.' + format),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (canceled || !filePath) return null;
  if (zipEntries) {
    fs.writeFileSync(filePath, await buildZip(zipEntries));
  } else if (format === 'pdf') {
    fs.writeFileSync(filePath, await renderPDF(content, pageSize));
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return filePath;
});

// Writes a timestamped snapshot to the library's Exports folder, then hands it
// to your email — an outside-the-machine paper trail for provenance.
ipcMain.handle('email:draft', async (_e, { to, subject, body, html, defaultName, method, pageSize }) => {
  const { shell } = require('electron');
  const exportsDir = path.join(LIBRARY_DIR, 'Exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(exportsDir, `${defaultName}-${stamp}.pdf`);
  fs.writeFileSync(file, await renderPDF(html, pageSize));

  if (method === 'gmail') {
    // Gmail compose in the browser can't take an attachment from outside,
    // so open the draft pre-filled and reveal the PDF right next to it to drag in.
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + '&to=' + encodeURIComponent(to)
      + '&su=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    await shell.openExternal(url);
    shell.showItemInFolder(file);
    return { ok: true, method: 'gmail', file };
  }

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
    tell application "Mail"
      set msg to make new outgoing message with properties {subject:"${esc(subject)}", content:"${esc(body)}" & return & return, visible:true}
      tell msg to make new to recipient at end of to recipients with properties {address:"${esc(to)}"}
      tell msg to make new attachment with properties {file name:(POSIX file "${esc(file)}")} at after the last paragraph of content
      activate
    end tell`;
  return new Promise((resolve) => {
    require('child_process').execFile('osascript', ['-e', script], (err) => {
      if (err) {
        // Mail not available — at least reveal the snapshot we saved
        shell.showItemInFolder(file);
        resolve({ ok: false, file });
      } else {
        resolve({ ok: true, method: 'mail', file });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Import: .docx / .txt / .md → chapters; .fountain → screenplay scenes
// ---------------------------------------------------------------------------

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function importFile(fp) {
  const name = path.basename(fp).replace(/\.[^.]+$/, '');
  const ext = path.extname(fp).toLowerCase();
  if (ext === '.fountain') {
    const { parseFountain } = require('./fountain-import.cjs');
    return { name, screenplay: parseFountain(fs.readFileSync(fp, 'utf8'), name) };
  }
  let paras = [];

  if (ext === '.docx') {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(fp));
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Not a valid .docx: ' + fp);
    const xml = await docFile.async('string');
    paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
      const p = m[0];
      // <w:t> or <w:t attr...> ONLY — never <w:tab>/<w:tabs>, which share
      // the same first letters and once leaked raw XML into a manuscript
      const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((t) => decodeEntities(t[1])).join('');
      const pageBreak = /<w:br [^>]*w:type="page"/.test(p) || /<w:pageBreakBefore/.test(p);
      return { text: text.trim(), pageBreak };
    });
  } else {
    const raw = fs.readFileSync(fp, 'utf8');
    paras = raw.split(/\r?\n\s*\r?\n/)
      .map((b) => ({ text: b.replace(/\s*\r?\n\s*/g, ' ').trim(), pageBreak: false }))
      .filter((p) => p.text);
  }

  // Chapterize: page breaks and heading lines start new chapters. Headings
  // include "Chapter N" styles plus bare chapter numbers — "7", "VII",
  // "Seven" — which get stripped so NEO's own numbering doesn't duplicate them.
  const SPELLED = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\.?$/i;
  const isNumeralish = (t) => /^\d{1,3}\.?$/.test(t) || /^[IVXLC]{1,7}\.?$/.test(t) || SPELLED.test(t);
  // Bare numbers only count as chapter markers when there's a ladder of them —
  // a story that merely OPENS with "Seven." keeps its seven.
  const numeralMode = paras.filter((p) => p.text && isNumeralish(p.text.trim())).length >= 2;
  const isHeading = (t) => t && (
    (/^(chapter|prologue|epilogue|part)\b/i.test(t) && t.length < 60) ||
    (numeralMode && isNumeralish(t))
  );
  const isBreak = (t) => /^\s*([*#•~⁂—–-]\s*){1,7}$/.test(t || '');

  const chapterize = (usePageBreaks) => {
    const chapters = [];
    let cur = [];
    for (const p of paras) {
      const brk = usePageBreaks && p.pageBreak;
      if (!p.text && !brk) continue;
      if ((brk || isHeading(p.text)) && cur.length) {
        chapters.push(cur);
        cur = [];
      }
      if (isHeading(p.text)) continue; // the heading line itself is replaced by NEO's numbering
      if (isBreak(p.text)) { cur.push({ scene: true }); continue; }
      if (p.text) cur.push({ text: p.text });
    }
    if (cur.length) chapters.push(cur);
    return chapters;
  };

  const countAllWords = (list) =>
    list.reduce((n, ch) => n + ch.reduce((m, p) => m + (p.text ? p.text.trim().split(/\s+/).length : 0), 0), 0);

  // First pass trusts page breaks. Some word processors sprinkle page-break
  // formatting on every paragraph, exploding a story into confetti — if the
  // result is absurd (lots of tiny "chapters"), re-run trusting headings only.
  let chapters = chapterize(true);
  if (chapters.length > 6 && countAllWords(chapters) / chapters.length < 250) {
    chapters = chapterize(false);
  }
  if (!chapters.length) chapters.push([{ text: '' }]);

  // Front matter: a short title line and a "by Author" line belong on the
  // title page, not in the body. Detect, harvest, and remove them.
  let title = null;
  let author = null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = chapters[0];
  if (first && first.length) {
    const t0 = (first[0].text || '').trim();
    const t1 = first.length > 1 ? (first[1].text || '').trim() : '';
    const titleish = t0 && t0.length < 90 && !/[.!?]$/.test(t0) && (
      (norm(t0).length > 3 && norm(name).includes(norm(t0))) ||
      /^by\s+\S/i.test(t1) ||
      (t0 === t0.toUpperCase() && /[A-Z].*[A-Z]/.test(t0) && t0.length < 60)
    );
    if (titleish) {
      title = t0;
      first.shift();
    }
    const bl = first.length ? (first[0].text || '').trim().match(/^by\s+(.{2,60})$/i) : null;
    if (bl) {
      author = bl[1].trim();
      first.shift();
    }
    if (!first.length) chapters.shift();
    if (!chapters.length) chapters.push([{ text: '' }]);
  }

  return { name, title, author, chapters };
}

// Same parsing as the picker, but for files dropped from Finder/Explorer
ipcMain.handle('import:files', async (_e, paths) => {
  const out = [];
  for (const fp of paths || []) {
    if (!/\.(docx|txt|md|fountain)$/i.test(fp)) continue;
    try {
      out.push(await importFile(fp));
    } catch (err) {
      logError('import', err);
      out.push({ name: path.basename(fp), error: String(err.message || err) });
    }
  }
  return out;
});

ipcMain.handle('import:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Bring your manuscripts home',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Manuscripts and screenplays', extensions: ['docx', 'txt', 'md', 'fountain'] }]
  });
  if (canceled || !filePaths.length) return [];
  const out = [];
  for (const fp of filePaths) {
    try {
      out.push(await importFile(fp));
    } catch (err) {
      logError('import', err);
      out.push({ name: path.basename(fp), error: String(err.message || err) });
    }
  }
  return out;
});

// ---------------------------------------------------------------------------
// Robustness: error log, daily backups, single instance
// ---------------------------------------------------------------------------
const ERROR_LOG = () => path.join(LIBRARY_DIR, 'scriptwriter-errors.log');

function logError(source, err) {
  try {
    ensureLibrary();
    const line = `[${new Date().toISOString()}] [${source}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(ERROR_LOG(), line);
  } catch { /* never let logging crash the app */ }
}

process.on('uncaughtException', (err) => logError('main', err));
process.on('unhandledRejection', (err) => logError('main-promise', err));
ipcMain.handle('log:error', (_e, msg) => logError('renderer', msg));

function screenplayFiles(dir) {
  const files = [];
  const walk = (base, rel) => {
    for (const name of fs.readdirSync(base).sort()) {
      if (name === 'Backups' || name === 'recovery.json') continue;
      const full = path.join(base, name);
      const relative = rel ? rel + '/' + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, relative);
      else files.push({ full, relative });
    }
  };
  walk(dir, '');
  return files;
}

function screenplayFingerprint(dir) {
  const hash = crypto.createHash('sha256');
  for (const file of screenplayFiles(dir)) {
    hash.update(file.relative).update('\0').update(fs.readFileSync(file.full)).update('\0');
  }
  return hash.digest('hex');
}

async function backupScreenplay(dir, bookId) {
  if (!fs.existsSync(dir)) return;
  const files = screenplayFiles(dir);
  if (!files.length) return;
  const digest = screenplayFingerprint(dir);
  const backupsDir = path.join(dir, 'Backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(backupsDir, `scriptwriter-backup-${day}.zip`);
  if (fs.existsSync(target)) {
    try {
      const existing = await require('jszip').loadAsync(fs.readFileSync(target));
      const manifest = JSON.parse(await existing.file('_scriptwriter_backup.json').async('string'));
      if (manifest.fingerprint === digest) return;
    } catch { /* replace an unreadable daily archive with a fresh safe copy */ }
  }
  const JSZip = require('jszip');
  const zip = new JSZip();
  for (const file of files) zip.file(file.relative, fs.readFileSync(file.full));
  zip.file('_scriptwriter_backup.json', JSON.stringify({ bookId, date: day, fingerprint: digest }, null, 2));
  const tmp = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* cleanup only */ }
    throw err;
  }
  const old = fs.readdirSync(backupsDir)
    .filter((name) => /^scriptwriter-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(name))
    .sort();
  while (old.length > 14) fs.unlinkSync(path.join(backupsDir, old.shift()));
}

async function dailyBackup() {
  ensureLibrary();
  for (const name of fs.readdirSync(LIBRARY_DIR)) {
    if (!/^book-[a-z0-9-]+$/i.test(name)) continue;
    try { await backupScreenplay(path.join(LIBRARY_DIR, name), name); }
    catch (err) { logError('backup:' + name, err); }
  }
}

let backupTimer = null;
function scheduleBackups() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    dailyBackup().catch((err) => logError('backup', err));
  }, 5000);
  if (backupTimer.unref) backupTimer.unref();
}

ipcMain.handle('backup:list', (_e, bookId) => {
  const dir = safeBookDir(bookId);
  const backupsDir = path.join(dir, 'Backups');
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((name) => /^scriptwriter-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(name))
    .sort().reverse();
});

ipcMain.handle('backup:restore', async (_e, bookId, archiveName) => {
  const sourceDir = safeBookDir(bookId);
  if (typeof archiveName !== 'string' || !/^scriptwriter-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(archiveName)) {
    throw new Error('Invalid backup name');
  }
  const archivePath = path.join(sourceDir, 'Backups', archiveName);
  const zip = await require('jszip').loadAsync(fs.readFileSync(archivePath));
  const id = 'book-recovered-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  const targetDir = safeBookDir(id);
  fs.mkdirSync(targetDir, { recursive: false });
  try {
    for (const [relative, entry] of Object.entries(zip.files)) {
      if (entry.dir || relative === '_scriptwriter_backup.json') continue;
      if (relative.includes('\\') || path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative)) {
        throw new Error('Unsafe backup path');
      }
      const normalized = path.posix.normalize(relative);
      if (normalized === '..' || normalized.startsWith('../')) throw new Error('Unsafe backup path');
      const dest = path.resolve(targetDir, ...normalized.split('/'));
      const root = path.resolve(targetDir) + path.sep;
      if (!dest.startsWith(root)) throw new Error('Unsafe backup path');
      const bytes = await entry.async('nodebuffer');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      atomicWrite(dest, bytes);
    }
    const metaFile = path.join(targetDir, 'book.json');
    const meta = readJSON(metaFile, null);
    if (!meta) throw new Error('Backup does not contain screenplay metadata');
    meta.id = id;
    meta.title = (meta.title || 'Recovered Screenplay') + ' (Recovered Copy)';
    meta.modified = new Date().toISOString();
    writeJSON(metaFile, meta);
    writeCatalog();
    return meta;
  } catch (err) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw err;
  }
});

let shutdownPending = false;
let allowShutdown = false;
let shutdownTimer = null;
async function completeShutdown() {
  if (allowShutdown) return;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = null;
  try { await dailyBackup(); } catch (err) { logError('shutdown-backup', err); }
  allowShutdown = true;
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.close();
  else app.quit();
}

function requestRendererFlush() {
  if (shutdownPending) return;
  shutdownPending = true;
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) {
    completeShutdown();
    return;
  }
  win.webContents.send('app:beforeQuit');
  shutdownTimer = setTimeout(() => {
    logError('shutdown', 'Renderer did not acknowledge save flush within 10 seconds');
    shutdownPending = false;
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Keep Writing'],
        defaultId: 0,
        message: 'ScriptWriter could not confirm that pending edits were saved.',
        detail: 'The app is still open. Wait for saving to finish, then try closing again.'
      });
    }
  }, 10000);
}

ipcMain.handle('app:flushComplete', async (_e, saved = true) => {
  if (!shutdownPending) return false;
  if (!saved) {
    shutdownPending = false;
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = null;
    return false;
  }
  await completeShutdown();
  return true;
});

app.on('before-quit', (event) => {
  if (allowShutdown || !BrowserWindow.getAllWindows().length) return;
  event.preventDefault();
  requestRendererFlush();
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    backgroundColor: '#191919',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The engine is available, but every editable element starts with
      // spellcheck="false" — NEO never nags. A spellcheck pass is a
      // deliberate act (Edit → Spellcheck Pass), not a klaxon.
      spellcheck: true
    }
  });
  win.on('close', (event) => {
    if (allowShutdown) return;
    event.preventDefault();
    requestRendererFlush();
  });
  win.loadFile('index.html');

  // NEO does its own spellchecking (see spell:* handlers) — the engine's
  // checker proved unreliable at scanning existing text, so it stays off
  win.webContents.session.setSpellCheckerEnabled(false);
}

// ---------------------------------------------------------------------------
// Spellcheck: ScriptWriter's own Hunspell dictionaries. The renderer paints
// the squiggles and asks for suggestions, while this process owns the selected
// language and the learned-word list.
// ---------------------------------------------------------------------------
let neoSpell = null;
let spellLanguage = 'en-GB';
let spellLoadRevision = 0;
let spellLoadPromise = Promise.resolve();

const SPELL_LANGUAGES = {
  'en-GB': { label: 'English (UK)', module: 'dictionary-en-gb' },
  'en-US': { label: 'English (US)', module: 'dictionary-en-us' }
};

function configuredSpellLanguage() {
  const saved = readJSON(LIBRARY_FILE, {})?.spellLanguage;
  return Object.hasOwn(SPELL_LANGUAGES, saved) ? saved : 'en-GB';
}

function loadSpell(language) {
  const selected = Object.hasOwn(SPELL_LANGUAGES, language) ? language : 'en-GB';
  const revision = ++spellLoadRevision;
  spellLanguage = selected;
  neoSpell = null;

  spellLoadPromise = (async () => {
    const nspell = require('nspell');
    // dictionary-en-gb is ESM while the older US package is CommonJS. Dynamic
    // import supports both shapes and keeps the loading detail out of the UI.
    const loaded = await import(SPELL_LANGUAGES[selected].module);
    const dictionary = loaded.default || loaded;
    const dict = typeof dictionary === 'function'
      ? await new Promise((resolve, reject) => dictionary((err, value) => err ? reject(err) : resolve(value)))
      : dictionary;
    if (revision !== spellLoadRevision) return;
    const checker = nspell(dict);
    try {
      for (const word of readJSON(LIBRARY_FILE, {})?.customWords || []) checker.add(word);
    } catch { /* custom words are a nicety */ }
    if (revision === spellLoadRevision) neoSpell = checker;
  })().catch((err) => { logError('spell', err); throw err; });
  spellLoadPromise.catch(() => {});
}

function initSpell() {
  loadSpell(configuredSpellLanguage());
}

async function waitForSpell() {
  while (true) {
    const revision = spellLoadRevision;
    await spellLoadPromise;
    if (revision === spellLoadRevision) return;
  }
}

ipcMain.handle('spell:check', async (_e, words) => {
  await waitForSpell();
  const out = {};
  for (const word of Array.isArray(words) ? words : []) {
    if (typeof word === 'string') out[word] = neoSpell ? neoSpell.correct(word) : true;
  }
  return out;
});

ipcMain.handle('spell:suggest', async (_e, word) => {
  await waitForSpell();
  return neoSpell && typeof word === 'string' ? neoSpell.suggest(word).slice(0, 12) : [];
});

ipcMain.handle('spell:learn', (_e, word) => {
  const learned = typeof word === 'string' ? word.trim() : '';
  if (!learned) return false;
  if (neoSpell) neoSpell.add(learned);
  const library = readJSON(LIBRARY_FILE, {});
  const customWords = Array.isArray(library.customWords) ? library.customWords : [];
  if (!customWords.some((known) => typeof known === 'string' && known.toLocaleLowerCase() === learned.toLocaleLowerCase())) {
    library.customWords = [...customWords, learned];
    writeJSON(LIBRARY_FILE, library);
  }
  return true;
});

ipcMain.handle('spell:settings', () => ({
  language: spellLanguage,
  languages: Object.entries(SPELL_LANGUAGES).map(([code, details]) => ({ code, label: details.label }))
}));

ipcMain.handle('spell:setLanguage', (_e, language) => {
  if (!Object.hasOwn(SPELL_LANGUAGES, language)) return { ok: false, language: spellLanguage };
  const library = readJSON(LIBRARY_FILE, {});
  library.spellLanguage = language;
  writeJSON(LIBRARY_FILE, library);
  loadSpell(language);
  return { ok: true, language };
});

// ---------------------------------------------------------------------------
// Application menu — Help and Format live here, out of the writing room
// ---------------------------------------------------------------------------
function sendToWindow(msg) {
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (w) w.webContents.send('menu', msg);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    // appMenu exists only on macOS — including it on Windows throws,
    // which is exactly what kept NEO from ever opening a window there
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Export',
          submenu: [
            { label: 'PDF (.pdf)', click: () => sendToWindow({ type: 'export', format: 'pdf' }) }
          ]
        },
        { type: 'separator' },
        { label: 'Title Page and Paper Size…', click: () => sendToWindow({ type: 'screenplaySettings' }) },
        { label: 'Writing Settings…', click: () => sendToWindow({ type: 'writingSettings' }) },
        { label: 'Keyboard Settings…', click: () => sendToWindow({ type: 'keyboardSettings' }) },
        { label: 'Recover Unsaved Writing as Copy…', click: () => sendToWindow({ type: 'recoverUnsaved' }) },
        { label: 'Restore Backup as Copy…', click: () => sendToWindow({ type: 'restoreBackup' }) },
        { label: 'Open Library Folder', click: () => require('electron').shell.openPath(LIBRARY_DIR) },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
        { type: 'separator' },
        {
          label: isMac ? 'Find & Replace' : 'Find && Replace',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToWindow({ type: 'find' })
        },
        {
          label: 'Review Spelling…',
          accelerator: 'CmdOrCtrl+;',
          click: () => sendToWindow({ type: 'spellcheck' })
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Full Screen',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            const w = BrowserWindow.getFocusedWindow();
            if (w) w.setFullScreen(!w.isFullScreen());
          }
        },
        { type: 'separator' },
        {
          label: 'Page',
          submenu: [
            { label: 'Night', click: () => sendToWindow({ type: 'pageTheme', value: 'night' }) },
            { label: 'Paper', click: () => sendToWindow({ type: 'pageTheme', value: 'paper' }) }
          ]
        },
        {
          label: 'Brighter Interface',
          click: () => sendToWindow({ type: 'uiBright' })
        }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'ScriptWriter Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendToWindow({ type: 'help' })
        },
        { type: 'separator' },
        {
          label: 'About ScriptWriter',
          click: () => sendToWindow({ type: 'about' })
        },
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  // Windows keeps the File/Edit menu available via Alt, but the writing
  // window does not spend permanent space on it.
  if (process.platform === 'win32') {
    for (const window of BrowserWindow.getAllWindows()) window.setMenuBarVisibility(false);
  }
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => ({ disabled: true, currentVersion: app.getVersion() }));
ipcMain.handle('update:openRelease', () => false);

// Two copies of NEO editing the same library is how words get eaten
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  // Packaged builds get name/icon from electron-builder; this covers `npm start`.
  try {
    const devIcon = path.join(__dirname, 'build', 'icon.png');
    if (process.platform === 'darwin' && fs.existsSync(devIcon)) {
      if (app.dock) app.dock.setIcon(devIcon);
      app.setAboutPanelOptions({
        applicationName: 'ScriptWriter',
        applicationVersion: app.getVersion(),
        iconPath: devIcon
      });
    }
  } catch { /* cosmetic only */ }
  // Startup discipline: the window is created first, and every other step is
  // individually guarded so no single failure can leave the app running
  // invisibly with no window.
  try {
    // the real Documents folder (handles OneDrive-redirected Windows setups)
    try {
      const envLibrary = process.env.SCRIPTWRITER_LIBRARY;
      LIBRARY_DIR = envLibrary || path.join(app.getPath('documents'), 'ScriptWriter Library');
      LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');
      const isolatedUserData = envLibrary
        ? envLibrary + '-user-data'
        : path.join(app.getPath('appData'), 'ScriptWriter');
      fs.mkdirSync(isolatedUserData, { recursive: true });
      app.setPath('userData', isolatedUserData);
    } catch (err) {
      logError('paths', err);
    }

    // macOS press-and-hold accent picker can open invisibly inside Chromium
    // and re-emit swallowed keys as phantom repeated letters. Within NEO,
    // held keys simply repeat — which is what writers expect anyway.
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = require('electron');
        systemPreferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false);
        // macOS injects its own items into any menu named "Edit" —
        // these two official switches remove the ones writers can't use here
        systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
        systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
      } catch (err) {
        logError('prefs', err);
      }
    }

    try { ensureLibrary(); } catch (err) { logError('library', err); }
    createWindow();
    try { initSpell(); } catch (err) { logError('spell', err); }
    try { buildMenu(); } catch (err) { logError('menu', err); }
    dailyBackup().catch((err) => logError('backup', err));
  } catch (err) {
    // catastrophic: tell the human instead of dying in silence
    logError('startup', err);
    try {
      dialog.showErrorBox('ScriptWriter failed to start', String((err && err.stack) || err));
    } catch { /* nothing left to try */ }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

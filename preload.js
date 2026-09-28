const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('neo', {
  inspectRecovery: (bookId) => ipcRenderer.invoke('recovery:inspect', bookId),
  preserveRecovery: (bookId) => ipcRenderer.invoke('recovery:preserve', bookId),
  openLibraryFolder: () => ipcRenderer.invoke('library:openFolder'),
  recoverCopy: (bookId) => ipcRenderer.invoke('recovery:copy', bookId),
  // Kept as `neo` internally so the inherited renderer can be adapted in place.
  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),

  createBook: (meta) => ipcRenderer.invoke('book:create', meta),
  readBookMeta: (bookId) => ipcRenderer.invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => ipcRenderer.invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => ipcRenderer.invoke('book:delete', bookId, title),

  readChapter: (bookId, chId) => ipcRenderer.invoke('chapter:read', bookId, chId),
  writeChapter: (bookId, chId, html) => ipcRenderer.invoke('chapter:write', bookId, chId, html),
  deleteChapter: (bookId, chId) => ipcRenderer.invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => ipcRenderer.invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => ipcRenderer.invoke('aux:write', bookId, name, html),

  readJSON: (bookId, name, fallback) => ipcRenderer.invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => ipcRenderer.invoke('json:write', bookId, name, data),
  listBackups: (bookId) => ipcRenderer.invoke('backup:list', bookId),
  restoreBackup: (bookId, archiveName) => ipcRenderer.invoke('backup:restore', bookId, archiveName),
  onBeforeQuit: (cb) => ipcRenderer.on('app:beforeQuit', () => cb()),
  flushComplete: (saved = true) => ipcRenderer.invoke('app:flushComplete', saved),

  exportSave: (payload) => ipcRenderer.invoke('export:save', payload),
  emailDraft: (payload) => ipcRenderer.invoke('email:draft', payload),
  logError: (msg) => ipcRenderer.invoke('log:error', msg),
  importPick: () => ipcRenderer.invoke('import:pick'),
  libraryPath: () => ipcRenderer.invoke('library:path'),
  pickCover: () => ipcRenderer.invoke('cover:pick'),
  setCover: (bookId, srcPath) => ipcRenderer.invoke('cover:set', bookId, srcPath),
  removeCover: (bookId) => ipcRenderer.invoke('cover:remove', bookId),
  readCover: (bookId, fname) => ipcRenderer.invoke('cover:read', bookId, fname),
  paintCover: (bookId, text, options) => ipcRenderer.invoke('cover:paint', bookId, text, options),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  hasSecret: (name) => ipcRenderer.invoke('secret:has', name),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),
  fullscreenToggle: () => ipcRenderer.invoke('fullscreen:toggle'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  spellCheckWords: (words) => ipcRenderer.invoke('spell:check', words),
  spellSuggest: (word) => ipcRenderer.invoke('spell:suggest', word),
  spellLearn: (word) => ipcRenderer.invoke('spell:learn', word),
  spellSettings: () => ipcRenderer.invoke('spell:settings'),
  setSpellLanguage: (language) => ipcRenderer.invoke('spell:setLanguage', language),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openRelease: () => ipcRenderer.invoke('update:openRelease'),

  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});

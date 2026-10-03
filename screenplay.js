/* Screenplay Editor — the writing layer on top of Neo's proven library and
   chapter persistence.  A chapter file is one scene and contains readable,
   semantic HTML. Supporting screenplay data lives in JSON beside it. */
'use strict';

(() => {
  const originalOpenBook = openBook;
  const originalRenderNav = renderNav;
  const originalBuildHtml = buildHtml;
  const originalRenderChapters = renderChapters;
  const originalInsertPlaceholder = insertPlaceholder;
  let outline = [];
  let picker = null;
  let nativeTypingSinceStructure = false;
  const history = [], future = [];
  let lastTypingAt = 0;
  let journalRevision = '';
  let pendingJournal = Promise.resolve();
  let journalTimer = null;
  let journalDirty = false;
  let enterSequence = { count: 0, block: null, scene: null };
  let pendingDarlingId = null;
  let darlingPlacementBanner = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const point = (node, offset) => {
    const element = node.nodeType === 3 ? node.parentElement : node;
    const body = element.closest?.('.chapter-body');
    if (!body) return null;
    const route = [];
    while (node !== body) { route.unshift([...node.parentNode.childNodes].indexOf(node)); node = node.parentNode; }
    return { scene: body.closest('.chapter').dataset.id, route, offset };
  };
  const selectionState = (range = getSelection().rangeCount ? getSelection().getRangeAt(0) : null) => range ? {
    start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset)
  } : null;
  const restoreSelection = saved => {
    if (!saved?.start || !saved?.end) return null;
    const resolve = p => { let n = bodyFor(p.scene); for (const i of p.route) n = n?.childNodes[i]; return n; };
    const start = resolve(saved.start), end = resolve(saved.end); if (!start || !end) return null;
    const r = document.createRange();
    r.setStart(start, Math.min(saved.start.offset, start.nodeType === 3 ? start.length : start.childNodes.length));
    r.setEnd(end, Math.min(saved.end.offset, end.nodeType === 3 ? end.length : end.childNodes.length));
    bodyFor(saved.start.scene)?.focus(); getSelection().removeAllRanges(); getSelection().addRange(r); return r;
  };
  const captureState = () => ({
    book: clone(book), html: Object.fromEntries(book.chapterOrder.map(id => [id, bodyFor(id) ? captureBody(bodyFor(id)) : chapterHTML[id] ?? ''])),
    darlings: clone(darlings), stickies: clone(stickies), outline: clone(outline), caret: selectionState(), currentChapterId,
    picker: picker ? { kind: picker.kind, label: picker.label, id: picker.id, heading: picker.heading && [...picker.heading], choices: [...picker.choices], query: picker.query, index: picker.index, navigated: picker.navigated, selection: selectionState(picker.range), blockId: picker.block?.dataset.id, cueId: picker.cue?.dataset.id } : null
  });
  const recordHistory = (typing = false) => {
    if (!book) return;
    const now = Date.now();
    if (!typing || now - lastTypingAt > 650) { history.push(captureState()); if (history.length > 150) history.shift(); }
    lastTypingAt = typing ? now : 0; future.length = 0;
  };
  const restoreState = async state => {
    book = clone(state.book); chapterHTML = clone(state.html); darlings = clone(state.darlings); stickies = clone(state.stickies); outline = clone(state.outline);
    currentChapterId = state.currentChapterId; picker = null; popup().hidden = true;
    renderChapters(); renderNav(); renderDarlings(); updateCounters();
    restoreSelection(state.caret);
    if (state.picker) {
      const p = state.picker, body = bodyFor(p.id);
      if (body) {
        picker = { ...p, body, range: restoreSelection(p.selection), block: body.querySelector(`[data-id="${p.blockId}"]`), cue: body.querySelector(`[data-id="${p.cueId}"]`) };
        renderPicker();
      }
    }
    for (const id of book.chapterOrder) scheduleChapterSave(id);
    scheduleMetaSave(); await window.neo.writeJSON(book.id, 'darlings', darlings); await window.neo.writeJSON(book.id, 'stickies', stickies);
    lastTypingAt = 0;
  };
  const undo = async (redo = false) => {
    const source = redo ? future : history, target = redo ? history : future;
    if (!source.length) return;
    target.push(captureState()); await restoreState(source.pop());
  };
  snapshotStructure = () => recordHistory();
  structuralUndo = () => undo();
  document.addEventListener('keydown', event => {
    const inScript = document.activeElement?.closest?.('.chapter-body');
    if (!book || $('#editor-view').hidden || (!inScript && !picker)) return;
    if (event.ctrlKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
      event.preventDefault(); event.stopImmediatePropagation(); undo(event.shiftKey || event.code === 'KeyY');
    } else if (event.key.startsWith('Arrow') || ['Home','End','PageUp','PageDown'].includes(event.key)) lastTypingAt = 0;
  }, true);
  let autoCaseBusy = false;
  const liveQuestionLines = new WeakSet();
  const contractions = new Map(Object.entries({
    im:"I'm", ive:"I've", youre:"you're", youve:"you've", youll:"you'll", youd:"you'd",
    hes:"he's", hed:"he'd", shes:"she's", itll:"it'll", itd:"it'd",
    weve:"we've", theyre:"they're", theyve:"they've", theyll:"they'll", theyd:"they'd",
    thats:"that's", thatll:"that'll", whatll:"what'll", whats:"what's", whos:"who's",
    wheres:"where's", whens:"when's", whys:"why's", hows:"how's", heres:"here's",
    theres:"there's", therell:"there'll", thered:"there'd", yall:"y'all", aint:"ain't",
    dont:"don't", doesnt:"doesn't", didnt:"didn't", cant:"can't", wont:"won't",
    couldnt:"couldn't", wouldnt:"wouldn't", shouldnt:"shouldn't", isnt:"isn't",
    arent:"aren't", wasnt:"wasn't", werent:"weren't", havent:"haven't",
    hasnt:"hasn't", hadnt:"hadn't", mustnt:"mustn't", neednt:"needn't", shant:"shan't",
    wouldve:"would've", couldve:"could've", shouldve:"should've", mightve:"might've",
    mustve:"must've", wouldntve:"wouldn't've", couldntve:"couldn't've", shouldntve:"shouldn't've"
  }));
  const contractionFor = word => {
    const corrected = contractions.get(word.toLocaleLowerCase('en-GB'));
    if (!corrected) return null;
    if (word === word.toLocaleUpperCase('en-GB') && word.length > 1) return corrected.toLocaleUpperCase('en-GB');
    return word[0] === word[0].toLocaleUpperCase('en-GB') ? corrected[0].toLocaleUpperCase('en-GB') + corrected.slice(1) : corrected;
  };
  const replaceBeforeCaret = (paragraph, caret, length, replacement) => {
    const before = document.createRange();
    before.selectNodeContents(paragraph);
    before.setEnd(caret.startContainer, caret.startOffset);
    let remaining = before.toString().length - length;
    const nodes = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = nodes.nextNode())) {
      if (remaining <= node.length) {
        const selected = document.createRange();
        selected.setStart(node, remaining);
        selected.setEnd(caret.startContainer, caret.startOffset);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(selected);
        autoCaseBusy = true;
        try { document.execCommand('insertText', false, replacement); }
        finally { autoCaseBusy = false; }
        return true;
      }
      remaining -= node.length;
    }
    return false;
  };
  document.addEventListener('beforeinput', event => {
    if (!event.target.closest?.('.chapter-body')) return;
    if (!autoCaseBusy && event.inputType === 'insertText' && !event.isComposing && typeof event.data === 'string' && event.data.length === 1) {
      const selection = getSelection();
      const range = selection.rangeCount && selection.getRangeAt(0);
      const node = range?.startContainer;
      const paragraph = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest?.('[data-element]');
      if (range?.collapsed && paragraph && ['action', 'dialogue', 'parenthetical'].includes(paragraph.dataset.element)) {
        const prefix = document.createRange();
        prefix.selectNodeContents(paragraph);
        prefix.setEnd(range.startContainer, range.startOffset);
        const before = prefix.toString();
        if (liveQuestionLines.has(paragraph) && /[.!?]/.test(event.data)) {
          const after = document.createRange();
          after.selectNodeContents(paragraph);
          after.setStart(range.startContainer, range.startOffset);
          if (after.toString() === '?') {
            event.preventDefault();
            recordHistory(true);
            selection.removeAllRanges();
            selection.addRange(after);
            liveQuestionLines.delete(paragraph);
            autoCaseBusy = true;
            try { document.execCommand('insertText', false, event.data); }
            finally { autoCaseBusy = false; }
            return;
          }
        }
        if (/^[a-z]$/.test(event.data) && (/^[\s“‘"'([]*$/.test(before) || /[.!?][”"')\]]*\s+[\s“‘"'([]*$/.test(before))) {
          event.preventDefault();
          document.execCommand('insertText', false, event.data.toUpperCase());
          return;
        }
        if (/[\s.,!?;:'"”’…)\]]/.test(event.data)) {
          if (library?.settings?.autoApostrophes !== false && /[\s.,!?;:…)\]”]/.test(event.data)) {
            const word = before.match(/([\p{L}]+)$/u)?.[1];
            const corrected = word && contractionFor(word);
            if (corrected) {
              event.preventDefault();
              if (replaceBeforeCaret(paragraph, range, word.length, corrected + event.data)) return;
              document.execCommand('insertText', false, event.data);
              return;
            }
          }
          const names = usedCharacters().sort((a, b) => b.length - a.length);
          const name = names.find(value => before.slice(-value.length).toLocaleUpperCase('en-GB') === value &&
            (before.length === value.length || !/[\p{L}\p{N}]/u.test(before[before.length - value.length - 1])));
          const standaloneI = /(?:^|[^\p{L}\p{N}])i$/u.test(before);
          if (name || standaloneI) {
            const length = name ? name.length : 1;
            const replacement = (name ? proseCharacterName(name) : 'I') + event.data;
            event.preventDefault();
            if (replaceBeforeCaret(paragraph, range, length, replacement)) return;
            document.execCommand('insertText', false, event.data);
            return;
          }
        }
      }
    }
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault(); event.stopImmediatePropagation(); undo(event.inputType === 'historyRedo');
    } else recordHistory(['insertText','deleteContentBackward','deleteContentForward'].includes(event.inputType));
  }, true);
  document.addEventListener('mousedown', () => { lastTypingAt = 0; enterSequence.count=0; });
  const uid = (kind) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const keyString=event=>[event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.key===' '?'Space':event.key.length===1?event.key.toUpperCase():event.key].filter(Boolean).join('+');
  const defaultBindings=modifier=>({character:'Tab',action:modifier+'+Enter',placeholder:modifier+'+Space',scene:'Ctrl+Shift+Enter',darling:'Ctrl+Shift+D',outline:'Ctrl+Shift+O',transition:'Ctrl+Shift+R',export:'Ctrl+Shift+P'});
  const bindings=()=>({...defaultBindings(library?.actionModifier||'Shift'),...(library?.keybindings||{})});
  const modifierPressed=event=>(library?.actionModifier==='Ctrl'?event.ctrlKey:event.shiftKey);
  const el = (name, text = '') => { const n = document.createElement(name); n.textContent = text; return n; };
  const bodyFor = (id) => document.querySelector(`.chapter[data-id="${id}"] .chapter-body`);
  const sceneName = (id) => (bodyFor(id)?.querySelector('[data-element="scene-heading"]')?.textContent || book.chapterTitles?.[id] || 'UNTITLED SCENE').trim();
  const block = (type, text = '') => {
    const p = el('p', text);
    p.className = 'screenplay-element sp-block';
    p.dataset.element = type;
    p.dataset.id = uid('el');
    if (!text) p.innerHTML = '<br>';
    return p;
  };
  const normalise = (body) => {
    body.closest('.chapter')?.classList.add('screenplay-page');
    const old = [...body.children];
    if (!old.length || (old.length === 1 && !old[0].textContent.trim() && !old[0].dataset.element)) {
      body.replaceChildren(block('scene-heading'));
      return;
    }
    for (const p of old) {
      if (p.nodeType !== 1) continue;
      if (!p.dataset.element) {
        p.classList.add('screenplay-element', 'sp-block');
        p.dataset.element = p.classList.contains('scene-break') ? 'scene-heading' : 'action';
        p.dataset.id = uid('el');
        p.classList.remove('scene-break');
      }
    }
    if (!body.querySelector('[data-element]')) body.append(block('action'));
  };
  const caretBlock = (body) => {
    const s = getSelection(); if (!s.rangeCount) return null;
    let n = s.anchorNode; if (n?.nodeType === Node.TEXT_NODE) n = n.parentElement;
    return n?.closest?.('[data-element]') && body.contains(n.closest('[data-element]')) ? n.closest('[data-element]') : null;
  };
  const putCaret = (node, end = false) => {
    node.closest('.chapter-body')?.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(node); r.collapse(!end);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  // Replace only the selected span, preserving the prefix and suffix as typed
  // screenplay elements. The same operation serves cues and Darlings.
  const insertBlocks = (range, nodes, body) => {
    const elementAt = node => (node.nodeType === 3 ? node.parentElement : node).closest?.('[data-element]');
    const first = elementAt(range.startContainer), last = elementAt(range.endContainer);
    if (!first || !last || !body.contains(first)) return false;
    const endBody=last.closest('.chapter-body');
    if(!endBody || endBody!==body)return false;
    const before = document.createRange(); before.selectNodeContents(first); before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange(); after.selectNodeContents(last); after.setStart(range.endContainer, range.endOffset);
    const prefix = before.cloneContents(), suffix = after.cloneContents();
    const hasContent = fragment => !!fragment.textContent || !!fragment.querySelector('.ph-mark');
    const replacement = document.createDocumentFragment();
    if (hasContent(prefix)) { const p = block(first.dataset.element); p.dataset.id = first.dataset.id; p.replaceChildren(prefix); replacement.append(p); }
    nodes.forEach(node => replacement.append(node));
    if (hasContent(suffix)) { const p = block(last.dataset.element); p.replaceChildren(suffix); replacement.append(p); }
    let next = first.nextElementSibling;
    while (first !== last && next) { const following = next.nextElementSibling, done = next === last; next.remove(); if (done) break; next = following; }
    first.replaceWith(replacement);
    return true;
  };
  const flushJournal = () => {
    clearTimeout(journalTimer); journalTimer = null;
    if (!book || !journalDirty) return pendingJournal;
    journalDirty = false;
    const project=book.id,draft={revision:journalRevision,updated:new Date().toISOString(),book:clone(book),chapters:Object.fromEntries(book.chapterOrder.map(id=>[id,bodyFor(id)?captureBody(bodyFor(id)):chapterHTML[id]||''])),darlings:clone(darlings),stickies:clone(stickies),outline:clone(outline)};
    pendingJournal=pendingJournal.catch(()=>{}).then(()=>window.neo.writeJSON(project,'recovery',draft));
    pendingJournal.catch(error=>toast('Recovery save failed: '+error.message,10000));
    return pendingJournal;
  };
  const journal = () => {
    if (!book) return;
    journalRevision=uid('revision');journalDirty=true;
    clearTimeout(journalTimer);journalTimer=setTimeout(flushJournal,200);
  };
  const save = (body, id) => { syncChapter(body, id); book.chapterTitles = book.chapterTitles || {}; book.chapterTitles[id] = sceneName(id); scheduleMetaSave(); journal(); window.scheduleScreenplayLayout?.(); };
  const popup = () => {
    let p = document.querySelector('#sp-picker');
    if (!p) { p = document.createElement('div'); p.id = 'sp-picker'; p.className = 'sp-picker'; document.body.append(p); }
    return p;
  };
  let centerCaretFrame = 0;
  const centerScreenplayCaret = (force = false) => {
    if (!document.body.classList.contains('typewriter') || !book || $('#editor-view').hidden || $('#paper').hidden || (!force && picker)) return;
    const body = document.activeElement?.closest?.('.chapter-body');
    const selection = getSelection(), range = selection.rangeCount && selection.getRangeAt(0);
    if (!body || !range?.collapsed || !body.contains(range.startContainer)) return;
    const scroller = $('#paper-scroll');
    let caret = range.getBoundingClientRect();
    if (!caret || (caret.top === 0 && caret.height === 0)) caret = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer).getBoundingClientRect();
    if (!caret) return;
    const viewport = scroller.getBoundingClientRect();
    const difference = caret.top - (viewport.top + viewport.height / 2);
    if (Math.abs(difference) > 2) scroller.scrollTop += difference;
  };
  window.scheduleScreenplayCaretCenter = () => {
    cancelAnimationFrame(centerCaretFrame);
    centerCaretFrame = requestAnimationFrame(() => centerScreenplayCaret());
  };
  const safe = (value) => (typeof escHtml === 'function' ? escHtml(String(value)) : String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const closePicker = (restore = false) => {
    if (!picker) return;
    const old = picker; picker = null; popup().hidden = true;
    if (restore && old.revertOnCancel) { structuralUndo(); return; }
    if (restore && old.range && old.range.startContainer?.isConnected) { const s = getSelection(); s.removeAllRanges(); s.addRange(old.range); }
  };
  const characterPickerTarget = () => {
    if (picker?.kind !== 'character' || !picker.block?.isConnected) return null;
    const wrap = $('#chapters'), zoom = library?.pageZoom || 1;
    const page = wrap.getBoundingClientRect(), current = picker.block.getBoundingClientRect();
    const caret = picker.range?.cloneRange();
    caret?.collapse(true);
    const line = caret?.getBoundingClientRect();
    const lineBottom = line?.height ? line.bottom : current.bottom;
    const after = ['action', 'scene-heading', 'transition'].includes(picker.block.dataset.element) ? 16 : 0;
    let y = (lineBottom - page.top) / zoom + after + 16;
    const height = book?.screenplay?.pageSize === 'letter' ? 1056 : 297 / 25.4 * 96;
    const stride = height + 28, onPage = y % stride;
    if (onPage > height - 72 - 16) y += stride - onPage + 96;
    return { left: page.left + 3.7 * 96 * zoom, top: page.top + y * zoom };
  };
  const renderPicker = () => {
    if (!picker) return;
    const p = popup(); p.hidden = false;
    const typed = picker.query.trim();
    const choices = picker.choices.filter(x => !typed || x.toLowerCase().includes(typed.toLowerCase()));
    if (picker.kind === 'character' && typed) {
      choices.sort((a,b) => Number(b.toLowerCase().startsWith(typed.toLowerCase())) - Number(a.toLowerCase().startsWith(typed.toLowerCase())));
      if (!choices.some(x => x.toLowerCase() === typed.toLowerCase())) choices.push(typed.toUpperCase());
    }
    if (!choices.length && picker.kind !== 'heading-location' && picker.kind !== 'heading-time' && picker.kind !== 'character') choices.push('');
    picker.visible = choices;
    picker.index = Math.max(0, Math.min(picker.index || 0, choices.length - 1));
    p.innerHTML = `<div class="sp-picker-label">${safe(picker.label)}</div><div class="sp-picker-query">${safe(picker.query || ' ')}</div>` + choices.map((x, i) => `<div class="sp-picker-choice ${i === picker.index ? 'selected' : ''}">${safe(picker.kind === 'character' && typed && x === typed.toUpperCase() && !picker.choices.includes(x) ? `Create ${x}` : x || 'New')}</div>`).join('');
    const rect = picker.range?.getBoundingClientRect();
    const fallback = (picker.block || picker.body.querySelector('[data-element="scene-heading"]') || picker.body).getBoundingClientRect();
    let target = characterPickerTarget();
    const query = p.querySelector('.sp-picker-query');
    const queryOffset = query.getBoundingClientRect().top - p.getBoundingClientRect().top;
    if (target) {
      const scroll = $('#paper-scroll'), viewport = scroll.getBoundingClientRect();
      const lower = Math.min(innerHeight - 48, viewport.bottom - 16);
      const upper = Math.max(8, viewport.top + 16);
      const bottom = target.top - queryOffset + p.offsetHeight;
      if (bottom > lower) scroll.scrollTop += bottom - lower;
      else if (target.top - queryOffset < upper) scroll.scrollTop -= upper - target.top + queryOffset;
      target = characterPickerTarget();
    }
    p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, target?.left ?? (rect?.width || rect?.height ? rect.left : fallback.left))) + 'px';
    p.style.top = Math.max(8, Math.min(innerHeight - p.offsetHeight - 8, target ? target.top - queryOffset : (rect?.height ? rect.bottom : fallback.bottom) + 8)) + 'px';
    p.querySelectorAll('.sp-picker-choice').forEach((choice, index) => {
      choice.onmousedown = event => event.preventDefault();
      choice.onclick = () => { picker.index = index; picker.navigated = true; acceptPicker(); };
    });
  };
  const headingParts = (heading) => {
    const m = String(heading||'').trim().match(/^(INT\.\/EXT\.|EXT\.\/INT\.|INT\.|EXT\.|I\/E)\s+(.+)$/i);
    if (!m) return ['INT.', String(heading||'').trim().toUpperCase(), 'DAY'];
    const separator = m[2].match(/\s+[-–—]\s+/);
    const location = separator ? m[2].slice(0,separator.index) : m[2];
    const time = separator ? m[2].slice(separator.index+separator[0].length) : 'DAY';
    return [m[1].toUpperCase(), location.trim().toUpperCase(), time.trim().toUpperCase()||'DAY'];
  };
  const usedLocations = () => book.chapterOrder.map(sceneName).map(headingParts).map(x => x[1]).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
  const characterName = cue => cue.textContent.trim().replace(/(?:\s*\([^)]*\))+$/, '').trim();
  const usedCharacters = () => [...document.querySelectorAll('#chapters [data-element="character"]')].map(characterName).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
  const proseCharacterName = name => name.toLocaleLowerCase('en-GB').replace(/(^|[\s'-])(\p{L})/gu, (_, separator, letter) => separator + letter.toLocaleUpperCase('en-GB'));
  const rankedCharacters = (id, range) => {
    const scene=bodyFor(id);
    let cueNodes=scene ? [...scene.querySelectorAll('[data-element="character"]')] : [];
    const anchor=range?.startContainer?.nodeType === 1 ? range.startContainer.closest?.('[data-element]') : range?.startContainer?.parentElement?.closest?.('[data-element]');
    if (anchor && scene?.contains(anchor)) cueNodes=cueNodes.filter(cue=>cue===anchor || !!(cue.compareDocumentPosition(anchor)&Node.DOCUMENT_POSITION_FOLLOWING));
    const cues=cueNodes.map(characterName).filter(Boolean);
    const recent=[...new Set(cues.slice().reverse())];
    const last=cues.at(-1), beforeLast=cues.length>1 ? cues[cues.length-2] : null;
    // In a back-and-forth, predict the speaker who answered the previous turn.
    const suggested=last && beforeLast && last!==beforeLast ? beforeLast : recent.length===2 ? recent.find(x=>x!==last) : recent[0];
    const remaining=usedCharacters().filter(x=>!recent.includes(x)).sort((a,b)=>a.localeCompare(b));
    return [...new Set([suggested,...recent,...remaining].filter(Boolean))];
  };
  const beginHeading = (body, id) => {
    const b = body.querySelector('[data-element="scene-heading"]');
    if (!b) return;
    if (document.activeElement !== body) putCaret(b);
    centerScreenplayCaret(true);
    const selection=getSelection();
    let r=selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!r || !body.contains(r.startContainer)) { r=document.createRange(); r.selectNodeContents(b); r.collapse(false); }
    const heading=headingParts(b.textContent), choices=['INT.','EXT.','INT./EXT.','EXT./INT.','I/E'];
    picker = { kind: 'heading-type', label: 'SCENE · INT. or EXT.', body, id, heading, choices, query: '', index: Math.max(0,choices.indexOf(heading[0])), range: r };
    renderPicker();
  };
  const completeHeading = () => {
    const p = picker; const b = p.body.querySelector('[data-element="scene-heading"]') || block('scene-heading');
    if (!b.parentElement) p.body.prepend(b);
    snapshotStructure('scene heading');
    b.textContent = `${p.heading[0]} ${p.heading[1]} - ${p.heading[2]}`;
    const action = block('action'); b.after(action); save(p.body, p.id); closePicker(); putCaret(action); currentChapterId = p.id; renderNav();
  };
  const pickerChoice = p => p.visible?.[p.index] || p.query.trim();
  const shouldContinueCue = cue => {
    for (let previous = cue.previousElementSibling; previous; previous = previous.previousElementSibling) {
      if (previous.dataset.element === 'scene-heading' || previous.dataset.element === 'transition') return false;
      if (previous.dataset.element === 'character') return characterName(previous) === characterName(cue);
    }
    return false;
  };
  // Finish a sentence before Enter or Tab leaves its current prose line.
  const addLiveQuestionMark = (event, body) => {
    if (event.inputType !== 'insertText' || event.data !== ' ' || library?.settings?.questionMarkAutofill === false) return;
    const selection = getSelection(), range = selection.rangeCount && selection.getRangeAt(0);
    if (!range?.collapsed) return;
    const element = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer)?.closest?.('[data-element]');
    if (!element || !body.contains(element) || !['action', 'dialogue'].includes(element.dataset.element)) return;
    const before = document.createRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange(); after.selectNodeContents(element); after.setStart(range.startContainer, range.startOffset);
    const sentence = before.toString().replace(/^.*[.!?…][”"')\]]*\s*/s, '');
    if (after.toString() || !/^(?:[“‘"'([]\s*)?(?:what|who|whom|whose|where|when|why|how|which)\s$/i.test(sentence)) return;
    const mark = document.createTextNode('?');
    range.insertNode(mark);
    range.setStartBefore(mark);
    range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    liveQuestionLines.add(element);
  };
  const liveQuestionSuffix = body => {
    const selection = getSelection(), range = selection.rangeCount && selection.getRangeAt(0);
    if (!range?.collapsed) return null;
    const element = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer)?.closest?.('[data-element]');
    if (!element || !body.contains(element) || !liveQuestionLines.has(element)) return null;
    const suffix = document.createRange(); suffix.selectNodeContents(element); suffix.setStart(range.startContainer, range.startOffset);
    return suffix.toString() === '?' ? { element, suffix, range } : null;
  };
  const finishSentenceAtCaret = (body, range, splittingLine = false) => {
    if (!range?.collapsed) return range;
    const source = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const element = source?.closest?.('[data-element]');
    if (!element || !body.contains(element) || !['action', 'dialogue'].includes(element.dataset.element)) return range;
    if (liveQuestionLines.has(element)) {
      const suffix = document.createRange(); suffix.selectNodeContents(element); suffix.setStart(range.startContainer, range.startOffset);
      if (suffix.toString() === '?') {
        range.selectNodeContents(element); range.collapse(false);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        liveQuestionLines.delete(element);
      }
    }
    const remainingText = document.createRange(); remainingText.selectNodeContents(element); remainingText.setStart(range.startContainer, range.startOffset);
    if (!splittingLine && remainingText.toString().trim()) return range;
    if (library?.settings?.autoApostrophes !== false) {
      const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
      const word = prefix.toString().match(/([\p{L}]+)$/u)?.[1];
      const corrected = word && contractionFor(word);
      if (corrected && replaceBeforeCaret(element, range, word.length, corrected)) {
        const selection = getSelection();
        if (selection.rangeCount) range = selection.getRangeAt(0).cloneRange();
      }
    }
    const before = document.createRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
    const text = before.toString();
    const trimmed = text.trimEnd();
    if (!trimmed || /[.!?…][”"')\]]*$/.test(trimmed) || /[,;:—–-]$/.test(trimmed)) return range;
    recordHistory();
    // Trailing space belongs after the sentence-ending mark, never before it.
    const trailing = text.length - trimmed.length;
    if (trailing) {
      const textPoint = offset => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node, remaining = offset;
        while ((node = walker.nextNode())) {
          if (remaining <= node.length) return [node, remaining];
          remaining -= node.length;
        }
        return [element, element.childNodes.length];
      };
      const [startNode, startOffset] = textPoint(trimmed.length);
      const whitespace = document.createRange(); whitespace.setStart(startNode, startOffset); whitespace.setEnd(range.startContainer, range.startOffset);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(whitespace);
      document.execCommand('delete', false);
    }
    document.execCommand('insertText', false, '.');
    const selection = getSelection();
    return selection.rangeCount ? selection.getRangeAt(0).cloneRange() : range;
  };
  const acceptPicker = () => {
    const p = picker; if (!p) return;
    const choice = pickerChoice(p);
    if (p.kind === 'heading-type') { p.heading[0] = choice || 'INT.'; p.kind='heading-location'; p.label='LOCATION'; p.choices=usedLocations(); p.query=''; p.index=0; renderPicker(); return; }
    if (p.kind === 'heading-location') { const val = (choice || p.query).trim(); if (!val) return; p.heading[1]=val.toUpperCase(); p.kind='heading-time'; p.label='TIME'; p.choices=['DAY','NIGHT','MORNING','EVENING','LATER','CONTINUOUS']; p.query=''; p.index=0; renderPicker(); return; }
    if (p.kind === 'heading-time') { p.heading[2]=(choice || p.query || 'DAY').trim().toUpperCase(); completeHeading(); return; }
    if (p.kind === 'character') {
      const name = (choice || p.query).trim().toUpperCase(); if (!name) return;
      snapshotStructure('character cue'); const cue = block('character', name); const dialogue = block('dialogue');
      if (!p.range || !insertBlocks(p.range, [cue, dialogue], p.body)) return;
      if (shouldContinueCue(cue)) cue.textContent += " (CONT'D)";
      save(p.body, p.id); closePicker(); putCaret(dialogue); renderEditCharacters(); return;
    }
    if (p.kind === 'extension') { p.cue.textContent = `${p.cue.textContent.replace(/\s*\([^)]*\)$/, '')} (${choice || 'O.S.'})`; const d = block('dialogue'); p.cue.after(d); save(p.body,p.id); closePicker(); putCaret(d); }
  };
  const openCharacter = (body, id) => {
    const s=getSelection(); let r=s.rangeCount?s.getRangeAt(0).cloneRange():null;
    if (r && !(r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer).closest('.chapter-body')?.isSameNode(body)) return toast('Choose text within one scene for a character cue');
    r = finishSentenceAtCaret(body, r);
    const b=caretBlock(body) || body.querySelector('[data-element]:last-child'); if (!b) return;
    picker={kind:'character',label:'CHARACTER',body,id,block:b,choices:rankedCharacters(id,r),query:'',index:0,navigated:false,range:r}; renderPicker();
  };
  const pickerKey = (e) => {
    if (!picker) return false;
    if (e.key === 'Escape') { e.preventDefault(); closePicker(true); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); picker.index += e.key === 'ArrowDown' ? 1 : -1; picker.navigated = true; renderPicker(); return true; }
    if(['heading-type','extension'].includes(picker.kind) && ['w','s'].includes(e.key.toLowerCase())){e.preventDefault();picker.index+=e.key.toLowerCase()==='s'?1:-1;renderPicker();return true;}
    if (e.key === 'Enter' && !(picker.kind==='character'&&modifierPressed(e))) { e.preventDefault(); acceptPicker(); return true; }
    if (e.key === ' ' && !e.shiftKey) {
      e.preventDefault();
      if (picker.kind === 'character') { picker.query += ' '; picker.navigated = false; renderPicker(); return true; }
      if (picker.kind === 'heading-location' && (picker.query || !picker.visible?.length)) {
        if (picker.query.endsWith(' ')) acceptPicker(); else { picker.query += ' '; renderPicker(); }
        return true;
      }
      acceptPicker(); return true;
    }
    if (picker.kind === 'character' && modifierPressed(e) && e.key === 'Enter') { e.preventDefault(); const name=pickerChoice(picker).trim().toUpperCase(); if (!name) return true; snapshotStructure('character extension'); const cue=block('character',name); if(!insertBlocks(picker.range,[cue],picker.body))return true; picker.cue=cue; picker.revertOnCancel=true; picker.kind='extension'; picker.label='CHARACTER EXTENSION'; picker.choices=['O.S.','V.O.','CONT\'D']; picker.query=''; picker.index=0; renderPicker(); return true; }
    if (e.key === 'Backspace') { e.preventDefault(); picker.query=picker.query.slice(0,-1); picker.index=0; picker.navigated=false; renderPicker(); return true; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      picker.query += e.key; picker.index=0; picker.navigated=false; renderPicker(); return true;
    }
    return false;
  };
  document.addEventListener('keydown', event => {
    if (!picker || event.target.closest?.('.chapter-body')) return;
    if (pickerKey(event)) event.stopImmediatePropagation();
  }, true);
  const onEnter = (e, body, id) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || pickerKey(e)) return;
    const b=caretBlock(body); if (!b) return;
    const selection = getSelection();
    if (selection.rangeCount && selection.isCollapsed) finishSentenceAtCaret(body, selection.getRangeAt(0).cloneRange(), true);
    const splitAtCaret = (type) => {
      const s=getSelection(); if(!s.rangeCount) return null; const r=s.getRangeAt(0).cloneRange();
      const elementAt=node => (node.nodeType===3 ? node.parentElement : node).closest?.('[data-element]');
      const first=elementAt(r.startContainer), last=elementAt(r.endContainer);
      if(!first || !last)return null;
      if(!body.contains(last)){
        const n=block(type);if(!insertBlocks(r,[n],body))return null;
        save(body,id);putCaret(n);return n;
      }
      const prefix=document.createRange(); prefix.selectNodeContents(first); prefix.setEnd(r.startContainer,r.startOffset);
      const suffix=document.createRange(); suffix.selectNodeContents(last); suffix.setStart(r.endContainer,r.endOffset);
      const before=prefix.cloneContents(), after=suffix.cloneContents();
      let next=first.nextElementSibling;
      while(first!==last && next) { const following=next.nextElementSibling; const done=next===last; next.remove(); if(done)break; next=following; }
      first.replaceChildren(before); if(!first.childNodes.length)first.innerHTML='<br>';
      const n=block(type); n.replaceChildren(after); if(!n.childNodes.length)n.innerHTML='<br>'; first.after(n);
      save(body,id); putCaret(n); return n;
    };
    if (keyString(e)===bindings().action && b.dataset.element === 'dialogue') {
      e.preventDefault();
      snapshotStructure('dialogue to action');
      splitAtCaret('action');
      return;
    }
    if (b.dataset.element === 'parenthetical') { e.preventDefault(); const n=block('dialogue'); b.after(n); save(body,id); putCaret(n); return; }
    if(!getSelection().isCollapsed){
      e.preventDefault();
      const r=getSelection().getRangeAt(0),end=(r.endContainer.nodeType===3?r.endContainer.parentElement:r.endContainer).closest('.chapter-body');
      if(end!==body){toast('Choose text within one scene to replace it');return;}
      recordHistory();splitAtCaret(b.dataset.element);enterSequence.count=0;return;
    }
    if (b.dataset.element === 'scene-heading') { e.preventDefault(); beginHeading(body,id); return; }
    e.preventDefault();recordHistory();
    const count=enterSequence.block===b&&enterSequence.scene===id&&!b.textContent.trim()?enterSequence.count+1:1;
    if(count>=3){
      if(!b.textContent.trim())b.remove();save(body,id);enterSequence={count:0,block:null,scene:null};
      const next=createChapterAt(book.chapterOrder.indexOf(id)+1);putCaret(bodyFor(next).querySelector('[data-element="scene-heading"]'));requestAnimationFrame(()=>beginHeading(bodyFor(next),next));return;
    }
    if(count===2){
      b.dataset.element=b.dataset.element==='dialogue'?'character':b.dataset.element;delete b.dataset.continuation;
      save(body,id);putCaret(b);enterSequence={count,block:b,scene:id};return;
    }
    const next=splitAtCaret(b.dataset.element);if(next)next.dataset.continuation='true';save(body,id);enterSequence={count,block:next,scene:id};
  };
  const protectElementBoundary = (event, body, id) => {
    if (!['Backspace', 'Delete'].includes(event.key) || event.ctrlKey || event.altKey || event.metaKey) return false;
    const selection = getSelection(), range = selection.rangeCount && selection.getRangeAt(0);
    if (!range || !range.collapsed) return false;
    const current = caretBlock(body); if (!current) return false;
    const edge = document.createRange(); edge.selectNodeContents(current);
    if (event.key === 'Backspace') edge.setEnd(range.startContainer, range.startOffset);
    else edge.setStart(range.startContainer, range.startOffset);
    if (edge.toString().length) return false;
    const adjacent = event.key === 'Backspace' ? current.previousElementSibling : current.nextElementSibling;
    event.preventDefault();
    if (!adjacent?.dataset.element) return true;
    const empty = element => !element.textContent.trim() && !element.querySelector('.ph-mark');
    if (empty(adjacent)) {
      recordHistory(); adjacent.remove(); save(body,id); putCaret(current,event.key === 'Delete'); return true;
    }
    if (empty(current)) {
      recordHistory(); current.remove(); save(body,id); putCaret(adjacent,event.key === 'Backspace'); return true;
    }
    if (current.dataset.element === adjacent.dataset.element && ['action','dialogue'].includes(current.dataset.element)) {
      recordHistory();
      const first = event.key === 'Backspace' ? adjacent : current;
      const second = event.key === 'Backspace' ? current : adjacent;
      if (first.innerHTML === '<br>') first.replaceChildren();
      while (second.firstChild) first.append(second.firstChild);
      second.remove(); save(body,id); putCaret(first,true);
    }
    return true;
  };
  const wireScreenplayBody = (body,id) => {
    normalise(body);
    body.classList.add('cap-off','screenplay-body');
    body.addEventListener('focus',()=>{currentChapterId=id;});
    body.addEventListener('paste', event => {
      event.preventDefault(); recordHistory();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
      normalise(body); save(body,id);
    });
    body.addEventListener('input',event=>{ enterSequence.count=0; nativeTypingSinceStructure=true; addLiveQuestionMark(event,body); const b=caretBlock(body); if (b?.dataset.element==='dialogue' && b.textContent.startsWith('(')) b.dataset.element='parenthetical'; save(body,id); window.scheduleScreenplayCaretCenter(); });
    body.addEventListener('keydown',(e)=>{
      if(e.key.startsWith('Arrow')||['Home','End','PageUp','PageDown'].includes(e.key))enterSequence.count=0;
      if (pickerKey(e)) { e.stopPropagation(); return; }
      if (['Backspace', 'Delete', 'Enter'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const pendingQuestion = liveQuestionSuffix(body);
        if (pendingQuestion) {
          liveQuestionLines.delete(pendingQuestion.element);
          if (e.key === 'Enter') {
            pendingQuestion.range.selectNodeContents(pendingQuestion.element);
            pendingQuestion.range.collapse(false);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(pendingQuestion.range);
          } else pendingQuestion.suffix.deleteContents();
        }
      }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey && !body.textContent.trim() && book.chapterOrder.length > 1) {
        e.preventDefault(); e.stopPropagation(); recordHistory();
        const index = book.chapterOrder.indexOf(id);
        const next = book.chapterOrder[index > 0 ? index - 1 : 1];
        deleteChapterQuiet(id).then(() => focusChapter(next));
        return;
      }
      if (protectElementBoundary(e,body,id)) { e.stopPropagation(); return; }
      const format={KeyB:'bold',KeyI:'italic',KeyU:'underline'}[e.code];
      if(format && (e.ctrlKey||e.metaKey) && !e.shiftKey && !e.altKey){
        e.preventDefault();e.stopPropagation();applyScriptFormatting(format);return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ' && undoStack.length && !nativeTypingSinceStructure) { e.preventDefault(); structuralUndo(); return; }
      const command=Object.entries(bindings()).find(([,key])=>key===keyString(e))?.[0];
      if(command){e.preventDefault();e.stopPropagation();
        if(command==='character')openCharacter(body,id);
        if(command==='placeholder')insertPlaceholder();
        if(command==='darling')darlingFromKeyboard();
        if(command==='outline')switchTab('outline');
        if(command==='export')doExport('pdf');
        if(command==='scene'){recordHistory();const next=createChapterAt(book.chapterOrder.indexOf(id)+1);putCaret(bodyFor(next).querySelector('[data-element="scene-heading"]'));requestAnimationFrame(()=>beginHeading(bodyFor(next),next));}
        if(command==='transition'){recordHistory();const p=caretBlock(body);if(p){p.dataset.element='transition';save(body,id);}}
        if(command==='action'){if(e.key==='Enter')onEnter(e,body,id);else{recordHistory();const p=caretBlock(body);if(p){p.dataset.element='action';save(body,id);}}}
        return;
      }
      if(e.ctrlKey||e.altKey||e.metaKey)return;
      if (e.key==='Enter') { onEnter(e,body,id); if(e.defaultPrevented)e.stopPropagation(); }
    });
    body.addEventListener('dblclick',()=> { const b=caretBlock(body); if (b?.dataset.element==='scene-heading') beginHeading(body,id); });
  };
  wireChapterBody = wireScreenplayBody;
  renderChapters = function () {
    originalRenderChapters();
    $$('.chapter').forEach(scene => scene.classList.add('screenplay-page'));
    window.scheduleScreenplayLayout?.();
  };
  let sceneJumpTimer;
  const jumpToScene = id => {
    switchTab('manuscript');
    document.activeElement?.closest?.('.chapter-body')?.blur();
    currentChapterId = id;
    highlightNav();
    window.scheduleScreenplayLayout?.();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const heading = bodyFor(id)?.querySelector('[data-element="scene-heading"]');
      if (!heading) return;
      const scroller = $('#paper-scroll');
      scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
      document.querySelectorAll('.scene-jump-highlight').forEach(node => node.classList.remove('scene-jump-highlight'));
      heading.classList.add('scene-jump-highlight');
      clearTimeout(sceneJumpTimer);
      sceneJumpTimer = setTimeout(() => heading.classList.remove('scene-jump-highlight'), 1600);
    }));
  };
  renderNav = function () {
    originalRenderNav(); if (!book) return;
    $$('#nav-list .nav-item').forEach((item, index) => {
      const row = item.querySelector('.n-row');
      const label = item.querySelector('.n-label');
      if (row && label && book.chapterOrder.includes(item.dataset.id)) {
        row.title = 'Click to jump · drag to reorder scenes';
        label.textContent = sceneName(item.dataset.id);
        const number = el('span', String(index + 1).padStart(2, '0') + '.');
        number.className = 'sp-scene-number';
        row.insertBefore(number, label);
      }
      item.querySelector('.nav-note')?.remove();
      item.onclick = () => jumpToScene(item.dataset.id);
    });
  };
  const cancelDarlingPlacement = () => {
    pendingDarlingId = null;
    darlingPlacementBanner?.remove();
    darlingPlacementBanner = null;
  };
  const insertDarlingAtRange = async (id, range) => {
    const d=darlings.find(x=>x.id===id);
    if(!d || !range)return false;
    let n=range.startContainer; if(n?.nodeType===Node.TEXT_NODE)n=n.parentElement;
    const body=n?.closest?.('.chapter-body'); if(!body)return false;
    snapshotStructure('darling inserted');
    const holder=document.createElement('div'); holder.innerHTML=sanitizeScreenplayHtml(d.html || `<p data-element="action">${safe(d.text)}</p>`);
    const nodes=[...holder.children].map(node=>{ const p=block(node.dataset.element||'action'); p.innerHTML=node.innerHTML; return p; });
    if(!nodes.length)nodes.push(block(d.element||'action',holder.textContent));
    if(!insertBlocks(range,nodes,body))return false;
    putCaret(nodes[nodes.length-1],true);
    const id2=body.closest('.chapter').dataset.id;
    normalise(body); save(body,id2);
    darlings=darlings.filter(x=>x.id!==id);
    cancelDarlingPlacement();
    await window.neo.writeJSON(book.id,'darlings',darlings);
    renderDarlings();
    return true;
  };
  const beginDarlingPlacement = (id) => {
    const d=darlings.find(x=>x.id===id); if(!d)return;
    cancelDarlingPlacement();
    if(currentTab!=='manuscript')switchTab('manuscript');
    window.paginateScreenplay?.();
    pendingDarlingId=id;
    const banner=document.createElement('div');
    banner.id='sp-darling-placement'; banner.setAttribute('role','status');
    const instruction=el('strong','Click the spot in the script where this Darling should go.');
    const preview=el('span',(d.text||'').replace(/\s+/g,' ').slice(0,100));
    const cancel=el('button','Cancel'); cancel.type='button'; cancel.onclick=cancelDarlingPlacement;
    banner.append(instruction,preview,cancel); document.body.append(banner);
    darlingPlacementBanner=banner;
  };
  document.addEventListener('click', event => {
    if(!pendingDarlingId)return;
    const paragraph=event.target.closest?.('.chapter-body > [data-element]');
    if(!paragraph)return;
    event.preventDefault(); event.stopImmediatePropagation();
    const body=paragraph.closest('.chapter-body');
    let range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!range || !body.contains(range.startContainer)){
      range=document.createRange(); range.selectNodeContents(paragraph);
      range.collapse(event.clientY < paragraph.getBoundingClientRect().top + paragraph.offsetHeight/2);
    }
    range.collapse(true);
    insertDarlingAtRange(pendingDarlingId,range).catch(error=>toast('Could not save Darling: '+error.message,10000));
  },true);
  document.addEventListener('keydown',event=>{
    if(pendingDarlingId && event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();cancelDarlingPlacement();
    }
  },true);
  document.addEventListener('click',event=>{
    if(pendingDarlingId && event.target.closest?.('.tab:not([data-tab="manuscript"]), #back-to-shelf'))cancelDarlingPlacement();
  },true);
  renderDarlings = function () {
    const list=$('#sticky-list'); if(!list || !book) return; list.innerHTML=''; $('#side-head span').textContent='Darlings';
    if(!darlings.length) { const empty=el('p','No saved passages.');empty.className='darlings-empty';list.append(empty);return; }
    darlings.forEach(d=>{
      const card=document.createElement('div'); card.className='darling';
      const preview=document.createElement('div'); preview.textContent=(d.text||'').slice(0,180);
      const meta=document.createElement('div'); meta.className='d-meta'; meta.textContent=d.chapterLabel||'Scene';
      const actions=document.createElement('div'); actions.className='darling-actions';
      const insert=document.createElement('button'); insert.textContent='Place in script'; insert.onmousedown=event=>event.preventDefault(); insert.onclick=()=>beginDarlingPlacement(d.id);
      const remove=document.createElement('button'); remove.textContent='Delete'; remove.onclick=()=>deleteDarling(d.id).catch(error=>toast('Could not delete Darling: '+error.message,10000));
      actions.append(insert,remove); card.append(preview,meta,actions); list.append(card);
    });
  };
  moveSelectionToDarlings = async () => {
    const selected = getSelection();
    const range = selected.rangeCount && !selected.isCollapsed ? selected.getRangeAt(0).cloneRange() : draggedRange;
    if(!range || !range.toString().trim())return;
    const start = (range.startContainer.nodeType===3 ? range.startContainer.parentElement : range.startContainer).closest('.chapter-body');
    if(!start)return;
    snapshotStructure('darling');
    const holder=document.createElement('div'), portions=[];
    for(const p of $$('#chapters .chapter-body > [data-element]')){
      if(!range.intersectsNode(p))continue;
      const part=document.createRange();part.selectNodeContents(p);
      if(range.compareBoundaryPoints(Range.START_TO_START,part)>0)part.setStart(range.startContainer,range.startOffset);
      if(range.compareBoundaryPoints(Range.END_TO_END,part)<0)part.setEnd(range.endContainer,range.endOffset);
      if(part.collapsed || !part.toString())continue;
      const saved=block(p.dataset.element);saved.replaceChildren(part.cloneContents());
      holder.append(saved);portions.push({p,part});
    }
    if(!portions.length)return;
    const scene=start.closest('.chapter').dataset.id;
    darlings.unshift({id:uid('darling'),html:holder.innerHTML,text:[...holder.children].map(node=>node.textContent).join('\n'),chapterId:scene,chapterLabel:sceneName(scene),date:new Date().toISOString()});
    for(const {p,part} of portions.reverse()){part.deleteContents();if(!p.textContent.trim()&&!p.querySelector('.ph-mark'))p.remove();}
    draggedRange=null;
    $$('.chapter-body').forEach(body=>{ normalise(body);save(body,body.closest('.chapter').dataset.id); });
    putCaret(start.querySelector('[data-element]')||start.firstElementChild,true);
    await window.neo.writeJSON(book.id,'darlings',darlings); renderDarlings(); openDarlingsPanel();
  };
  for(const [zoneId,paneId] of [['nav-hotzone','nav-pane'],['side-hotzone','side-pane']]){
    const zone=document.getElementById(zoneId),pane=document.getElementById(paneId);let timer;
    const show=()=>{clearTimeout(timer);pane.classList.add('open');};
    const leave=event=>{event.stopImmediatePropagation();clearTimeout(timer);timer=setTimeout(()=>{if(!pane.matches(':hover')&&!zone.matches(':hover')&&pane.dataset.pinned!=='1')pane.classList.remove('open');},250);};
    zone.addEventListener('mouseenter',show);pane.addEventListener('mouseenter',show);
    zone.addEventListener('mouseleave',leave,true);pane.addEventListener('mouseleave',leave,true);
  }
  const renderSidePanel = renderDarlings;
  renderDarlings = function () {
    renderSidePanel();
    const list=$('#sticky-list');
    const unresolved=stickies.filter(note=>!note.resolved);
    if(!unresolved.length)return;
    list.append(el('h3','Placeholders'));
    unresolved.forEach(note=>{
      const row=el('div');row.className='darling';
      const jump=el('button',note.text||sceneName(note.chapterId));
      jump.onclick=()=>{switchTab('manuscript');focusSticky(note.id);};
      const edit=el('button','Note'); edit.onclick=async()=>{
        const text=await askInput('Placeholder note','Optional note',note.text||'');
        if(text===null)return;recordHistory();note.text=text;await window.neo.writeJSON(book.id,'stickies',stickies);renderDarlings();
      };
      const resolve=el('button','Resolve');resolve.onclick=()=>{recordHistory();resolveSticky(note.id);renderDarlings();};
      row.append(jump,edit,resolve);list.append(row);
    });
  };
  renderStickies=()=>renderDarlings();
  insertPlaceholder=function(){recordHistory();originalInsertPlaceholder();renderDarlings();};
  document.addEventListener('click',async event=>{
    const mark=event.target.closest('.ph-mark'); if(!mark)return;
    const note=stickies.find(s=>s.id===mark.dataset.sid);if(!note)return;
    const value=await askInput('Placeholder note','Optional note',note.text||'');if(value===null)return;
    recordHistory();note.text=value;await window.neo.writeJSON(book.id,'stickies',stickies);renderDarlings();
  });

  // Retain Neo's library and project file APIs without generating book covers.
  bookTile=function(meta){
    const tile=el('div');tile.className='book';tile.dataset.bookId=meta.id;tile.tabIndex=0;
    const text=el('div');text.className='b-text';const title=el('div',meta.title||'Untitled');title.className='b-title';text.append(title);tile.append(text);
    const showMenu=async event=>{
      event.preventDefault();event.stopPropagation();
      try {
        const choice=await optionModal(meta.title||'Untitled',null,[
          {label:'Rename screenplay',value:'rename'},
          {label:'Move to Recycle Bin',desc:'You can recover the screenplay from the Windows Recycle Bin.',danger:true,value:'trash'}
        ]);
        if(choice==='rename'){
          const name=await askInput('Rename screenplay','Title',meta.title||'');
          if(!name)return;
          meta.title=name;if(meta.screenplay)meta.screenplay.title=name;
          await window.neo.writeBookMeta(meta.id,meta);await renderShelves();
        } else if(choice==='trash'){
          if(!await window.neo.deleteBook(meta.id,meta.title))return;
          for(const shelf of library.shelves)shelf.bookIds=shelf.bookIds.filter(id=>id!==meta.id);
          await window.neo.writeLibrary(library);await renderShelves();
        }
      } catch(error){toast('Could not complete screenplay action: '+error.message,10000);}
    };
    const menu=el('button','⋯');menu.className='screenplay-menu';menu.type='button';
    menu.title='Screenplay options';menu.setAttribute('aria-label','Options for '+(meta.title||'Untitled'));
    menu.onclick=showMenu;tile.append(menu);
    tile.onclick=()=>openBook(meta.id);tile.onkeydown=e=>{if(e.target===tile&&e.key==='Enter')openBook(meta.id);};
    tile.oncontextmenu=showMenu;
    return tile;
  };
  trackDailyWords=()=>{}; requestPaint=async()=>null;
  scheduleChapterSave=function(id){
    const project=book?.id;if(!project)return;clearTimeout(saveTimers[id]);
    const html=chapterHTML[id]||'';
    saveTimers[id]=setTimeout(()=>window.neo.writeChapter(project,id,html).catch(error=>toast('Save failed: '+error.message,10000)),150);
  };
  const persist = async () => {
    if(!book)return;
    flushJournal();
    await pendingJournal;
    Object.values(saveTimers).forEach(clearTimeout);saveTimers={};
    const project=book.id;
    book.lastPosition={chapterId:currentChapterId,scroll:$('#paper-scroll').scrollTop};
    book.savedRevision=journalRevision;
    for(const id of book.chapterOrder){chapterHTML[id]=bodyFor(id)?captureBody(bodyFor(id)):chapterHTML[id]??'';await window.neo.writeChapter(project,id,chapterHTML[id]);}
    await window.neo.writeJSON(project,'screenplay-outline',outline);
    await window.neo.writeJSON(project,'darlings',darlings);
    await window.neo.writeJSON(project,'stickies',stickies);
    await window.neo.writeBookMeta(project,book);
  };
  flushAllSaves=persist;
  backToShelf=async function(){cancelDarlingPlacement();await persist();closePicker();book=null;history.length=0;future.length=0;currentChapterId=null;$('#editor-view').hidden=true;$('#bookshelf-view').hidden=false;renderShelves();};
  $('#back-to-shelf').onclick=backToShelf;

  const saveOutline=()=>window.neo.writeJSON(book.id,'screenplay-outline',outline);
  renderOutline = function () {
    const wrap=$('#outline-list'); if(!wrap || !book)return; wrap.hidden=false; wrap.innerHTML='';
    const add=document.createElement('button'); add.textContent='+ Outline scene'; add.className='sp-outline-add'; add.onclick=()=>{outline.push({id:uid('outline'),heading:'INT. NEW LOCATION - DAY',notes:''});saveOutline();renderOutline();}; wrap.append(add);
    outline.forEach((item,i)=>{ const row=document.createElement('div'); row.className='sp-outline-item'; row.innerHTML='<input class="sp-o-heading"><textarea class="sp-o-notes" placeholder="Scene notes"></textarea><button class="sp-o-up">↑</button><button class="sp-o-down">↓</button><button class="sp-o-insert">Insert into script</button>';
      row.querySelector('.sp-o-heading').value=item.heading || ''; row.querySelector('.sp-o-notes').value=item.notes || '';
      row.querySelector('.sp-o-heading').oninput=e=>{item.heading=e.target.value;saveOutline();}; row.querySelector('.sp-o-notes').oninput=e=>{item.notes=e.target.value;saveOutline();};
      row.querySelector('.sp-o-up').onclick=()=>{if(i){[outline[i-1],outline[i]]=[outline[i],outline[i-1]];saveOutline();renderOutline();}}; row.querySelector('.sp-o-down').onclick=()=>{if(i<outline.length-1){[outline[i+1],outline[i]]=[outline[i],outline[i+1]];saveOutline();renderOutline();}};
      row.querySelector('.sp-o-insert').onclick=()=>insertOutline(item); wrap.append(row); });
  };
  const insertOutline=(item)=>{ snapshotStructure('outline scene inserted'); const at=currentChapterId?book.chapterOrder.indexOf(currentChapterId)+1:book.chapterOrder.length; const id=createChapterAt(at); const b=bodyFor(id); b.innerHTML=''; b.append(block('scene-heading',item.heading.toUpperCase()),block('action',item.notes||'')); save(b,id); renderNav(); switchTab('manuscript'); focusChapter(id); };
  const screenplayHtml=()=>{
    if(!window.screenplayPrintHtml)throw Error('Screenplay page layout is unavailable');
    return window.screenplayPrintHtml();
  };
  buildHtml=function(data,opts){ return book?.screenplay ? screenplayHtml() : originalBuildHtml(data,opts); };
  doExport=async function(){
    if(!book)return toast('Open a screenplay first');
    await persist();
    const unresolved=stickies.filter(note=>!note.resolved);
    if(unresolved.length){
      const details=unresolved.map(note=>`${sceneName(note.chapterId)}: ${note.text||'Unresolved placeholder'}`).join('\n');
      if(await optionModal('Unresolved placeholders',safe(details),[{label:'Export PDF anyway',desc:'Markers and notes will not print.',value:'export'}])!=='export')return;
    }
    const saved=await window.neo.exportSave({format:'pdf',defaultName:safeName(book.title),content:screenplayHtml(),pageSize:book.screenplay.pageSize==='letter'?'Letter':'A4'});
    if(saved)toast('PDF saved');
  };
  window.openScreenplaySettings=async()=>{ const m=book.screenplay||{}; const title=await askInput('Title page title','Title',m.title||book.title||''); if(title===null)return; const writer=await askInput('Writer credit','Written by',m.writer||book.author||''); if(writer===null)return; const contact=await askInput('Contact details','Email or address',m.contact||''); if(contact===null)return; const size=await optionModal('Paper size','Used for PDF export',[{label:'A4',value:'A4'},{label:'US Letter',value:'letter'}]); if(!size)return; recordHistory();book.screenplay={...m,title,writer,contact,pageSize:size};book.title=title||book.title;book.author=writer||'';document.body.dataset.pageSize=size==='letter'?'letter':'a4';journal();saveMeta();$('#tp-title').textContent=title;$('#tp-author').textContent=writer;window.scheduleScreenplayLayout?.();};
  window.openWritingSettings=()=>{
    const backdrop=el('div');backdrop.className='modal-backdrop';
    const modal=el('div');modal.className='modal';backdrop.append(modal);
    modal.append(el('h2','Writing settings'));
    const label=el('label');label.className='writing-setting';
    const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=library?.settings?.questionMarkAutofill!==false;
    label.append(checkbox,document.createTextNode(' Add ? after question words'));
    const apostropheLabel=el('label');apostropheLabel.className='writing-setting';
    const apostropheCheckbox=el('input');apostropheCheckbox.type='checkbox';apostropheCheckbox.checked=library?.settings?.autoApostrophes!==false;
    apostropheLabel.append(apostropheCheckbox,document.createTextNode(' Fix missing apostrophes'));
    modal.append(label,apostropheLabel);
    checkbox.onchange=async()=>{try{library.settings={...(library.settings||{}),questionMarkAutofill:checkbox.checked};await window.neo.writeLibrary(library);}catch(error){toast('Could not save writing setting: '+error.message,10000);}};
    apostropheCheckbox.onchange=async()=>{try{library.settings={...(library.settings||{}),autoApostrophes:apostropheCheckbox.checked};await window.neo.writeLibrary(library);}catch(error){toast('Could not save writing setting: '+error.message,10000);}};
    const close=el('button','Close');close.onclick=()=>backdrop.remove();modal.append(close);
    document.body.append(backdrop);checkbox.focus();
  };
  const recoverUnsavedCopy=async()=>{
    if(!book)return toast('Open a screenplay first');
    const recovered=await window.neo.recoverCopy(book.id);
    if(!recovered)return toast('No unsaved writing to recover');
    library.shelves[0].bookIds.push(recovered.id);await window.neo.writeLibrary(library);
    await backToShelf();await openBook(recovered.id);
  };
  const restoreBackupCopy=async()=>{
    if(!book)return toast('Open a screenplay first');await persist();
    const backups=await window.neo.listBackups(book.id);
    if(!backups.length)return toast('No backups yet. A daily backup is made after edits.');
    const selected=await optionModal('Restore a separate copy','Your current screenplay stays unchanged.',backups.map(name=>({label:name,value:name})));
    if(!selected)return;
    const recovered=await window.neo.restoreBackup(book.id,selected);library.shelves[0].bookIds.push(recovered.id);await window.neo.writeLibrary(library);await backToShelf();await openBook(recovered.id);
  };
  window.neo.onMenu(async(msg) => {
    if(msg.type==='keyboardSettings')window.openKeyboardSettings();
    if(msg.type==='writingSettings')window.openWritingSettings();
    if(msg.type==='screenplaySettings'){if(book)window.openScreenplaySettings();else toast('Open a screenplay first');}
    if(msg.type==='recoverUnsaved')await recoverUnsavedCopy();
    if(msg.type==='restoreBackup')await restoreBackupCopy();
  });
  window.openKeyboardSettings=()=>{
    const bd=el('div');bd.className='modal-backdrop';const modal=el('div');modal.className='modal';bd.append(modal);
    modal.append(el('h2','Keyboard settings'),el('p','Click a shortcut and press its replacement. Standard Windows editing shortcuts stay reserved.'));
    const modifier=el('select');['Shift','Ctrl'].forEach(value=>{const option=el('option',value);option.value=value;modifier.append(option);});modifier.value=library.actionModifier||'Shift';
    const label=el('label','Action modifier ');label.append(modifier);modal.append(label);
    const values={...bindings()}, inputs={};
    const names={character:'Character selector',action:'Dialogue to action',placeholder:'Placeholder',scene:'New scene',darling:'Move to Darlings',outline:'Outline',transition:'Transition element',export:'Export PDF'};
    for(const [action,name]of Object.entries(names)){const row=el('label',name+' '),input=el('input');input.value=values[action];input.readOnly=true;input.onkeydown=event=>{event.preventDefault();event.stopPropagation();if(['Control','Shift','Alt','Meta'].includes(event.key))return;values[action]=keyString(event);input.value=values[action];};inputs[action]=input;row.append(input);modal.append(row);}
    modifier.onchange=()=>{for(const action of ['action','placeholder']){values[action]=defaultBindings(modifier.value)[action];inputs[action].value=values[action];}};
    const error=el('p');error.style.color='#f0b59d';const saveButton=el('button','Save'),cancel=el('button','Cancel');
    saveButton.onclick=async()=>{
      const reserved=new Set(['Ctrl+C','Ctrl+V','Ctrl+X','Ctrl+Z','Ctrl+Y','Ctrl+A','Ctrl+F','Ctrl+Shift+Z','Ctrl+Shift+V','Enter','Space','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
      const seen=new Set();for(const value of Object.values(values)){if(reserved.has(value)||(!value.includes('+')&&value!=='Tab'&&!/^F\d+$/.test(value))){error.textContent=value+' conflicts with ordinary editing.';return;}if(seen.has(value)){error.textContent=value+' is assigned twice.';return;}seen.add(value);}
      library.actionModifier=modifier.value;library.keybindings=values;await window.neo.writeLibrary(library);bd.remove();
    };cancel.onclick=()=>bd.remove();modal.append(error,cancel,saveButton);document.body.append(bd);
  };
  showHelp=()=>{
    const backdrop=el('div');backdrop.className='modal-backdrop';const modal=el('div');modal.className='modal';
    modal.append(el('h2','ScriptWriter controls'));
    const lines=[['Enter','New line; repeated Enter starts a paragraph, then a scene'],[bindings().character,'Choose a character'],[bindings().action,'Dialogue to Action'],[bindings().placeholder,'Insert a placeholder'],[bindings().darling,'Move selected text to Darlings'],[bindings().outline,'Open Outline'],['Ctrl+Z / Ctrl+Y','Undo / redo']];
    for(const [key,description]of lines){const p=el('p');const strong=el('strong',key+'  ');p.append(strong,document.createTextNode(description));modal.append(p);}
    const done=el('button','Close');done.onclick=()=>backdrop.remove();modal.append(done);backdrop.append(modal);document.body.append(backdrop);done.focus();
  };
  showAbout=async()=>{
    const v=await window.neo.appVersion(),backdrop=el('div');backdrop.className='modal-backdrop';const modal=el('div');modal.className='modal';
    modal.append(el('h2','ScriptWriter'),el('p','Version '+v));
    const done=el('button','Close');done.onclick=()=>backdrop.remove();modal.append(done);backdrop.append(modal);document.body.append(backdrop);done.focus();
  };
  if (window.neo.onBeforeQuit) window.neo.onBeforeQuit(async () => {
    try{await persist();window.neo.flushComplete?.(true);}catch(error){toast('Save failed: '+error.message,10000);window.neo.flushComplete?.(false);}
  });
  $('#tp-title').addEventListener('input', () => { if (book?.screenplay) { book.screenplay.title=$('#tp-title').textContent.trim(); book.title=book.screenplay.title||'Untitled'; journal();scheduleMetaSave(); } });
  $('#tp-author').addEventListener('input', () => { if (book?.screenplay) { book.screenplay.writer=$('#tp-author').textContent.trim(); book.author=book.screenplay.writer; journal();scheduleMetaSave(); } });
  let editRange = null;
  let selectingWithPointer = false;
  const selectionTools = document.createElement('div');
  selectionTools.id = 'sp-selection-tools';
  selectionTools.setAttribute('role', 'toolbar');
  selectionTools.setAttribute('aria-label', 'Selected script text');
  selectionTools.hidden = true;
  document.body.append(selectionTools);
  const hideSelectionTools = () => { selectionTools.hidden = true; };
  const positionSelectionTools = range => {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return hideSelectionTools();
    selectionTools.hidden = false;
    const width = selectionTools.offsetWidth;
    const visibleLeft = $('#nav-pane').classList.contains('open') ? $('#nav-pane').getBoundingClientRect().right + 8 : 8;
    const visibleRight = $('#side-pane').classList.contains('open') ? $('#side-pane').getBoundingClientRect().left - 8 : window.innerWidth - 8;
    const left = Math.max(visibleLeft, Math.min(visibleRight - width, rect.left + rect.width / 2 - width / 2));
    const above = rect.top - selectionTools.offsetHeight - 9;
    selectionTools.style.left = `${left}px`;
    selectionTools.style.top = `${above >= 8 ? above : Math.min(window.innerHeight - selectionTools.offsetHeight - 48, rect.bottom + 9)}px`;
  };
  const rememberScriptSelection = () => {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed || currentTab !== 'manuscript') return hideSelectionTools();
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const end = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
    if (!start?.closest?.('.chapter-body') || !end?.closest?.('.chapter-body')) return hideSelectionTools();
    editRange = range.cloneRange();
    const sameScene = start.closest('.chapter-body') === end.closest('.chapter-body');
    selectionTools.querySelectorAll('[data-format]').forEach(button => {
      button.disabled = !sameScene;
      button.title = sameScene ? '' : 'Select text within one scene to format it';
    });
    if (selectingWithPointer) hideSelectionTools();
    else positionSelectionTools(range);
  };
  document.addEventListener('selectionchange', rememberScriptSelection);
  document.addEventListener('pointerdown', event => { selectingWithPointer = !!event.target.closest?.('.chapter-body'); }, true);
  document.addEventListener('pointerup', () => { if (selectingWithPointer) { selectingWithPointer = false; rememberScriptSelection(); } }, true);
  document.addEventListener('pointercancel', () => { selectingWithPointer = false; }, true);
  $('#paper-scroll').addEventListener('scroll', hideSelectionTools, {passive:true});
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideSelectionTools(); });
  const applyScriptFormatting = (command, fromPanel = false) => {
    const selection=getSelection();
    const range=(fromPanel ? editRange : selection.rangeCount && selection.getRangeAt(0))?.cloneRange();
    if(!range || (fromPanel && range.collapsed) || !range.startContainer.isConnected)return toast('Select script text first');
    const start=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer;
    const end=range.endContainer.nodeType===Node.TEXT_NODE?range.endContainer.parentElement:range.endContainer;
    const body=start?.closest?.('.chapter-body');
    if(!body || end?.closest?.('.chapter-body')!==body)return toast('Select text within one scene');
    const scroller=$('#paper-scroll'), scroll=scroller.scrollTop;
    if(!range.collapsed)recordHistory();
    body.focus({preventScroll:true});
    selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand(command,false,null))return toast('Could not apply formatting');
    editRange=selection.rangeCount && !selection.isCollapsed?selection.getRangeAt(0).cloneRange():null;
    save(body,body.closest('.chapter').dataset.id);
    scroller.scrollTop=scroll;
    requestAnimationFrame(()=>{scroller.scrollTop=scroll;});
  };
  const moveRememberedSelectionToDarlings = () => {
    const range=editRange;
    if(!range || range.collapsed || !range.startContainer.isConnected)return toast('Select script text first');
    const start=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer;
    const body=start?.closest?.('.chapter-body');
    if(!body)return toast('Select script text first');
    body.focus({preventScroll:true});
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    hideSelectionTools();
    moveSelectionToDarlings().then(()=>toggleEditPanel(false)).catch(error=>toast('Could not save Darling: '+error.message,10000));
  };
  for (const [label,command] of [['Bold','bold'],['Italic','italic'],['Underline','underline']]) {
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.format=command;
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.onclick=()=>applyScriptFormatting(command,true);
    selectionTools.append(button);
  }
  const darlingTool=document.createElement('button');darlingTool.type='button';darlingTool.textContent='Move to Darlings';
  darlingTool.addEventListener('mousedown',event=>event.preventDefault());
  darlingTool.onclick=moveRememberedSelectionToDarlings;
  selectionTools.append(darlingTool);
  for(const [id,command] of [['edit-bold','bold'],['edit-italic','italic'],['edit-underline','underline']]){
    const button=document.getElementById(id);
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.onclick=()=>applyScriptFormatting(command,true);
  }
  $('#edit-to-darlings').addEventListener('mousedown',event=>event.preventDefault());
  $('#edit-to-darlings').onclick=moveRememberedSelectionToDarlings;
  $('#edit-title-page').onclick=()=>window.openScreenplaySettings();
  $('#edit-writing-settings').onclick=()=>window.openWritingSettings();
  $('#edit-recover-unsaved').onclick=()=>recoverUnsavedCopy().catch(error=>toast('Could not recover writing: '+error.message,10000));
  $('#edit-restore-backup').onclick=()=>restoreBackupCopy().catch(error=>toast('Could not restore backup: '+error.message,10000));
  $('#edit-library-folder').onclick=()=>window.neo.openLibraryFolder().catch(error=>toast('Could not open library folder: '+error.message,10000));
  $('#edit-keyboard-settings').onclick=()=>window.openKeyboardSettings();
  const renderEditCharacters = () => {
    const select=$('#edit-character-select');if(!select)return;
    const old=select.value;select.replaceChildren(new Option('Choose a character',''));
    if(book)usedCharacters().sort((a,b)=>a.localeCompare(b,'en-GB')).forEach(name=>select.add(new Option(name,name)));
    if([...select.options].some(option=>option.value===old))select.value=old;
    $('#edit-character-name').value=select.value;
  };
  const toggleEditPanel = open => {
    const panel=$('#edit-panel');if(open && !book)return toast('Open a screenplay first');
    if(open){closeDarlingsPanel();closeScenesPanel();}
    panel.hidden=!open;$('#edit-toggle').setAttribute('aria-expanded',String(open));
    if(!open)editRange=null;
    if(open){renderEditCharacters();window.neo.spellSettings().then(settings=>{$('#edit-spell-locale').value=settings.language;}).catch(error=>toast('Spelling settings unavailable: '+error.message));}
  };
  $('#edit-toggle').addEventListener('mousedown',rememberScriptSelection);
  $('#edit-toggle').onclick=()=>toggleEditPanel($('#edit-panel').hidden);
  $('#edit-close').onclick=()=>toggleEditPanel(false);
  $('#edit-character-select').onchange=()=>{$('#edit-character-name').value=$('#edit-character-select').value;};
  const editSelectedCase = mode => {
    const range=editRange;
    if(!range || range.collapsed || !range.startContainer.isConnected)return toast('Select script text first');
    const root=(range.startContainer.nodeType===3?range.startContainer.parentElement:range.startContainer).closest('.chapter-body');
    if(!root)return toast('Select script text first');
    const walker=document.createTreeWalker($('#chapters'),NodeFilter.SHOW_TEXT),parts=[];
    let node;while((node=walker.nextNode())){
      if(!range.intersectsNode(node))continue;
      const parent=node.parentElement;
      if(!parent?.closest('.chapter-body') || parent.closest('.sp-page-gap'))continue;
      const start=node===range.startContainer?range.startOffset:0;
      const end=node===range.endContainer?range.endOffset:node.length;
      if(end>start)parts.push({node,start,end});
    }
    if(!parts.length)return toast('Select script text first');
    const original=parts.map(part=>part.node.data.slice(part.start,part.end)).join('');
    let converted=mode==='upper'?original.toLocaleUpperCase('en-GB'):original.toLocaleLowerCase('en-GB').replace(/(^|[.!?]\s+)([\s“‘"'([]*)([a-z])/g,(_,lead,opening,letter)=>lead+opening+letter.toUpperCase());
    if(mode==='sentence'){
      converted=converted.replace(/\bi\b/g,'I');
      for(const name of usedCharacters().sort((a,b)=>b.length-a.length)){
        const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        converted=converted.replace(new RegExp(`\\b${escaped}\\b`,'gi'),proseCharacterName(name));
      }
    }
    if(converted===original)return;
    recordHistory();let position=0;const changed=new Set();
    parts.forEach((part,index)=>{const length=part.end-part.start;const replacement=index===parts.length-1?converted.slice(position):converted.slice(position,position+length);part.node.data=part.node.data.slice(0,part.start)+replacement+part.node.data.slice(part.end);position+=length;changed.add(part.node.parentElement.closest('.chapter-body'));});
    changed.forEach(body=>save(body,body.closest('.chapter').dataset.id));
    editRange=null;toast(mode==='upper'?'Selected text capitalized':'Selected text changed to sentence case');
  };
  $('#edit-uppercase').onclick=()=>editSelectedCase('upper');
  $('#edit-normalize-case').onclick=()=>editSelectedCase('sentence');
  ['#edit-uppercase','#edit-normalize-case'].forEach(selector=>$(selector).addEventListener('mousedown', event=>{rememberScriptSelection();event.preventDefault();}));
  $('#edit-find-replace').onclick=()=>{toggleEditPanel(false);openSearch();};
  $('#edit-spellcheck').onclick=()=>toggleSpellcheck();
  $('#edit-flow-spellcheck').onclick=()=>startSpellReview();
  $('#edit-spell-locale').onchange=async event=>{
    try{
      const result=await window.neo.setSpellLanguage(event.target.value);
      if(!result?.ok)throw Error('Language could not be changed');
      library.spellLanguage=result.language;spellCache.clear();spellScanned=new Set();spellRanges=new Map();CSS.highlights.delete('neo-spell');
      if(spellOn)scanSpellingHere();toast(result.language==='en-GB'?'UK spelling selected':'US spelling selected');
    }catch(error){toast('Spelling language failed: '+error.message,10000);}
  };
  $('#edit-character-rename').onclick=async()=>{
    const old=$('#edit-character-select').value, next=$('#edit-character-name').value.trim().replace(/\s+/g,' ').toUpperCase();
    if(!old || !next)return toast('Choose a character and enter a new name');
    if(old===next)return;
    const cues=[...$('#chapters').querySelectorAll('[data-element="character"]')].filter(cue=>characterName(cue)===old);
    if(!cues.length)return toast('Character not found');
    const scope=await optionModal(`Rename ${old}`,`Also update ${old} wherever it appears in the script?`,[
      {label:'Rename everywhere',desc:'Updates cues and every mention in the screenplay.',value:'everywhere'},
      {label:'Rename cues only',desc:'Leaves existing references in the script unchanged.',value:'cues'}
    ]);
    if(!scope)return;
    recordHistory();const changed=new Set();
    cues.forEach(cue=>{cue.textContent=next+cue.textContent.trim().slice(old.length);changed.add(cue.closest('.chapter-body'));});
    if(scope==='everywhere'){
      const escaped=old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const mentions=new RegExp(`\\b${escaped}\\b`,'gi');
      for(const element of $('#chapters').querySelectorAll('[data-element="action"], [data-element="dialogue"], [data-element="parenthetical"], [data-element="scene-heading"], [data-element="transition"]')){
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())){
          const replacement=node.data.replace(mentions,next);
          if(replacement!==node.data){node.data=replacement;changed.add(element.closest('.chapter-body'));}
        }
      }
    }
    changed.forEach(body=>save(body,body.closest('.chapter').dataset.id));
    if(scope==='everywhere')renderNav();
    renderEditCharacters();$('#edit-character-select').value=next;$('#edit-character-name').value=next;toast(`${cues.length} cue${cues.length===1?'':'s'} renamed${scope==='everywhere'?' everywhere':''}`);
  };
  $('#edit-character-delete').onclick=async()=>{
    const name=$('#edit-character-select').value;if(!name)return toast('Choose a character first');
    const cues=[...$('#chapters').querySelectorAll('[data-element="character"]')].filter(cue=>characterName(cue)===name);
    if(!cues.length)return toast('Character not found');
    const answer=await optionModal(`Delete ${name}?`,'Their cues and dialogue will move to Darlings, where you can restore them.',[{label:'Move to Darlings and delete',value:'delete',danger:true}]);
    if(answer!=='delete')return;
    recordHistory();const changed=new Set();
    cues.forEach(cue=>{
      const body=cue.closest('.chapter-body'),id=body.closest('.chapter').dataset.id,holder=document.createElement('div'),group=[cue];
      for(let next=cue.nextElementSibling;next && ['dialogue','parenthetical'].includes(next.dataset.element);next=next.nextElementSibling)group.push(next);
      group.forEach(item=>holder.append(item.cloneNode(true)));
      darlings.unshift({id:uid('darling'),html:holder.innerHTML,text:group.map(item=>item.textContent).join('\n'),chapterId:id,chapterLabel:sceneName(id),date:new Date().toISOString()});
      group.forEach(item=>item.remove());normalise(body);changed.add(body);
    });
    changed.forEach(body=>save(body,body.closest('.chapter').dataset.id));
    await window.neo.writeJSON(book.id,'darlings',darlings);renderDarlings();renderEditCharacters();openDarlingsPanel();toast(`${name} moved to Darlings`);
  };
  openBook=async function(id){
    cancelDarlingPlacement();
    try {
      if(await window.neo.preserveRecovery(id)) toast('Unsaved writing was kept separately under File → Recover Unsaved Writing');
    } catch(error) { window.neo.logError('Could not preserve unsaved writing: '+error.message); }
    history.length=0;future.length=0;lastTypingAt=0;closePicker();
    await originalOpenBook(id); if(!book)return;
    book.screenplay={title:book.title==='Untitled'?'':book.title,writer:book.author||'',contact:'',pageSize:'A4',...(book.screenplay||{})};
    outline=await window.neo.readJSON(book.id,'screenplay-outline',[]);
    document.body.classList.add('screenplay-mode');document.body.dataset.pageSize=book.screenplay.pageSize==='letter'?'letter':'a4';
    $('#tp-title').textContent=book.screenplay.title;$('#tp-subtitle').textContent='';$('#tp-author').textContent=book.screenplay.writer;
    $$('.chapter-body').forEach(b=>{normalise(b);save(b,b.closest('.chapter').dataset.id);});renderNav();renderDarlings();
    if(!book.chapterOrder.length){const scene=createChapterAt(0);putCaret(bodyFor(scene).querySelector('[data-element="scene-heading"]'));requestAnimationFrame(()=>beginHeading(bodyFor(scene),scene));}
    renderEditCharacters();toggleEditPanel(false);window.scheduleScreenplayLayout?.();
  };
})();

// Fountain 1.1 screenplay text to ScriptWriter's scene/element model.
const SCENE = /^(?:INT\.?|EXT\.?|EST\.?|INT\.?\/?EXT\.?|EXT\.?\/?INT\.?)\s/i;
const TRANSITION = /(?:TO:|FADE OUT\.|FADE TO BLACK\.)$/i;

function parseFountain(source, fallbackTitle = 'Untitled') {
  const lines = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const metadata = {};
  let offset = 0;
  while (offset < lines.length && !lines[offset].trim()) offset++;
  if (/^(title|credit|author|authors|source|draft date|contact):/i.test(lines[offset] || '')) {
    let key = '';
    while (offset < lines.length) {
      const line = lines[offset];
      const match = line.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
      if (match) {
        key = match[1].toLowerCase();
        metadata[key] = match[2].trim();
      } else if (/^\s+\S/.test(line) && key) {
        metadata[key] += (metadata[key] ? '\n' : '') + line.trim();
      } else if (!line.trim()) {
        offset++;
        break;
      } else break;
      offset++;
    }
  }

  const chapters = [];
  let scene = null;
  let pending = [];
  let dialogue = false;
  let boneyard = false;
  const add = (type, text) => {
    if (!scene) scene = [];
    scene.push({ type, text });
  };
  const flush = () => {
    if (!pending.length) return;
    const text = pending.join('\n').trim();
    pending = [];
    if (text) add(dialogue ? 'dialogue' : 'action', text);
  };
  const startScene = (heading) => {
    flush();
    if (scene?.length) chapters.push(scene);
    scene = [{ type: 'scene-heading', text: heading }];
    dialogue = false;
  };
  for (let i = offset; i < lines.length; i++) {
    let line = lines[i];
    if (boneyard) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2);
      boneyard = false;
    }
    const start = line.indexOf('/*');
    if (start >= 0) {
      const end = line.indexOf('*/', start + 2);
      if (end < 0) {
        line = line.slice(0, start);
        boneyard = true;
      } else line = line.slice(0, start) + line.slice(end + 2);
    }
    const trimmed = line.trim();
    if (!trimmed) { flush(); dialogue = false; continue; }
    if (/^(#{1,6}\s|=\s|\[\[|={3,}$)/.test(trimmed)) { flush(); dialogue = false; continue; }
    const forcedScene = trimmed.startsWith('.') && !trimmed.startsWith('..');
    if (forcedScene || SCENE.test(trimmed)) {
      startScene((forcedScene ? trimmed.slice(1) : trimmed).replace(/\s+#\S+#\s*$/, '').trim());
      continue;
    }
    const forcedCharacter = trimmed.startsWith('@');
    const character = forcedCharacter ? trimmed.slice(1).trim() : trimmed;
    const next = (lines[i + 1] || '').trim();
    const cue = character === character.toUpperCase() && /[A-Z]/.test(character)
      && !TRANSITION.test(character) && !/^[(!~#>=]/.test(character)
      && !!next && !SCENE.test(next) && !next.startsWith('.');
    if (forcedCharacter || cue) {
      flush();
      add('character', character);
      dialogue = true;
      continue;
    }
    if (dialogue && /^\([^\n]*\)$/.test(trimmed)) {
      flush(); add('parenthetical', trimmed); continue;
    }
    if (trimmed.startsWith('>') || TRANSITION.test(trimmed)) {
      flush(); add('transition', trimmed.replace(/^>\s*/, '').replace(/\s*<$/, '')); dialogue = false; continue;
    }
    if (trimmed.startsWith('!')) { flush(); add('action', trimmed.slice(1)); dialogue = false; continue; }
    pending.push(trimmed.startsWith('~') ? trimmed.slice(1) : line.trimEnd());
  }
  flush();
  if (scene?.length) chapters.push(scene);
  if (!chapters.length) throw new Error('No screenplay text found in Fountain file');
  if (chapters[0][0].type !== 'scene-heading') chapters[0].unshift({ type: 'scene-heading', text: '' });
  return {
    title: metadata.title || fallbackTitle,
    author: metadata.author || metadata.authors || '',
    contact: metadata.contact || '',
    chapters
  };
}

module.exports = { parseFountain };

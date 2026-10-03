const assert = require('node:assert/strict');
const { parseFountain } = require('../fountain-import.cjs');

const result = parseFountain(`Title: The Signal
Author: A. Writer
Contact: writer@example.com

INT. RADIO ROOM - NIGHT

The receiver crackles.

MARA (V.O.)
(quietly)
Can you hear me?

> CUT TO:

EXT. STREET - DAY

!A SIGN reads MARA.

@McCloud
I'm here.
`, 'fallback');
assert.equal(result.title, 'The Signal');
assert.equal(result.author, 'A. Writer');
assert.equal(result.contact, 'writer@example.com');
assert.equal(result.chapters.length, 2);
assert.deepEqual(result.chapters[0].map(({ type }) => type),
  ['scene-heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition']);
assert.equal(result.chapters[1][1].text, 'A SIGN reads MARA.');
assert.equal(result.chapters[1][2].text, 'McCloud');
assert.equal(result.chapters[1][3].text, "I'm here.");
assert.equal(parseFountain('A brief opening.').chapters[0][0].type, 'scene-heading');
assert.throws(() => parseFountain('Title: Empty\n\n'), /No screenplay text/);
console.log('PASS: Fountain import parser');

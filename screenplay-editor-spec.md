# Frictionless Screenplay Editor — Build Specification

**Status:** implementation handoff. This document captures the agreed product behavior and resolves minor implementation choices so a coding agent can begin. Build a usable Windows first version and verify the writing flow end to end. This is a standalone Neo fork: maximize reuse of Neo's existing working code and replace parts only where a demonstrated blocker prevents the behavior below.

## Aim

A small standalone Windows screenplay app based on Neo's frictionless writing surface. The screenplay has professional layout while the writer types. Common work uses Enter, Tab, and Space; Shift modifies an action. Menus appear at the cursor and can be accepted without reaching for the mouse. The user can change the action modifier and individual bindings. The app ships with useful defaults, not mandatory controls.

Inspired by https://github.com/hughhowey/neo

## Screenplay format

- Feature screenplay as the initial format. A4 by default; US Letter is an available per-screenplay option.
- 12-point fixed-width Courier-style face, conventional margins, element indents, spacing, page numbers, and page breaks. The editable view should resemble the PDF.
- Elements: scene heading, action, character cue, character extension, parenthetical, dialogue, and transition. The separate title page is hidden while writing and included in PDF export. The library-card title populates it; writer credit and contact details are separate fields.
- Scene headings display as `INT. LOCATION - TIME` or `EXT. LOCATION - TIME`. The application formats punctuation and case; typed spaces are not used to fake alignment.
- Scene headings show automatically renumbered scene numbers on both sides in the editor and PDF. Locked production revisions are outside the initial target.

## The writing surface

The screenplay page owns the writing view. The Windows menu bar, header, and edge labels stay hidden while writing. Reaching the top edge reveals Library, Scenes, Tools, Outline, Darlings, PDF export, and counters; moving away hides them. The left and right edges reveal Scenes and Darlings on demand. Selecting text reveals only actions for that selection. The character selector aligns with the position where its cue will be inserted.

Selecting script text shows Bold, Italic, Underline, and Move to Darlings beside the selection. The on-demand Edit panel also holds these actions, selected-text uppercase and sentence-case tools, spell check with a UK/US English choice, find and replace, and character rename/delete. Deleting a character moves the affected cues and dialogue to Darlings. A same-character cue following an Action direction within a scene displays `(CONT'D)`.

No account, cloud dependency, setup wizard, or local server is needed to write.

## Scene heading entry

At the beginning of a new script or after the new-scene command, the editor guides three fields: **INT./EXT. → LOCATION → TIME**.

- Fixed-choice menus use Up/Down or W/S to move and Space/Enter to confirm.
- Typing `i` suggests `INT.`; Space accepts it.
- Previously used locations appear as suggestions. Typing `s` may suggest `SCHOOL HALL`; Space accepts the highlighted suggestion and advances to Time.
- When typing a new location, a single Space remains an ordinary internal space; **double Space** ends the location and advances to Time. The new location is remembered.
- Time initially suggests common choices such as DAY and NIGHT, but accepts custom text. Space or Enter accepts the highlighted suggestion and completes the heading.
- Searchable location and character menus use Up/Down for navigation; letters filter or enter text. W/S do not navigate these menus because names and locations may begin with those letters.
- Accepting the last heading field leaves the writer ready to type Action.

Example with accepted suggestions: `i Space s Space Space/Enter` can create `INT. SCHOOL HALL - NIGHT` when those options are highlighted. The actual result is always visible before the writer continues.

## Core key transitions

Repeated Enter is based on the current empty line, not a timer. Typing or moving the caret resets the sequence.

The first letter of Action, Dialogue, and Parenthetical sentences capitalizes while typing. This includes a new element and text after sentence-ending punctuation followed by a space; the stored manuscript contains the capitalized letter.

| Input | Result |
| --- | --- |
| Enter | New line in the current writing context, like a word processor. After dialogue, this is another line for the same speaker. |
| Enter, Enter | New paragraph. In dialogue, prepares a new character dialogue section; in Action, a new Action paragraph. |
| Enter, Enter, Enter | New scene, beginning at the INT./EXT. choice. |
| Tab, from anywhere in the writing surface | Open the character selector at the future cue position. Highlight a guess but do not insert it. |
| Shift+Enter while writing Dialogue | Start an Action line. |
| `(` at the start of a Dialogue line | Begin a parenthetical. No parenthetical menu is required for now. |

Character selector: Up/Down or typing filters the list. Spaces are ordinary characters within names such as `PHONE VOICE`; only Enter confirms and starts Dialogue. Shift+Enter confirms the character and opens an extension menu (for example O.S. or V.O.); Space/Enter confirms the extension and starts Dialogue. Menus never insert a guessed character without confirmation.

Character ranking: early in a scene, offer existing characters without claiming certainty. Once people have spoken in that scene, prefer scene participants. In a two-person exchange, highlight the other speaker after one speaks. The writer can still choose the same speaker or type a new one. Guessing affects only highlight order; it never changes script text automatically.

Within a character selector, only Enter confirms; Space types part of the name. In heading fields and extension menus, Enter and Space confirm the highlighted choice where appropriate. Within a written parenthetical, Enter returns to Dialogue. When a nonempty text selection spans elements, Enter replaces the selection with a new line in the current element; Tab opens the character selector, preserving the selection until a character is confirmed. If the writer cancels a menu with Escape, the text and caret return to their prior state.

All confirmed choices and structural changes are undoable with Ctrl+Z. Undo restores the prior text, caret position, and selector state where applicable. Newer typing undoes first in normal order. Ctrl+C, Ctrl+V, and Ctrl+Z keep their standard Windows defaults when the action modifier is changed. Keybinding settings flag collisions. The default action modifier is Shift; changing it to Ctrl updates app shortcuts such as Shift+Enter and Shift+Space while leaving standard Windows editing commands intact. Every app action can also have an individual override. Where a binding would collide with ordinary typing or an existing command, show the conflict and require the writer to resolve it before saving.

## Placeholders

Default shortcut: **Shift+Space** while writing. It inserts a visible placeholder marker at the caret and immediately returns to typing; the writer can add an optional note by clicking it later, then resolve or remove it. The marker must remain attached to its position as text around it changes. A list of unresolved placeholders shows their scene and nearby text and navigates to them. PDF export displays this list before proceeding; the writer may continue. Placeholder markers and notes do not print in the PDF.

## Outline

The Outline is an **independent scratchpad** of reorderable scene entries with notes. It is for trying scene order and content before committing anything to the screenplay. Moving or editing an outline entry never changes the main script; moving a main-script scene never changes the outline.

An explicit **Insert into script** action copies selected outline scenes or a whole outline into the screenplay at a chosen position, including between existing scenes. Scene headings become real scene headings; outline notes become ordinary, editable Action text in those scenes. Existing script content is never replaced by this action. The source outline remains independent after insertion.

## Darlings

The writer selects any passage, including text spanning screenplay elements, and moves it to Darlings. It leaves the script but retains its screenplay formatting. This action is available beside the selection, in Edit, and by dragging the selection to the bottom Darlings button, the right edge, or the open panel. The one Darlings panel keeps the script visible and shows every saved passage with Place in script and Delete. **Place in script** arms that Darling for placement; the writer clicks the exact spot in the visible script, where the formatted passage is inserted and removed from Darlings. Escape or Cancel leaves it in Darlings. The original position is not used for later restoration. Both moves are undoable. Darlings display a short text preview and the source scene heading for orientation.

## Library and files

The library is a simple grid of one card per screenplay, without shelves or generated covers in the first release. Each screenplay owns one folder containing its related human-readable UTF-8 files. Store the manuscript as readable HTML using semantic screenplay classes or data attributes; use formatted JSON only for supporting metadata such as title-page and page-size settings, independent outline scenes, Darlings, and any needed project data. Preserve stable IDs across manuscript elements and supporting records so outline, script, and Darlings can be edited and reordered without losing text. Retain or adapt Neo's existing file naming and layout where it suits this structure; do not rename files merely to fit this specification. There is no opaque-only database. Do not include generated PDF files in autosave backups unless the writer explicitly puts them in the project folder.

Save continuously after edits, using safe replacement so an interrupted write cannot corrupt the only copy. Make one ZIP backup per day when there are changes; retain the most recent 14 days. Backups are stored in that screenplay's `Backups` folder and exclude older backup archives. Recovery after a crash must offer the latest recoverable text without silently overwriting a good version. A restore action should extract a backup as a separate copy until the writer chooses to replace anything.

## Export

PDF is the first export format. It uses the screenplay's selected page size and title page, and should match the editor's layout and page breaks. Before export, show unresolved placeholders with scene or surrounding text; allow export to continue. Do not print placeholder UI markers.

## Out of initial scope

Generated cover art, goal charts, cloud sync, collaboration, AI writing, production revisions, locked pages, and multiple television-specific templates.

## Acceptance scenarios

1. Starting from a blank script, type a scene heading using suggestions, write Action, press Tab, choose a character, write Dialogue, and create a new scene with repeated Enter without opening a format menu.
2. Write a new multiword location using single spaces and finish it with double Space. Reuse the location later from suggestions.
3. In a two-person exchange, the character picker highlights the other speaker, but accepts the same speaker or a new character when chosen.
4. Make an incorrect character or time selection; Ctrl+Z returns to the choice without deleting the writer's work.
5. Create and reorder outline scenes without changing the script. Insert one planned scene between script scenes 6 and 7, with its notes as editable Action text.
6. Reorder main-script scenes from the left panel without changing the outline.
7. Move mixed formatted text into Darlings and later insert it at a new cursor position, retaining its formatting.
8. Insert an unresolved placeholder during typing. Export PDF after reviewing the unresolved list; the marker does not appear in the PDF.
9. Close and reopen after normal saving and a simulated crash; verify no recent content disappears. Check a daily ZIP can restore the script, outline, and Darlings.
10. Compare A4 and US Letter PDF output against the editor for pagination and element layout.

## Implementation approach

Start from Neo as a standalone fork and adapt its existing shell, editor, files, autosave, backups, panels, exports, and Windows packaging wherever they meet this specification. Replace code only after a concrete blocker is demonstrated. Routine implementation work is suitable for Luna or Terra. The fork must own its identity, library, settings, and update source while retaining Neo's license.

## Implementation order

1. Audit Neo's existing application shell, editor, file model, autosave, recovery, backups, panels, exports, and Windows packaging. Adapt the working paths that satisfy this specification before replacing anything.
2. Adapt the library and screenplay persistence to use the readable HTML manuscript and supporting JSON metadata above. Verify save and reload retain the screenplay structure, stable IDs, and writer content. Build on Neo's safe autosave and recovery behavior where suitable.
3. Adapt the paginated writing surface and screenplay elements. Implement the exact heading, Enter, Tab, selector, and undo flows above; validate them with a hands-on sample scene before adding peripheral features.
4. Add or adapt the scene list and scene reordering, independent outline with explicit insertion into the script, placeholders, and Darlings.
5. Add or adapt the title page, A4/US Letter layout, PDF export, unresolved-placeholder review, and daily ZIP backups.
6. Give the fork its own identity, library, settings, and update source while retaining Neo's license. Package a Windows app the writer can launch without using a terminal. Include a short user-facing guide to the default controls and where files are stored.

## Handoff rules

- Do not substitute generic screenplay software controls or require numeric element shortcuts. The interaction model above is the product's defining requirement.
- Build the whole first-version flow before declaring success. A static mockup or isolated key handler is insufficient.
- Verify real typing, cursor movement, selection, undo, scene reordering, persistence, backup restoration, and PDF output with an actual multi-scene script. Compare page breaks and formatting on screen and in PDF.
- Prefer adapting Neo's shell, editor, files, autosave, backups, panels, exports, and Windows packaging; replace a path only after showing it blocks the required behavior. Keep the fork standalone with its own identity, library, settings, and update source, and retain Neo's license.
- If a key transition proves technically ambiguous, implement the smallest predictable behavior consistent with these rules and document the exact choice. Do not silently discard text, auto-accept a guess, or overwrite a project.

## References

- Neo feature and interface descriptions: https://github.com/hughhowey/neo and https://github.com/hughhowey/neo/blob/main/TUTORIAL.md
- Academy screenplay formatting notes: https://www.oscars.org/nicholl/screenwriting-resources
- Final Draft feature-screenplay layout: https://www.finaldraft.com/learn/how-to-format-a-screenplay/
- Final Draft paper-size choices: https://kb.finaldraft.com/hc/en-us/articles/15575078059540-How-do-I-switch-paper-size

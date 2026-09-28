# ScriptWriter project briefing

## Working preferences

- This is a solo Windows PC project. Use Windows and PowerShell instructions; the user does not use Mac or terminal workflows.
- The user does not need a PR. Make changes in the current checkout and preserve existing work.
- Before editing, check `git status` and retain all pre-existing changes. This checkout currently contains broad uncommitted project work; do not reset, revert, or overwrite it.
- Do not launch ScriptWriter or any Electron GUI tests on this PC. Repeated Electron launches have caused a disruptive application-error popup. Code inspection and non-GUI checks/builds are okay. State clearly that live UI behavior remains unverified unless the user tests it.

## Project shape

ScriptWriter is a Windows-first Electron screenplay editor based on NEO. `main.js` owns the window, persistence, filesystem access, and IPC handlers; `preload.js` exposes the renderer API; `index.html` defines the interface; `app.js` contains the main editor and most interaction logic. Screenplay-specific editing and state live in `screenplay.js`, pagination in `screenplay-layout.js`, and screenplay styling in `screenplay.css` (shared styling is in `styles.css`).

Important entry points and references:

- `README.md`: product overview, library location, and Windows build instructions.
- `TUTORIAL.md`: user-facing keyboard and workflow guide.
- `screenplay-editor-spec.md`: product/interaction specification.
- `code-review.md`: review notes; verify whether entries still apply before acting on them.
- `tests/run.cjs`: test runner. It may launch Electron; inspect its behavior before running. Do not run GUI tests under the current popup constraint.
- `Create Windows installer and portable app.bat`: Windows x64 packaging entry point; outputs go under `dist`.
- `Open ScriptWriter with latest changes.bat`: launches the current source in Electron and therefore must not be used during coding work on this PC without the user asking.

## Recent interaction changes

The spell reviewer in `app.js` now opens a dialog before scanning, displays the flagged word in a screenplay excerpt, offers one-click replacement choices, and keeps **Stop review**, a close button, and Escape available throughout. `styles.css` contains its layout. The earlier `el is not defined` failure came from calling a helper scoped inside `screenplay.js`; the reviewer now creates its own elements. The main process waits for the selected dictionary to load before checking or suggesting words.

The Tab character flow in `screenplay.js` finishes an unfinished Action or Dialogue sentence with a full stop before opening the character picker. A likely question receives `?` when the `library.settings.questionMarkAutofill` preference is on; **File → Writing Settings…** controls it and it defaults on. Existing punctuation is preserved. The character picker prioritises the likely next speaker, and returning cues receive `(CONT'D)` until another character speaks.

## Handoff and verification

The user asked to move to a new session after this work. Review the current `git status` and the latest source before changing anything. The spelling-review redesign has only code-level verification in this session; its visual layout and click-through behaviour need the user's in-app test or a future setup that does not cause the Electron error popup. Do not claim live verification based on a successful package build.

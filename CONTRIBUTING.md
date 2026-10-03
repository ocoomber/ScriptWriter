# Working on ScriptWriter

ScriptWriter is a Windows-first screenplay editor based on NEO. It is an early development project maintained by a solo developer. Bug reports and focused fixes are welcome.

Changes should help someone write a screenplay: reliable editing, recoverable text, correct page layout, accessible controls, and accurate import or export. Keep writing controls quiet until the writer deliberately reveals them.

## Windows setup

Install Node.js, then run `npm ci` once in the project folder. Double-click **Open ScriptWriter with latest changes.bat** to run the source, or **Create Windows installer and portable app.bat** to build the Windows x64 installer and portable executable in `dist`.

Read `AGENTS.md` before changing code. `main.js` handles persistence and filesystem access; `preload.js` exposes the renderer API; `app.js` manages the library and shared editor UI. Screenplay interactions are in `screenplay.js`, physical pagination and PDF HTML in `screenplay-layout.js`, and screenplay styling in `screenplay.css`.

The library lives in `Documents\ScriptWriter Library`. Each screenplay has its own ID and folder, with metadata in `book.json` and scene text in `chapters\*.html`. Titles are display names. Never include personal screenplays, library files, generated PDFs, or local test output in a contribution.

## Verification and reports

Run `npm run test:headless` for browser and code checks without opening Electron. The browser checks currently require Google Chrome in its default Windows install location and Python with `pypdf` and `pdfplumber` for PDF text inspection (`python -m pip install pypdf pdfplumber`). `SCRIPTWRITER_PDF_PYTHON` can select a different Python executable. `npm test` opens Electron for the desktop regression suite; respect the local launch restriction in `AGENTS.md` and do not run it on a machine affected by the application-error popup without permission.

Describe the writer-visible problem and the checks you actually ran. A successful build does not establish that desktop dialogs, printing, or interactions work. Bug reports should include the Windows version, ScriptWriter version, reproduction steps, and the relevant error from `Documents\ScriptWriter Library\neo-errors.log` if available. Remove private screenplay text before sharing logs.

Keep the MIT license and upstream NEO attribution intact.

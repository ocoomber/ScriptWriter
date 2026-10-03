# ScriptWriter

ScriptWriter is an early Windows desktop screenplay editor built from the open-source [NEO](https://github.com/hughhowey/neo) writing app. It keeps the writing area quiet while adding screenplay elements, numbered scene headings, a separate title page, an independent outline, Darlings, and PDF export.

This is a development build. Automated checks cover basic typing, Outline, Darlings, and PDF flows; printed page breaks and margins still need broader comparison before relying on a PDF for submission.

## Use ScriptWriter

Open the Windows installer or portable executable when one is provided. The library is stored in your Windows Documents folder under `ScriptWriter Library`. In the editor, move the pointer to the top edge, then choose **Tools → Open library folder** to open its exact location in Explorer, including if Documents is redirected to OneDrive.

Each screenplay has its own folder. The manuscript is readable HTML, with supporting screenplay data in JSON. ScriptWriter saves as you write and keeps up to 14 daily ZIP backups in each screenplay's `Backups` folder. Use **Tools → Restore backup as copy** to recover a separate screenplay without replacing the current one.

To bring in a Fountain screenplay, use **Import screenplay** on the library screen and choose a `.fountain` file. ScriptWriter creates a separate editable screenplay with scene headings, action, character cues, parentheticals, dialogue, transitions, and title-page title, writer, and contact details. Duplicate imported titles get a numbered suffix, ignoring capitalisation. Fountain notes, sections, synopses, and production features are not imported.

Use the **⋯** button on a screenplay card, or right-click the card, to rename it or move it to the Windows Recycle Bin after confirmation.

For keyboard controls and the current development limits, see [TUTORIAL.md](TUTORIAL.md).

## Double-click files on Windows

| File | What it does |
| --- | --- |
| **Open ScriptWriter with latest changes.bat** | Opens the current source, including your newest edits. On first use, it installs the required tools. It does not create an installer or open an older packaged copy. |
| **Create Windows installer and portable app.bat** | Builds the Windows x64 installer and portable app in `dist`. It installs build tools if needed and replaces older generated ScriptWriter executables in that folder. It does not open ScriptWriter. |
| **pocket/android/gradlew.bat** | Standard Gradle wrapper for the Android companion project. Android build tools use it; it does not open the Windows editor. |

The two files in the repository root require Node.js. For everyday testing of changes, double-click **Open ScriptWriter with latest changes.bat**. Create a Windows installer only when you want a standalone copy. After building, the packaged app is `dist\win-unpacked\ScriptWriter.exe`; the installer and portable executable are also in `dist`.

ScriptWriter's GitHub Actions build is manual and Windows-only. It creates a downloadable build artifact; it does not publish a release automatically.

## Source and license

ScriptWriter retains the upstream NEO MIT license. The fork is based on NEO commit `9d8ba5adbfdaa4d7c1d02a702274d47ae0b46812`; see [LICENSE](LICENSE) for license terms.

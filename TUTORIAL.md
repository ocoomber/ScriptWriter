# ScriptWriter quick guide

ScriptWriter is an early Windows build for writing feature screenplays. It saves to your PC and does not need an account or an internet connection.

The screenplay page is the writing view. Move the pointer to the bottom edge when you want the work controls; they hide again when you return to the page. The left and right edges reveal Scenes and Darlings. Selecting script text reveals only actions for that selection.

## Start a screenplay

From the library, select the **+** card. A blank screenplay opens with the scene-heading prompt ready. Follow the prompt to choose **INT.** or **EXT.**, enter a location, then choose or type a time. The heading appears in the script before you continue writing.

The title page stays out of the writing view. Reveal the bottom controls and choose **Tools → Title page & paper size** to set the title, writer credit, contact details, and A4 or US Letter paper size. It appears in the exported PDF.

## Write with the keyboard

- Press **Tab** anywhere in the script to open the character selector at the position of the next character cue. The likely next speaker is highlighted, so **Tab**, then **Enter**, starts their dialogue. Type a name, including spaces, to choose someone else.
- In the scene-heading and character menus, use **Up** and **Down** to move through choices. **Enter** accepts the highlighted choice; **Space** remains part of a character name.
- When entering a new location, use single spaces between words and double-space to finish it. A suggested location can be accepted with Space.
- **Enter** continues in the current element. Press **Shift+Enter** in Dialogue to begin an Action line.
- When the same character speaks again before anyone else, their new cue gets **(CONT'D)** automatically.
- The first letter of an Action or Dialogue sentence, a standalone **I**, and known character names capitalise as you type.
- Pressing **Tab** at the end of an unfinished Action or Dialogue sentence adds a full stop. Likely questions get a question mark instead; turn this off under **Tools → Writing settings**. Punctuation you type yourself is kept.
- Type **(** at the start of a Dialogue line to make it a Parenthetical.
- **Shift+Space** adds a visible placeholder while you keep writing. Review unresolved placeholders when exporting a PDF; their markers do not print.
- **Ctrl+Z** and **Ctrl+Y** undo and redo. Windows editing shortcuts such as **Ctrl+C**, **Ctrl+V**, and **Ctrl+Z** keep their normal meanings.

**Tools → Keyboard settings** holds optional shortcuts. The defaults include **Ctrl+Shift+Enter** for a new scene, **Ctrl+Shift+D** for moving a selection to Darlings, **Ctrl+Shift+O** for Outline, and **Ctrl+Shift+P** for PDF export.

Select script text to show Bold, Italic, Underline, and Move to Darlings beside the selection. Reveal the bottom controls and choose **Tools** for case changes, spell check, UK/US spelling, find and replace, character management, title page setup, writing settings, and project recovery. Bold, Italic, and Underline also use **Ctrl+B**, **Ctrl+I**, and **Ctrl+U**. **Review flagged words** shows each flagged word in its sentence. Click a suggestion, or edit the highlighted word and press Enter or **Replace with typed word**. **Skip and continue** moves to the next occurrence without changing this one; **Add to dictionary** accepts the word in future checks. **Stop review**, the close button, and **Escape** leave the review. Renaming a character offers to update both cues and mentions throughout the screenplay. Deleting a character moves their cues and dialogue to Darlings so they can be restored.

## Scenes, Outline, and Darlings

Move to the left edge for the scene list, or reveal the bottom controls and choose **Scenes**. Select a scene to jump to it; drag scenes to reorder them, or drag the panel edge to change its width. The number beside each scene is its word count. Move to the right edge for Darlings, or reveal the bottom controls and choose **Darlings**. Drag selected script text to the right edge, the open panel, or the Darlings button to save it. The same panel shows **Place in script** and **Delete** for each Darling. Choose **Place in script**, then click the exact spot in the visible script where it should go. Press Escape or **Cancel** to leave placement without changing the script.

Reveal the bottom controls and choose **Outline** to open a separate planning workspace. Add outline scenes, edit their headings and notes, and use the arrows to reorder them. **Insert into script** copies an outline scene into the screenplay; editing or reordering the outline does not rearrange the main script.

## Save, recover, and export

Your library is in the Windows Documents folder under `ScriptWriter Library`; choose **Tools → Open library folder** to open it in Explorer. Each screenplay folder contains a readable HTML manuscript and JSON support files. ScriptWriter saves continuously and keeps up to 14 daily ZIP backups in that screenplay's `Backups` folder. It opens your saved screenplay directly; if a genuinely different unsaved draft exists, it preserves that draft separately. Choose **Tools → Recover unsaved writing as copy** to open it later, or **Tools → Restore backup as copy** for a daily backup. Both actions keep your current screenplay unchanged.

Reveal the bottom controls and choose **Save PDF** to create a PDF. A4 is the default; US Letter can be selected in **Tools → Title page & paper size**. The editor and PDF export share an early pagination layout. Printed page breaks and margins still need broader comparison, so check the result before sending it as a submission copy.

## Development build limits

ScriptWriter is focused on the screenplay workflow. It does not include generated cover art, word-goal charts, cloud sync, or AI writing features. Some underlying NEO features are not part of this first ScriptWriter flow. The complete writing workflow is still being developed.

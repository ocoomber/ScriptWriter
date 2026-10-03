# Security notes

ScriptWriter is an early development desktop app. Screenplay and library files remain on the local computer. Please omit personal screenplay content and credentials from public bug reports.

## Dependency review, 3 October 2026

`npm audit --omit=dev` reported no production dependency vulnerabilities after updating the lockfile. The full audit still reports eight high-severity dependency entries arising from one unpatched advisory in the Windows packaging download chain: [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), affecting `http-cache-semantics` through `electron-builder` and `@electron/get`.

The advisory concerns response headers in a shared HTTP cache. These packages are development/build dependencies, not dependencies shipped with the editor. The Windows packaging script uses the locally installed Electron distribution. Build on a private machine with a private cache; review the advisory again when an upstream fix is released. Do not use `npm audit fix --force` to apply the suggested builder downgrade without checking packaging compatibility.

// Package from a clean copy of the app files. Electron/Windows spelling can
// leave temporary directories in the checkout that electron-builder cannot
// enumerate reliably. Source files in the original checkout are untouched.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const stage = path.join(root, '.build-stage');
const output = path.join(root, 'dist');
const stageOutput = path.join(stage, 'dist');
const files = [
  'package.json', 'package-lock.json', 'main.js', 'fountain-import.cjs', 'recovery-state.cjs', 'preload.js', 'index.html',
  'app.js', 'screenplay.js', 'screenplay-layout.js', 'styles.css',
  'screenplay.css', 'covers.js', 'art.js', 'fonts', 'build'
];

if (path.dirname(stage) !== root) throw new Error('Build stage must be inside the project');
// Discard only this generated staging folder so removed dependencies cannot
// linger from a previous package. Never follow a redirected staging path.
if (fs.existsSync(stage)) {
  if (fs.lstatSync(stage).isSymbolicLink() || fs.realpathSync(stage) !== stage) {
    throw new Error('Build stage must be a real directory inside the project');
  }
  fs.rmSync(stage, { recursive: true, force: true });
}
fs.mkdirSync(stage, { recursive: true });
for (const name of files) {
  fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true, force: true });
}
fs.cpSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true, force: true });

const stagedPackage = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
stagedPackage.build.electronDist = 'node_modules/electron/dist';
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagedPackage, null, 2) + '\n');

const builder = path.join(stage, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const result = spawnSync(process.execPath, [builder, '--win', '--publish', 'never'], {
  cwd: stage, env: process.env, stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

fs.mkdirSync(output, { recursive: true });
for (const name of [`ScriptWriter Setup ${stagedPackage.version}.exe`, `ScriptWriter ${stagedPackage.version}.exe`]) {
  fs.copyFileSync(path.join(stageOutput, name), path.join(output, name));
}
fs.cpSync(path.join(stageOutput, 'win-unpacked'), path.join(output, 'win-unpacked'), { recursive: true, force: true });
// Keep dist focused on the current build. These are generated executables;
// project files and anything with a different name are left alone.
const currentPackages = new Set([
  `ScriptWriter Setup ${stagedPackage.version}.exe`,
  `ScriptWriter ${stagedPackage.version}.exe`
]);
for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
  if (!entry.isFile() || currentPackages.has(entry.name)) continue;
  if (/^ScriptWriter(?: Setup)? \d+\.\d+\.\d+\.exe$/.test(entry.name)) {
    fs.unlinkSync(path.join(output, entry.name));
  }
}
console.log(`Windows installer and portable app ready in ${output}`);

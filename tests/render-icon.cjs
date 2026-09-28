const path=require('node:path');
let pw;try{pw=require('playwright')}catch{pw=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const root=path.resolve(__dirname,'..');
const library=path.join(root,'.test-output','icon-render-library');
const env={...process.env,SCRIPTWRITER_LIBRARY:library};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{const app=await pw._electron.launch({executablePath:require('electron'),args:[root],cwd:root,env});try{
 const page=await app.firstWindow();await page.goto('file:///'+path.join(root,'build','scriptwriter-icon.svg').replace(/\\/g,'/'));
 await page.locator('svg').screenshot({path:path.join(root,'build','scriptwriter-icon.png')});
 console.log('Wrote build/scriptwriter-icon.png');
}finally{await app.evaluate(({app})=>app.exit(0))}})().catch(e=>{console.error(e);process.exitCode=1});

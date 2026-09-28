const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const pw = require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.test-output',`edges-${Date.now()}`);
fs.mkdirSync(output,{recursive:true});const env={...process.env,SCRIPTWRITER_LIBRARY:path.join(output,'library')};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
(async()=>{
app=await pw._electron.launch({executablePath:require('electron'),args:[root],cwd:root,env});page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
await page.waitForSelector('.new-book');
await page.evaluate(async()=>{
  const meta=await window.neo.createBook({title:'Edge Cases',author:'Tester'});
  meta.chapterOrder=['scene-one','scene-two'];
  await window.neo.writeBookMeta(meta.id,meta);
  await window.neo.writeChapter(meta.id,'scene-one','<p data-element="scene-heading" data-id="heading-one">INT. ROOM - DAY</p><p data-element="action" data-id="action-one">Alpha Bravo</p>');
  await window.neo.writeChapter(meta.id,'scene-two','<p data-element="scene-heading" data-id="heading-two">EXT. ROAD - NIGHT</p><p data-element="action" data-id="action-two">Charlie Delta</p>');
  library.shelves[0].bookIds.push(meta.id);await window.neo.writeLibrary(library);await openBook(meta.id);
});
await page.evaluate(()=>{
 const first=document.querySelector('[data-id="action-one"]').firstChild,last=document.querySelector('[data-id="action-two"]').firstChild;
 const range=document.createRange();range.setStart(first,6);range.setEnd(last,7);
 first.parentElement.closest('.chapter-body').focus();getSelection().removeAllRanges();getSelection().addRange(range);
});
await page.keyboard.press('Control+Shift+d');await page.waitForFunction(()=>darlings.length===1);
const state=await page.evaluate(()=>({first:document.querySelector('[data-id="action-one"]')?.textContent,second:document.querySelector('[data-id="action-two"]')?.textContent,html:darlings[0].html,order:book.chapterOrder}));
assert.equal(state.first,'Alpha ');assert.equal(state.second,' Delta');assert.deepEqual(state.order,['scene-one','scene-two']);assert(state.html.includes('Bravo')&&state.html.includes('Charlie'));
console.log('PASS: cross-scene Darlings move keeps two scene shells and retains selected text');

await page.evaluate(()=>window.openKeyboardSettings());
await page.locator('.modal select').selectOption('Ctrl');
await page.locator('.modal').getByRole('button',{name:'Save'}).click();
assert.equal(await page.evaluate(()=>library.actionModifier),'Ctrl');
await page.evaluate(()=>{
 const p=document.querySelector('[data-id="action-two"]');p.closest('.chapter-body').focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);
});
await page.keyboard.press('Control+Space');
assert.equal(await page.locator('.chapter-body .ph-mark').count(),1);
await page.keyboard.press('Control+z');
assert.equal(await page.locator('.chapter-body .ph-mark').count(),0);
console.log('PASS: action modifier changes placeholder key and Ctrl+Z remains undo');

await page.evaluate(()=>{
 const first=document.querySelector('[data-id="action-one"]').firstChild,last=document.querySelector('[data-id="action-two"]').firstChild;
 const r=document.createRange();r.setStart(first,3);r.setEnd(last,2);first.parentElement.closest('.chapter-body').focus();getSelection().removeAllRanges();getSelection().addRange(r);
});
await page.keyboard.press('Enter');
assert.equal(await page.locator('.chapter-body').count(),2);
assert.equal(await page.locator('[data-id="action-one"]').innerText(),'Alpha ');
assert.equal(await page.locator('[data-id="action-two"]').innerText(),' Delta');
assert.deepEqual(errors,[]);console.log('PASS: cross-scene Enter leaves both scenes intact');
await app.close();app=null;
console.log(`Artifacts: ${output}`);
})().catch(async e=>{console.error(e);if(page)try{await page.screenshot({path:path.join(output,'failure.png'),animations:'disabled'})}catch{};process.exitCode=1}).finally(async()=>{if(app)await app.close()});

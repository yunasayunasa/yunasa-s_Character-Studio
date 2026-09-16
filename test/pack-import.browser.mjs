import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default { name: 'user-pack-import-update', viewport: { width: 591, height: 1100 }, async run({ page, baseUrl, check }) {
  const out = '../pack-import-evidence';
  await mkdir(out, { recursive: true });
  if (process.env.REPRO_LOADER) {
    const body = await readFile(process.env.REPRO_LOADER, 'utf8');
    await page.route('**/src/engine/character-loader.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
  }
  // Isolate each reload from SW installation; SW release version has a separate test.
  await page.addInitScript(() => { navigator.serviceWorker.register = async () => ({}); });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('表示しています'));
  await page.setInputFiles('#pack-files', resolve('release/silver-scholar-hybrid-pack.zip'));
  await page.waitForFunction(() => document.querySelector('#character-select').value === 'silver-scholar-hybrid' && document.querySelector('#status').textContent.includes('保存しました'));
  const inspect = () => page.evaluate(async () => {
    const { loadStoredPack, listStoredPacks } = await import('./src/engine/pack-store.js');
    const stored = (await listStoredPacks()).find(x => x.id === 'silver-scholar-hybrid');
    const pack = await loadStoredPack(stored.id);
    const image = pack.svg.querySelector('image');
    const shown = [...document.querySelectorAll('#character-host canvas')].map(c => {
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      let body = 0;
      for (let y = Math.floor(c.height * .5); y < c.height; y++) for (let x = 0; x < c.width; x++) if (pixels[(y * c.width + x) * 4 + 3]) body++;
      return body;
    });
    return { rawRaster: /data:image\/jpeg;base64,/.test(stored.svgText), resolvedRaster: !!image?.getAttribute('href'), visibleBody: shown.reduce((a,b) => a+b,0), face: pack.svg.querySelectorAll('path').length, files: stored.sourceFiles.length };
  });
  const report = { imported: await inspect() };
  await page.screenshot({ path: `${out}/${process.env.REPRO_LOADER ? 'before' : 'after'}-import.png` });
  await writeFile(`${out}/${process.env.REPRO_LOADER ? 'before' : 'after'}.json`, JSON.stringify(report, null, 2));
  await check('distributed ZIP through real UI retains rendered Raster body and SVG face', () => {
    assert(report.imported.rawRaster); assert(report.imported.resolvedRaster); assert(report.imported.visibleBody > 10000); assert(report.imported.face > 0);
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('表示しています'));
  await page.selectOption('#character-select', 'silver-scholar-hybrid');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('銀髪メガネ') && document.querySelector('#status').textContent.includes('表示しています'));
  report.reloaded = await inspect();
  await check('IndexedDB reload retains body and face', () => { assert(report.reloaded.resolvedRaster); assert(report.reloaded.visibleBody > 10000); });
  await page.setInputFiles('#pack-files', resolve('release/silver-scholar-hybrid-pack.zip'));
  await check('same ID requires update confirmation', async () => { await page.locator('#pack-update-dialog[open]').waitFor({ timeout: 3000 }); });
  await page.click('#pack-update-cancel');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('キャンセル'));
  await page.setInputFiles('#pack-files', resolve('release/silver-scholar-hybrid-pack.zip'));
  await page.locator('#pack-update-dialog[open]').waitFor();
  await page.click('#pack-update-confirm');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('保存しました'));
  await check('distributed Hybrid ZIP update retains body and face', async()=>{ const result=await inspect(); assert(result.resolvedRaster); assert(result.visibleBody>10000); assert(result.face>0); });
  const upload = async (id, color, second = false, oldAsset = false, legacy = false) => {
    const bytes = await page.evaluate(async ({id, color, second, oldAsset, legacy}) => {
      const {createStoredZip} = await import('./src/export/zip-store.js');
      const c = document.createElement('canvas'); c.width = c.height = 1;
      c.getContext('2d').fillStyle = color; c.getContext('2d').fillRect(0,0,1,1);
      const schemaVersion = legacy ? 1 : 2;
      const config = {schemaVersion, id, label:'同名テスト', files:{svg:'character.svg',expressions:'expressions.json',motions:'motions.json',poses:'poses.json'}, canvas:{width:100,height:100},requiredParts:['master_normal'],effectParts:[],partSlots:{mouth:['mouth']},controllers:{},psdLayers:[]};
      if (!legacy) config.assetModel = {defaultMaster:'normal',masters:{normal:{root:'master_normal'},...(second?{second:{root:'master_second'}}:{})},sharedParts:{mouth:['mouth']},masterOverrides:{}};
      const image = `<image width="100" height="100" href="${c.toDataURL()}"/>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="master_normal" data-export-part="master_normal">${image}</g>${second?`<g id="master_second" data-export-part="master_second">${image}</g>`:''}<g id="mouth" data-export-part="mouth"><path d="M40 30h20v5H40Z" fill="black"/></g></svg>`;
      const files = [{name:'character.json',data:JSON.stringify(config)}, {name:'character.svg',data:svg}, {name:'expressions.json',data:JSON.stringify({schemaVersion,default:'neutral',expressions:{neutral:{parts:{mouth:'mouth'}}}})}, {name:'motions.json',data:JSON.stringify({schemaVersion,default:'still',motions:{still:{tracks:[]}}})}, {name:'poses.json',data:JSON.stringify({schemaVersion,default:'normal',poses:{normal:{master:'normal'},...(second?{second:{master:'second'}}:{})}})}];
      if (oldAsset) files.push({name:'old-only.bin',data:new Uint8Array([1,2,3])});
      return [...createStoredZip(files)];
    }, {id,color,second,oldAsset,legacy});
    await page.setInputFiles('#pack-files', {name:`${id}.zip`,mimeType:'application/zip',buffer:Buffer.from(bytes)});
  };
  const records = () => page.evaluate(async () => (await import('./src/engine/pack-store.js')).listStoredPacks());
  const saved = id => records().then(items => items.find(x=>x.id===id));
  const waitSaved = () => page.waitForFunction(() => document.querySelector('#status').textContent.includes('保存しました'));
  const pixel = () => page.evaluate(() => {
    const c = [...document.querySelectorAll('#character-host canvas')].find(c => c.width > 50 && c.height > 50);
    return [...c.getContext('2d',{willReadFrequently:true}).getImageData(Math.floor(c.width*.5),Math.floor(c.height*.75),1,1).data];
  });
  await check('TEST 1: new stable ID registers once', async () => { await upload('update-fixture','#ff0000',false,true); await waitSaved(); assert.equal((await records()).filter(x=>x.id==='update-fixture').length,1); });
  const original = await saved('update-fixture');
  await upload('update-fixture','#0000ff',true);
  await check('TEST 2: same ID is an update candidate, not a write', async () => { await page.locator('#pack-update-dialog[open]').waitFor(); assert.deepEqual(await saved('update-fixture'),original); });
  await page.screenshot({path:`${out}/update-confirmation.png`});
  await check('TEST 3: cancel leaves every stored byte unchanged', async () => { await page.click('#pack-update-cancel'); await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('キャンセル')); assert.deepEqual(await saved('update-fixture'),original); });
  await upload('update-fixture','#0000ff',true);
  await page.locator('#pack-update-dialog[open]').waitFor();
  await page.click('#pack-update-confirm'); await waitSaved();
  const updated = await saved('update-fixture');
  await check('TEST 4: update replaces record without duplicate', async () => { assert.notEqual(updated.svgText,original.svgText); assert.equal((await records()).filter(x=>x.id==='update-fixture').length,1); });
  await check('TEST 5: update adds the second Master', () => assert.deepEqual(Object.keys(updated.config.assetModel.masters),['normal','second']));
  await check('TEST 6: old-only assets are removed from both asset collections', () => { assert(!updated.sourceFiles.some(x=>x.path==='old-only.bin')); assert(!updated.auxiliaryFiles.some(x=>x.path==='old-only.bin')); });
  await check('TEST 8/9: updated Raster pixels and SVG face both render', async () => {
    assert.deepEqual(await pixel(),[0,0,255,255]);
    const facePixels = await page.evaluate(()=>[...document.querySelectorAll('#character-host canvas')].reduce((sum,c)=>{const p=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<p.length;i+=4)if(p[i]===0&&p[i+1]===0&&p[i+2]===0&&p[i+3]===255)count++;return sum+count;},0));
    assert(facePixels>0);
  });
  await page.reload(); await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('表示しています'));
  await page.selectOption('#character-select','update-fixture');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('同名テスト')&&document.querySelector('#status').textContent.includes('表示しています'));
  await check('TEST 7: replacement and new Raster survive reload', async () => { assert.deepEqual(await saved('update-fixture'),updated); assert.deepEqual(await pixel(),[0,0,255,255]); });
  await check('TEST 10: Legacy Pack without characterId imports using existing id', async () => { await upload('legacy-fixture','#00ff00',false,false,true); await waitSaved(); assert.equal((await saved('legacy-fixture')).config.schemaVersion,1); });
  await check('TEST 11: same label with another ID is a separate character', async () => { await upload('different-fixture','#00ff00'); await waitSaved(); assert.equal((await records()).filter(x=>x.label==='同名テスト').length,3); });
  await check('sanitizer keeps only valid embedded bitmap references', async () => {
    const safe=await page.evaluate(async()=>{const{parseSafeSvg}=await import('./src/engine/character-loader.js');const c=document.createElement('canvas');c.width=c.height=1;const svg=parseSafeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image id="ok" href="${c.toDataURL()}"/><image id="remote" href="https://example.com/a.png"/><image id="bad" href="data:image/svg+xml;base64,PHN2Zy8+"/><image id="invalid" href="data:image/png;base64,AAAA"/></svg>`);return [...svg.querySelectorAll('image')].map(n=>!!n.getAttribute('href'));});assert.deepEqual(safe,[true,false,false,false]);
  });
  await check('TEST 12: existing Red Oni Hybrid ZIP still imports with all Masters', async () => {
    await page.setInputFiles('#pack-files',resolve('release/red-oni-hybrid-pack.zip')); await waitSaved();
    const item = (await records()).find(x=>x.id==='red-oni-hybrid'); assert(item); assert.equal(Object.keys(item.config.assetModel.masters).length,3);
  });
  report.update = {tests:'1-12', masters:Object.keys(updated.config.assetModel.masters),oldOnlyRemoved:true};
  await writeFile(`${out}/after.json`, JSON.stringify(report, null, 2));
} };

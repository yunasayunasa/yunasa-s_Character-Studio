import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default { name:'pack-release-cache-and-full-svg',viewport:{width:591,height:1100},async run({page,baseUrl,check}) {
  // The shared smoke harness blocks SW. Enable it only for this release test.
  const context=await page.context().browser().newContext({serviceWorkers:'allow',viewport:{width:591,height:1100}});
  page=await context.newPage();
  try {
  await page.goto(`${baseUrl}test/deployment-smoke.html`);
  await check('new SW release evicts stale pre-Hybrid app modules',async()=>{
    await page.evaluate(async()=>{
      const old=await caches.open('svg-character-studio-v2.0.4');
      await old.put(new URL('../src/engine/character-loader.js',location.href),new Response('export const staleLoader=true;'));
      const registration=await navigator.serviceWorker.register('../sw.js',{scope:'../'});
      await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`SW not ready: ${registration.installing?.state}`)),20000))]);
    });
    await page.waitForFunction(async()=>!(await caches.keys()).includes('svg-character-studio-v2.0.4'),{},{timeout:60000});
    const versions=await page.evaluate(()=>caches.keys());assert(versions.includes('svg-character-studio-v2.0.5'));
  });
  await page.goto(baseUrl);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('表示しています'));
  await page.setInputFiles('#pack-files',resolve('release/red-oni-warrior-character-pack.zip'));
  await page.waitForFunction(()=>document.querySelector('#character-select').value==='red-oni-warrior'&&document.querySelector('#status').textContent.includes('保存しました'),{},{timeout:60000});
  const probe=()=>page.evaluate(()=>[...document.querySelectorAll('#character-host canvas')].reduce((n,c)=>{const p=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data;for(let i=3;i<p.length;i+=4)if(p[i])n++;return n;},0));
  await check('existing Full-SVG ZIP renders through normal UI and raster cache',async()=>assert(await probe()>10000));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('表示しています'));
  await page.selectOption('#character-select','red-oni-warrior');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('赤髪の鬼武者')&&document.querySelector('#status').textContent.includes('表示しています'),{},{timeout:60000});
  await check('Full-SVG saved Pack renders after reload under new SW',async()=>assert(await probe()>10000));
  } finally { await context.close(); }
} };

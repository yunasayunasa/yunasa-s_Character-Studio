import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {encodeGif} from '../src/export/gif-encoder.js';
const sharp=createRequire(import.meta.url)('C:/Users/guestuser/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
test('GIF decodes across LZW code-width growth and dictionary resets with real transparency',async()=>{
 const width=256,height=128,data=new Uint8Array(width*height*4);let seed=12345;
 for(let i=0;i<data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed&255;data[i+1]=(seed>>>8)&255;data[i+2]=(seed>>>16)&255;data[i+3]=i%20?255:0;}
 const bytes=Buffer.from(encodeGif([{data,width,height},{data,width,height}],width,height));
 const meta=await sharp(bytes,{animated:true}).metadata();assert.equal(meta.pages,2);
 const decoded=await sharp(bytes).ensureAlpha().raw().toBuffer();assert.equal(decoded.length,data.length);
 for(let i=3;i<data.length;i+=4)assert.equal(decoded[i],data[i]);
});

// Actual React component + standard Chromium fullscreen; synthetic local media.
// No account, backend, iOS native-player, or physical-device claim.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { realpath } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5219';
const fixture = `import React, {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SelectedClipPreview} from '/src/components/caddie/SelectedClipPreview';
import {LocaleProvider} from '/src/i18n/LocaleContext';
const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180;
const ctx=canvas.getContext('2d'); const stream=canvas.captureStream(20);
const recorder=new MediaRecorder(stream,{mimeType:'video/webm'}); const chunks=[];
recorder.ondataavailable=e=>chunks.push(e.data);
const done=new Promise(r=>recorder.onstop=r); recorder.start();
const timer=setInterval(()=>{ctx.fillStyle='green';ctx.fillRect(0,0,320,180);},40);
await new Promise(r=>setTimeout(r,1200)); recorder.stop(); await done;
clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
function Fixture(){const ref=useRef(null); const [show,setShow]=useState(true); window.removeClip=()=>setShow(false); return React.createElement(LocaleProvider,null,show&&React.createElement(SelectedClipPreview,{previewUrl:url,trimStart:0,trimEnd:1,videoRef:ref}))}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Fixture)));`;
const server=await createServer({server:{host:'127.0.0.1',port:5219,strictPort:true,fs:{allow:[process.cwd(),await realpath('node_modules')]}},plugins:[{name:'clip-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/clip-fixture'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/clip-fixture','<div id="root"></div><script type="module" src="/clip-fixture.tsx"></script>'));}else next();});},resolveId(id){if(id==='/clip-fixture.tsx')return '\0clip-fixture.tsx';},load(id){if(id==='\0clip-fixture.tsx')return fixture;}}]});
await server.listen();let browser;let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label); checks++;};
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const page=await browser.newPage(); page.setDefaultTimeout(10000); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin+'/clip-fixture'); await page.locator('video').waitFor();
 await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 await page.waitForTimeout(100);
 const expand=page.getByRole('button',{name:/full.?screen/i});
 const state=()=>page.locator('video').evaluate(v=>({controls:v.controls,full:document.fullscreenElement===v,paused:v.paused}));
 eq((await state()).controls,false,'inline controls hidden');
 await expand.click();await page.waitForFunction(()=>!!document.fullscreenElement);
 eq(await state(),{controls:true,full:true,paused:true},'paused fullscreen remains operable');
 await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement && !document.querySelector('video').controls);
 eq((await state()).controls,false,'exit restores compact controls');
 await page.getByRole('button',{name:/play/i}).click();await expand.click();
 await page.waitForFunction(()=>!!document.fullscreenElement);
 eq((await state()).controls,true,'playing fullscreen controls');
 await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement && !document.querySelector('video').controls);
 await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.requestFullscreen=()=>Promise.reject(new Error('synthetic denied'));});
 await expand.click();await page.waitForTimeout(50);
 eq((await state()).controls,false,'rejected request keeps inline controls');
 await page.evaluate(()=>{delete document.querySelector('video').requestFullscreen;});
 await expand.click();await page.waitForFunction(()=>!!document.fullscreenElement);
 await page.evaluate(()=>{window.oldVideo=document.querySelector('video');window.removeClip();});
 await page.waitForFunction(()=>!document.querySelector('video'));
 eq(await page.evaluate(()=>window.oldVideo.controls),false,'unmount clears native controls');
 eq(errors,[],'no runtime errors');console.log(JSON.stringify({checks,result:'passed'}));
}finally{await browser?.close();await server.close();}

// Synthetic media only. No production data, accounts or requests.
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const file="/tmp/golfme-autoplay-fixture.mp4";
execFileSync("ffmpeg",["-y","-f","lavfi","-i","testsrc2=size=320x400:rate=24","-t","4","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",file],{stdio:"ignore"});
const server=await createServer({server:{host:"127.0.0.1",port:4189,fs:{allow:[process.cwd(),realpathSync("node_modules")]}},plugins:[{name:"fixture",configureServer(s){s.middlewares.use(async (req,res,next)=>{
 if(req.url?.split("?")[0]==="/fixture-video.mp4"){res.setHeader("Content-Type","video/mp4");res.end(readFileSync(file));return;}
 if(req.url==="/autoplay-test"){res.setHeader("Content-Type","text/html");res.end(await s.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/scripts/feed-autoplay-fixture.tsx"></script>'));return;} next();
})}}]});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/tmp/golfme-community-browsers/chromium-1234/chrome-linux64/chrome",headless:true,args:["--no-sandbox"]});
try {
 for(const width of [390,1100]) {
 const page=await browser.newPage({viewport:{width,height:844}}); page.setDefaultTimeout(15000); const errors=[];page.on("pageerror",e=>{ errors.push(e.message); console.error(e.message); });
 await page.route("**/*",r=>r.request().url().startsWith("http://127.0.0.1:4189/")||r.request().url().startsWith("data:")?r.continue():r.abort());
 console.log("starting",width); await page.goto("http://127.0.0.1:4189/autoplay-test");
 await page.waitForFunction(()=>{const v=document.querySelector("#first video");return v&&!v.paused&&v.currentTime>0;});
 assert.equal(await page.locator("#first video").first().evaluate(v=>v.muted),true);
 assert.equal(await page.locator("video").evaluateAll(v=>v.filter(x=>!x.paused).length),1);
 await page.locator("#first button[aria-label=Unmute]").first().click();
 assert.equal(await page.locator("#first video").first().evaluate(v=>v.muted),false);
 await page.locator("#first button[aria-label=Mute]").first().click();
 await page.locator("#first [data-gm-media]").evaluate(e=>e.scrollLeft=e.clientWidth);
 await page.waitForFunction(()=>[...document.querySelectorAll("video")].every(v=>v.paused));
 await page.locator("#first [data-gm-media]").evaluate(e=>e.scrollLeft=e.clientWidth*2);
 await page.waitForFunction(()=>{const v=document.querySelectorAll("#first video")[1];return v&&!v.paused});
 await page.locator("#second").scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const v=document.querySelector("#second video");return v&&!v.paused});
 assert.equal(await page.locator("#first video").evaluateAll(v=>v.every(x=>x.paused)),true);
 await page.locator("#first").scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>!document.querySelectorAll("#first video")[1].paused);
 await page.screenshot({path:`/tmp/golfme-feed-autoplay-${width}.png`});
 // Force the native-player refusal route, then verify in-app viewer handoff.
 await page.evaluate(()=>{for(const v of document.querySelectorAll("video")){v.requestFullscreen=undefined;v.webkitEnterFullscreen=undefined;}});
 // Playing previews have no play badge; use the full-overlay button directly.
 await page.locator("#first button.focus-visible\\:outline-2").nth(1).click();
 await page.getByRole("dialog").waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll("#first video,#second video")].every(v=>v.paused));
 await page.keyboard.press("Escape");
 await page.waitForFunction(()=>!document.querySelectorAll("#first video")[1].paused);
 await page.locator("#unmount").click();
 assert.equal(await page.locator("video").count(),0);
 assert.deepEqual(errors,[]); console.log(`PASS width ${width}: autoplay, muted, sound toggle, photo/video swipes, offscreen handoff, fullscreen fallback/close, unmount`);
 await page.close();
 }
 const blocked=await browser.newPage({viewport:{width:390,height:844}});
 await blocked.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException("Autoplay blocked","NotAllowedError"));};});
 await blocked.goto("http://127.0.0.1:4189/autoplay-test");
 await blocked.locator("#first video").first().waitFor();
 await blocked.waitForTimeout(300);
 assert.equal(await blocked.locator("#first video").first().evaluate(v=>v.paused),true);
 assert.equal(await blocked.locator("#first button.focus-visible\\:outline-2 span").first().isVisible(),true);
 console.log("PASS blocked autoplay: paused poster retains visible tap-to-play fallback");
 await blocked.close();
} finally {await browser.close();await server.close();}

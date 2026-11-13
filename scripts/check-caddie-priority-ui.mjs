// Actual components, synthetic local video, no account/backend/native-device claim.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { realpath, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { COACH_CARD_MAX_SCREEN_FRACTION } from "../src/lib/coachPaging.ts";
const scratch = await mkdtemp(join(tmpdir(), "caddie-priority-"));
const media = join(scratch, "swing.mp4");
execFileSync(ffmpeg, ["-f","lavfi","-i","color=c=darkgreen:s=320x480:d=3","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart","-y",media],{stdio:"ignore"});
const origin="http://127.0.0.1:5223";
const fixture=`
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {CaddieCoachingResult} from "/src/components/caddie/CaddieCoachingResult";
import {LocaleProvider,useLocale} from "/src/i18n/LocaleContext";
import "/src/index.css";
import {CaddieAnalysisDetail} from "/src/pages/CaddieAnalysisDetail";
const phases={address:{timestampSeconds:.2,confidence:"high"},backswing:{timestampSeconds:.5,confidence:"high"},top:{timestampSeconds:1,confidence:"medium"},downswing:{timestampSeconds:1.3,confidence:"high"},impact:{windowStartSeconds:1.5,windowEndSeconds:1.6,confidence:"high"},followThrough:{timestampSeconds:2,confidence:"high"}};
const workOn=[{issue:"Turn with control",whyItMatters:"Keep the motion balanced.",checkpoint:"top",confidence:"high"}];
const focus={title:"Stored whole-swing priority",instruction:"Use the existing coaching instruction. ".repeat(8)};
const drill={name:"Stored practice drill",steps:["Pause at the top.","Turn through smoothly.","Finish balanced.","Keep the fourth stored step."]};
function Fixture(){
 const {t,locale}=useLocale();const [variant,setVariant]=useState("focus");const [mediaUrl,setMediaUrl]=useState("/swing.mp4");window.setMediaUrl=setMediaUrl;
 window.setVariant=setVariant;window.labels={fix:t("caddie.fixFirst"),inspect:t("caddie.inspectMoment"),back:t("caddie.backToFocus"),unavailable:t("caddie.momentUnavailable"),next:t("coachReplay.continue"),done:t("coachReplay.done"),approx:t("coachReplay.approximate"),locale};
 const c=variant==="empty"?undefined:{workOn:variant==="low"?[{...workOn[0],confidence:"low"}]:workOn,focus:variant==="focus"?focus:undefined,drill};
 const p=variant==="bad"?{...phases,top:{timestampSeconds:.1,confidence:"high"}}:variant==="late"?{...phases,top:{timestampSeconds:4,confidence:"high"}}:phases;
 window.qaAnalysis={id:"qa",status:"complete",createdAt:"2026-11-13",sourceMediaUrl:"/swing.mp4",strengths:[],issues:[],recommendations:[],details:{language:locale,cameraAngle:"face_on",focus,drill,workOn,summary:"Full stored summary",strengths:["Stored strength"],limitations:["Stored limitation"],phases,score:{total:63,criteria:Object.fromEntries(["setupAndPosture","backswing","downswingSequencing","balanceAndWeightTransfer","finish"].map(k=>[k,{points:12,reason:"Full reason "+k}]))}}};
 if(variant==="detail")return React.createElement("main",{className:"mx-auto max-w-xl p-4"},React.createElement(CaddieAnalysisDetail));
 return React.createElement("main",{className:"mx-auto max-w-xl p-4"},React.createElement(CaddieCoachingResult,{key:variant,sourceMediaUrl:variant==="legacy"?undefined:variant==="broken"?"/broken.mp4":mediaUrl,coaching:c,phases:p,score:{total:63,criteria:Object.fromEntries(["setupAndPosture","backswing","downswingSequencing","balanceAndWeightTransfer","finish"].map(k=>[k,{points:12,reason:"Stored reason"}]))},coachEnabled:true,poseData:{analysisFps:1,frames:[{frameIndex:0,timestampSeconds:1,personConfidence:null,keypoints:{}}]}}));
}
createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode,null,React.createElement(LocaleProvider,null,React.createElement(Fixture))));
`;
const server=await createServer({server:{host:"127.0.0.1",port:5223,strictPort:true,fs:{allow:[process.cwd(),await realpath("node_modules"),await realpath("node_modules/@fontsource/inter")]}},plugins:[{
name:"priority-fixture",enforce:"pre",
transform(code,id){if(id.split("?")[0].endsWith("/src/pages/CaddieAnalysisDetail.tsx")) return code.replace(/from "(\.\.\/(?:context\/(?:AuthContext|DataContext|ToastContext|RealCaddieContext)|lib\/(?:useCoachReplayEnabled|useCaddieFeedbackLanguage)|components\/caddie\/DeleteAnalysisDialog)|react-router-dom)"/g,'from "/qa-deps"');},
configureServer(s){s.middlewares.use(async(req,res,next)=>{
 if(req.url==="/priority-fixture"){res.setHeader("Content-Type","text/html");res.end(await s.transformIndexHtml("/priority-fixture",'<div id="root"></div><script type="module" src="/priority-fixture.tsx"></script>'));}
 else if(req.url==="/broken.mp4"){res.statusCode=404;res.end();}else if(req.url.startsWith("/swing.mp4")){const data=await readFile(media);res.setHeader("Content-Type","video/mp4");res.setHeader("Accept-Ranges","bytes");const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??"");if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):data.length-1;res.statusCode=206;res.setHeader("Content-Range","bytes "+start+"-"+end+"/"+data.length);res.setHeader("Content-Length",end-start+1);res.end(data.subarray(start,end+1));}else{res.setHeader("Content-Length",data.length);res.end(data);}}else next();
});},resolveId(id){if(id==="/qa-deps")return "\0qa-deps";if(id==="/priority-fixture.tsx")return "\0priority-fixture.tsx";},load(id){if(id==="\0qa-deps")return 'import {useLocale} from "/src/i18n/LocaleContext"; const noop=()=>{}; export const useAuth=()=>({isDemo:true}); export const useData=()=>({getCaddieAnalysis:()=>window.qaAnalysis,getPost:noop,notifications:[],markNotificationRead:noop}); export const useRealCaddie=()=>({hasLoaded:true,loadPoseData:noop,refreshMediaUrls:noop,checkStatus:noop}); export const useToast=()=>({showToast:noop}); export const useCoachReplayEnabled=()=>false; export const useCaddieFeedbackLanguage=()=>useLocale().locale; export const useParams=()=>({analysisId:"qa"}); export const useNavigate=()=>noop; export const Navigate=()=>null; export const DeleteAnalysisDialog=()=>null;';if(id==="\0priority-fixture.tsx")return fixture;}
}]});
await server.listen();let browser;let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
 await page.route("**/*",r=>r.request().url().startsWith(origin+"/")?r.continue():r.abort());
 for(const locale of ["en","es","ja","ko","zh-CN","zh-TW"]){
  await page.goto(origin+"/priority-fixture");await page.evaluate(l=>localStorage.setItem("golfme:locale",l),locale);await page.reload();
  await page.waitForFunction(l=>window.labels?.locale===l,locale);await page.getByTestId("caddie-work-on-next").waitFor();
  const labels=await page.evaluate(()=>window.labels);
  eq(await page.locator("h2").first().textContent(),labels.fix,locale+" localized priority");
  eq(await page.getByRole("button",{name:labels.inspect,exact:false}).count(),0,"focus never links");
  eq(await page.getByText("Keep the fourth stored step.").count(),1,"all drill steps kept");
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:844});
   eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,locale+" no horizontal overflow "+width);
   await page.screenshot({path:join(scratch,locale+"-"+width+".png"),fullPage:true});
  }
  await page.setViewportSize({width:320,height:667});
  await page.locator("video").evaluate(v=>v.dispatchEvent(new Event("ended")));
  const dialog=page.getByRole("dialog");
  await dialog.waitFor();let pages=0;let read="";
  while(true){
   read+=await dialog.innerText();pages++;
   eq((await dialog.boundingBox()).height<=667*COACH_CARD_MAX_SCREEN_FRACTION+2,true,"summary stays within screen budget");
   const next=dialog.getByRole("button",{name:labels.next,exact:true});
   if(!await next.count())break;
   await next.click();assert(pages<20);
  }
  eq(pages>1,true,"long summary paginates");
  eq(read.includes("Stored whole-swing priority")&&read.includes("Stored practice drill"),true,"summary preserves focus and drill");
  await dialog.getByRole("button",{name:labels.done,exact:true}).click();
  eq(await page.getByRole("dialog").count(),0,"summary dismisses");
  await page.evaluate(()=>window.setVariant("tagged"));
  await page.waitForFunction(()=>document.querySelector("video")?.readyState>=2);
  const inspect=page.getByRole("button",{name:labels.inspect,exact:false});
  eq((await inspect.textContent()).includes(labels.approx),true,"approximate explicitly labelled");
  for(let i=0;i<3;i++){
   await page.setViewportSize({width:[320,390,1440][i],height:844});
   await inspect.click();

   await page.waitForFunction(()=>{const v=document.querySelector("video");return !v.seeking && v.readyState>=2 && Math.abs(v.currentTime-1)<.05;});
   await page.getByRole("button",{name:labels.back,exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector("video").readyState>=2);
   eq(await page.locator("video").evaluate(v=>v.paused),true,"inspection stays paused");
   eq(await page.evaluate(()=>document.activeElement===document.querySelector("video")),true,"focus reaches replay");
   await page.getByRole("button",{name:labels.back,exact:true}).click();
   eq(await page.evaluate(()=>document.activeElement?.dataset.testid), "caddie-work-on-next","dismiss restores priority focus");
   await page.keyboard.press("Tab");
   eq(await inspect.evaluate(b=>document.activeElement===b),true,"Tab reaches inspect action");
   await page.keyboard.press("Tab");
   eq(await page.locator("video").evaluate(v=>document.activeElement===v),true,"Tab reaches native replay controls");
   await page.keyboard.press("Space");
   await page.waitForFunction(()=>!document.querySelector("video").paused);
   eq(await page.locator("video").evaluate(v=>v.paused),false,"keyboard starts replay");
   await page.keyboard.press("Space");
   await page.waitForFunction(()=>document.querySelector("video").paused);
   await page.locator("video").evaluate(v=>{v.currentTime=0;});
  }
  await inspect.click();
  await page.getByRole("button",{name:labels.back,exact:true}).waitFor();
  let refreshRoute;
  const refreshed=origin+"/swing.mp4?refresh="+locale;
  await page.route(refreshed,r=>{refreshRoute=r;});
  await page.evaluate(url=>window.setMediaUrl(url),refreshed);
  await page.waitForFunction(()=>document.querySelector("video").readyState===0);
  eq(await page.getByRole("button",{name:labels.back,exact:true}).count(),0,"URL refresh clears previous success");
  while(!refreshRoute)await page.waitForTimeout(10);
  await refreshRoute.continue();
  await page.getByRole("button",{name:labels.back,exact:true}).waitFor();
  eq(await page.locator("video").evaluate(v=>!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-1)<.05),true,"replacement frame confirmed");
  await page.getByRole("button",{name:labels.back,exact:true}).click();
  await page.unroute(refreshed);
  for(const variant of ["late","broken"]){
   await page.evaluate(v=>window.setVariant(v),variant);
   await page.getByRole("button",{name:labels.inspect,exact:false}).click();
   await page.getByRole("status").filter({hasText:labels.unavailable}).waitFor();
   eq(await page.getByRole("button",{name:labels.back,exact:true}).count(),0,variant+" does not pretend inspection succeeded");
  }
  await page.evaluate(()=>window.setVariant("stalled"));
  await page.waitForFunction(()=>document.querySelector("video").readyState>=2);
  await page.evaluate(()=>{
    const v=document.querySelector("video");let target=0;
    Object.defineProperty(v,"currentTime",{get:()=>target,set:t=>{target=t;}});
    Object.defineProperty(v,"seeking",{get:()=>true});
    Object.defineProperty(v,"readyState",{get:()=>1});
    window.originalTimeout=window.setTimeout;
    window.setTimeout=(fn,ms,...args)=>window.originalTimeout(fn,ms===10000?250:ms,...args);
  });
  await page.getByRole("button",{name:labels.inspect,exact:false}).click();
  eq(await page.getByRole("button",{name:labels.back,exact:true}).count(),0,"stalled seek never reports success");
  await page.getByRole("status").filter({hasText:labels.unavailable}).waitFor();
  eq(await page.getByRole("button",{name:labels.back,exact:true}).count(),0,"seek timeout clears inspection");
  await page.evaluate(()=>{window.setTimeout=window.originalTimeout;});
  await page.evaluate(()=>window.setVariant("detail"));
  await page.getByText("Full stored summary",{exact:true}).waitFor();
  for(const text of ["Stored strength","Stored limitation","Full reason setupAndPosture","Full reason backswing","Full reason downswingSequencing","Full reason balanceAndWeightTransfer","Full reason finish"]){
   eq(await page.getByText(text,{exact:true}).count(),1,"full detail retains "+text);
  }
  eq(await page.getByTestId("caddie-work-on-next").count(),1,"full page integrates one priority");
  for(const variant of ["bad","low","empty","legacy"]){
   await page.evaluate(v=>window.setVariant(v),variant);await page.waitForTimeout(50);
   eq(await page.getByRole("button",{name:labels.inspect,exact:false}).count(),0,variant+" no unsupported link");
  }
 }
 eq(errors,[],"no browser runtime errors");
 console.log(JSON.stringify({result:"passed",checks,screenshots:scratch,locales:6,widths:[320,390,1440]}));
}finally{await browser?.close();await server.close();}


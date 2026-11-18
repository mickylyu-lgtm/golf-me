import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
let demo = true;
let knownHost = true;
const source = readFileSync(new URL("../src/components/golfcall/RoundStripCard.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const modules: Record<string, unknown> = {
 "../../lib/courseImagery":{courseTileSource:({lat,lng}:any)=>lat===34.1246158&&lng===-118.2703437?{id:"usgs"}:null},
 "../courses/SatelliteTiles":{FittedSatelliteTiles:()=>createElement("span",{"data-aerial":true})},
 "../courses/CourseThumb":{SatelliteAttribution:()=>createElement("span",null,"USGS aerial credit")},
 "../../../supabase/functions/_shared/courseBounds.ts":{POINT_THUMB_ZOOM:15.2},
 "react-router-dom": { useNavigate: () => () => {} },
 "../../context/DataContext": { useData: () => ({currentUser:{id:"self"},getGolfer:(id:string)=>knownHost?{id,name:"Jamie Lee"}:undefined}) },
 "../../context/AuthContext": {useAuth:()=>({isDemo:demo})},
 "../../i18n/LocaleContext": {useLocale:()=>({locale:"en",t:(key:string,vars:Record<string,unknown>={})=>key+" "+Object.values(vars).join(" ")})},
 "../ui/Avatar": {Avatar:()=>createElement("span",{"data-avatar":true})},
 "../courses/CourseHero": {GenericCourseIllustration:()=>createElement("svg",{"data-fallback":true})},
 "../ui/cardStyles": {CLICKABLE_CARD_CLASS:"card"},
 "../../lib/handpickedCourses":{matchHandpickedCourse:(name:string)=>name==="Known Course"?{heroImageUrl:"/verified.jpg",heroImageCredit:"Verified credit"}:undefined},
 "../../lib/bookingStatus":{bookingStatusView:(call:any)=>({visible:true,labelKey:call.bookingStatus==="booked"?"booked-host-reported":"not-provided"})},
 "../../lib/format":{formatDate:()=>"Saturday, Dec 12",formatMoney:(n:number)=>"$"+n},
 "../../lib/geo":{roundedMiles:(n:number)=>Math.round(n)},
 "./RoundShareButton":{RoundShareButton:()=>createElement("button",null,"Share round")},
};
const mod={exports:{} as any};
new Function("require","exports","module",js)((id:string)=>modules[id]??req(id),mod.exports,mod);
const call={id:"round",hostId:"friend",course:"Known Course",areaLabel:"Jersey City",dateISO:"2026-12-12",timeLabel:"1:30 PM",estimatedPricePerPerson:49,holes:9,totalSpots:4,joinedGolferIds:["friend"],status:"open"};
function render(patch={}){return renderToStaticMarkup(createElement(mod.exports.RoundStripCard,{call:{...call,...patch}}));}
test("real round card keeps full course, date/time, cost and host",()=>{
 const html=render();assert.match(html,/Known Course/);assert.match(html,/Saturday, Dec 12/);assert.match(html,/1:30 PM/);assert.match(html,/Jersey City/);assert.match(html,/~\$49/);assert.match(html,/Jamie Lee/);assert.doesNotMatch(html,/line-clamp|truncate/);
});
test("unknown course never borrows another course image and missing cost/distance stay absent",()=>{
 const html=render({course:"Unknown Course",estimatedPricePerPerson:NaN});assert.match(html,/data-fallback/);assert.doesNotMatch(html,/verified.jpg|miAway|~\$/);
});
test("verified image retains credit and booking label is delegated without fabricated confirmation",()=>{
 const html=render();assert.match(html,/Verified credit/);assert.match(html,/not-provided/);assert.doesNotMatch(html,/confirmed/i);assert.match(render({bookingStatus:"booked"}),/booked-host-reported/);
});
test("share remains only for a real active host, separate from the navigation button",()=>{
 demo=false;assert.match(render({hostId:"self"}),/Share round/);assert.doesNotMatch(render(),/Share round/);assert.doesNotMatch(render({hostId:"self",status:"cancelled"}),/Share round/);demo=true;assert.doesNotMatch(render({hostId:"self"}),/Share round/);
});
test("missing profiles and overfull data render without invented participants or negative spots",()=>{
 knownHost=false;const html=render({totalSpots:0});assert.doesNotMatch(html,/Jamie Lee|data-avatar/);assert.match(html,/spotsRemainingPlural 0/);knownHost=true;
});

test("Los Feliz stored venue coordinates get aerial fallback, not another course photo",()=>{
 const html=render({course:"Los Feliz 3-Par Golf Course",courseLat:34.1246158,courseLng:-118.2703437});assert.match(html,/data-aerial/);assert.match(html,/USGS aerial credit/);assert.doesNotMatch(html,/verified.jpg|data-fallback/);
});
test("missing, invalid and unsupported coordinates stay honest; photos keep priority",()=>{
 for(const pair of [[undefined,undefined],[NaN,-118],[91,-118],[34,-181],[51,0]])assert.match(render({course:"Other",courseLat:pair[0],courseLng:pair[1]}),/data-fallback/);
 assert.doesNotMatch(render({courseLat:34.1246158,courseLng:-118.2703437}),/data-aerial/);
});

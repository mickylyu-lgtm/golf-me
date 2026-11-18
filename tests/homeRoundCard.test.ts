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

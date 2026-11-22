import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeTranslator } from "../src/i18n/translate.ts";
import * as official from "../src/lib/bayonneOfficialTeeRatings.ts";
import { en } from "../src/i18n/locales/en.ts";
const req=createRequire(import.meta.url);
const source=readFileSync(new URL("../src/components/courses/CourseTeeRatings.tsx",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{} as any};
new Function("require","exports",js)((id:string)=>id.includes("LocaleContext")?{useLocale:()=>({locale:"en",t:makeTranslator(undefined,en)})}:id.includes("bayonneOfficialTeeRatings")?official:id.includes("courseTeeRatings")?{loadCourseTeeRatings:()=>{throw new Error("unexpected network");}}:req(id),mod.exports);
const empty={course:null,slope:null,bogey:null};
const tee={name:"Sample Blue",group:"men",holes:18,overall:{course:72.4,slope:132,bogey:96.9},front:empty,back:empty};
const render=(tees:any[], source?:{url:string;reviewedOn:string})=>renderToStaticMarkup(createElement(mod.exports.TeeRatingsPanel,{data:{tees,source}}));
test("default total rating, available sections only, bogey collapsed",()=>{
 const html=render([tee]);assert.match(html,/72.4/);assert.match(html,/132/);assert.match(html,/18 holes/);assert.doesNotMatch(html,/Front 9|Back 9/);assert.match(html,/<details class=/);assert.doesNotMatch(html,/<details[^>]*open/);assert.match(html,/More details/);assert.match(html,/Bogey Rating/);
});
test("shows the slope scale and standard without implying a score out of 155",()=>{
 const html=render([tee]);
 assert.match(html,/Slope Rating<\/p>.*>132<\/p>.*55–155 · 113 is standard/);
 assert.doesNotMatch(html,/132\s*\/\s*155/);
 assert.doesNotMatch(render([{...tee,overall:{course:72.4,slope:null,bogey:null}}]),/113 is standard/);
});
test("standalone nine holes never mislabeled eighteen",()=>{
 const html=render([{...tee,holes:9}]);assert.match(html,/9 holes/);assert.doesNotMatch(html,/18 holes/);
});
test("front-only rating remains available without inventing total",()=>{
 const html=render([{...tee,overall:empty,front:{course:36.1,slope:130,bogey:null}}]);assert.match(html,/Front 9/);assert.match(html,/36.1/);assert.doesNotMatch(html,/18 holes|Back 9|More details/);
});
test("missing metrics are omitted and availability is explained",()=>{
 const html=render([{...tee,overall:{course:72.4,slope:null,bogey:null}}]);
 assert.match(html,/72.4/);assert.match(html,/Some ratings weren’t verified/);
 assert.doesNotMatch(html,/Slope Rating|>0<|More details|—/);
 assert.match(html,/aren’t player reviews or a prediction of your score/);
});
test("standalone front-backed 9 is one nine-hole presentation; full nine wins without merging",()=>{
 const front={course:36.1,slope:130,bogey:null};
 const frontOnly=render([{...tee,holes:9,overall:empty,front}]);
 assert.match(frontOnly,/9 holes/);assert.match(frontOnly,/36.1/);assert.doesNotMatch(frontOnly,/Front 9|Back 9|18 holes/);
 const both=render([{...tee,holes:9,overall:{course:36.3,slope:null,bogey:null},front}]);
 assert.match(both,/36.3/);assert.doesNotMatch(both,/36.1|130|Slope Rating|Front 9/);
});
test("official source link and localized review date only for valid metadata",()=>{
 const url="https://example.com/scorecard.pdf";
 const html=render([tee],{url,reviewedOn:"2026-11-21"});
 assert.match(html,/href="https:\/\/example.com\/scorecard.pdf"/);
 assert.match(html,/Official source/);assert.match(html,/Checked Nov 21, 2026/);
 for(const source of [undefined,{url:"javascript:alert(1)",reviewedOn:"2026-11-21"},{url:"https://user:pass@example.com",reviewedOn:"2026-11-21"},{url,reviewedOn:"2026-02-30"}]){
  assert.doesNotMatch(render([tee],source),/Official source|<a /);
 }
});
test("conventional tee names have decorative swatches; custom names remain uncolored",()=>{
 const html=render([{...tee,name:"Blue"},{...tee,name:"White Tee"},{...tee,name:"Red"}]);
 for(const hex of ["#2563eb","#ffffff","#dc2626"])assert.ok(html.includes("background-color:"+hex));
 assert.match(html,/aria-hidden="true" class="size-3[^"]*border-slate-400/);
 assert.doesNotMatch(render([{...tee,name:"Redwood"}]),/background-color:/);
});
test("same-named tees retain separate rating categories",()=>{
 const html=render([tee,{...tee,group:"women",overall:{course:76.2,slope:140,bogey:108}}]);assert.match(html,/Men’s ratings/);assert.match(html,/Women’s ratings/);assert.equal((html.match(/Sample Blue/g)||[]).length,2);assert.match(html,/72.4/);assert.doesNotMatch(html,/>76.2</);
});
test("course section starts closed and loads only on opening; stale requests cancelled",()=>{
 const html=renderToStaticMarkup(createElement(mod.exports.CourseTeeRatings,{courseId:"real",enabled:true}));assert.match(html,/aria-expanded="false"/);assert.doesNotMatch(html,/Loading tee/);assert.match(source,/if \(!open \|\| !enabled \|\| !courseId \|\| dataSource !== "provider"\) return/);assert.match(source,/dataSource !== "provider"/);assert.match(source,/cancelled = true/);
});
test("page and sheet pass the independent Bayonne opt-out and default-off broader provider flag",()=>{
 const source=readFileSync(new URL("../src/components/courses/CourseDetailContent.tsx",import.meta.url),"utf8");assert.match(source,/bayonnePilot: import.meta.env.VITE_BAYONNE_OFFICIAL_TEE_RATINGS_ENABLED,/);assert.match(source,/VITE_COURSE_TEE_RATINGS_ENABLED === "true"/);assert.match(source,/signedIn: isAuthenticated/);assert.match(source,/isDemo,/);assert.match(source,/courseId=\{course.id\} enabled dataSource=\{ratingsSource\}/);
});


test("Bayonne open panel uses verified static ratings without invoking the provider", (t) => {
  const mocks = { exports: {} as any };
  const react = req("react");
  const invoke = t.mock.fn(() => { throw new Error("unexpected vendor call"); });
  t.mock.method(Date, "now", () => Date.parse("2026-11-22T12:00:00Z"));
  new Function("require", "exports", js)((id: string) => id === "react"
    ? { ...react, useEffect: (effect: () => void) => effect(), useState: (initial: unknown) => react.useState(initial === false ? true : initial) }
    : id.includes("LocaleContext") ? { useLocale: () => ({ locale: "en", t: makeTranslator(undefined, en) }) }
    : id.includes("bayonneOfficialTeeRatings") ? official
    : id.includes("courseTeeRatings") ? { loadCourseTeeRatings: invoke }
    : req(id), mocks.exports);
  const html = renderToStaticMarkup(createElement(mocks.exports.CourseTeeRatings, {
    courseId: official.BAYONNE_OFFICIAL_COURSE_ID, enabled: true, dataSource: "bayonne",
  }));
  assert.match(html, /75\.0/);
  assert.match(html, /151/);
  assert.match(html, /Official source/);
  assert.match(html, /Checked Nov 22, 2026/);
  assert.doesNotMatch(html, /Bogey Rating|Front 9|Back 9|Loading tee/);
  assert.equal(invoke.mock.callCount(), 0);
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {roundBannerCourseId,roundBannerSatellite} from '../src/lib/roundBanner.ts';
const req=createRequire(import.meta.url);
const testing=process.env.DOM_PREFIX ? createRequire(process.env.DOM_PREFIX+'/package.json') : req;
const {JSDOM}=testing('jsdom');
const React=req('react');
const {createRoot}=req('react-dom/client');
const {act}=React;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const dom=new JSDOM('<div id="root"></div>');
globalThis.window=dom.window;globalThis.document=dom.window.document;
let state={photo:null,settled:true,bounds:null};let asked;
const mocks={
 '../../lib/courseImageryClient':{useBestCoursePhoto:course=>{asked=course;return state}},
 '../../lib/courseImagery':{aerialCredit:()=> 'Synthetic satellite credit',courseTileSource:()=>({id:'synthetic'})},
 '../../lib/roundBanner':{roundBannerCourseId,roundBannerSatellite},
 '../../i18n/LocaleContext':{useLocale:()=>({t:key=>key})},
 './CourseHero':{GenericCourseIllustration:()=>React.createElement('svg',{'data-generic':true})},
 './SatelliteTiles':{FittedSatelliteTiles:props=>React.createElement('button',{'data-satellite':true,onClick:props.onError})},
 '../../../supabase/functions/_shared/courseBounds':{POINT_HERO_ZOOM:14},
};
const source=readFileSync(new URL('../src/components/courses/RoundVenueBanner.tsx',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};new Function('require','exports','module',js)(id=>mocks[id]??req(id),module.exports,module);
const {RoundVenueBanner}=module.exports;const root=createRoot(document.getElementById('root'));
const id='00000000-0000-4000-8000-000000000001';
async function render(courseId,name='QA Course'){await act(()=>root.render(React.createElement(RoundVenueBanner,{courseId,name})))}
await render(undefined);assert.equal(asked,null);assert.ok(document.querySelector('[data-generic]'));
state={photo:{source:'google',url:'https://example.invalid/qa.jpg',authors:[{name:'Photographer',uri:'https://example.invalid/credit'}],mapsUri:'https://maps.google.com/'},settled:true,bounds:null};
await render(id);assert.deepEqual(asked,{id,name:'QA Course'});assert.match(document.body.textContent,/Photographer.*Google Maps/);
assert.equal(document.querySelectorAll('video').length,0);
await act(()=>document.querySelector('img').dispatchEvent(new dom.window.Event('error')));
assert.ok(document.querySelector('[data-generic]'));assert.equal(document.querySelector('img'),null);
await render(id,'Different round');assert.ok(document.querySelector('img'));
state={photo:null,settled:true,bounds:{south:40.7,north:40.71,west:-74.01,east:-74}};
await render(id,'Satellite');assert.ok(document.querySelector('[data-satellite]'));assert.match(document.body.textContent,/courseImage.satellite/);
await act(()=>document.querySelector('button').click());assert.ok(document.querySelector('[data-generic]'));
state={photo:{source:'wikimedia',url:'https://example.invalid/b.jpg',credit:'Author, CC BY',pageUrl:'https://example.invalid/license'},settled:true,bounds:{south:40.7,north:40.71,west:-74.01,east:-74}};
await render(id,'Photo then satellite');assert.ok(document.querySelector('img'));
await act(()=>document.querySelector('img').dispatchEvent(new dom.window.Event('error')));assert.ok(document.querySelector('[data-satellite]'));
await act(()=>document.querySelector('button').click());assert.ok(document.querySelector('[data-generic]'));
await act(()=>root.unmount());
console.log('PASS actual React banner: unknown generic/no lookup, ID-only request, attribution, image failure, identity reset, labeled satellite, tile failure, no video');

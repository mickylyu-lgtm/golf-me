import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function render(activePath:string){
 const source=readFileSync(new URL('../src/components/layout/RootTabCarousel.tsx',import.meta.url),'utf8');
 const mocks:Record<string,unknown>={memo:(fn:unknown)=>fn,useEffect:()=>{},useRef:()=>({current:null}),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,()=>{}],useNavigate:()=>()=>{}};
 const module={exports:{} as {RootTabCarousel:(p:{activePath:string})=>any}};
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports','window',code)((name:string)=>name==='react/jsx-runtime'?require(name):new Proxy({},{get:(_,key)=>mocks[String(key)]??String(key)}),module,module.exports,{matchMedia:()=>({matches:false})});
 return module.exports.RootTabCarousel({activePath}).props.children.props.children;
}
test('each persistent tab clips its own horizontal overflow, not just the outer viewport',()=>{
 for(const path of ['/','/messages','/find','/caddie','/profile']){
  const track=render(path);assert.equal(track.props.children.length,5);
  for(const panel of track.props.children){
   assert.match(panel.props.className,/(?:^|\s)overflow-x-clip(?:\s|$)/);
   assert.doesNotMatch(panel.props.className,/overflow-hidden|overflow-auto|contain-paint|transform/);
   assert.equal(panel.props.style.width,'20%');
   assert.equal(panel.props.style.transform,undefined);
  }
 }
});
test('tab positions and fixed-overlay containing blocks stay unchanged',()=>{
 for(const [index,path]of ['/','/messages','/find','/caddie','/profile'].entries()){
  const track=render(path);assert.equal(track.props.style.left,`${-index*100}%`);
  assert.equal(track.props.style.width,'500%');assert.equal(track.props.style.position,'relative');
  assert.equal(track.props.style.transform,undefined);
 }
});

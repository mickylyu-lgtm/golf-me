import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="golfme-boot-recovery">([\s\S]*?)<\/script>/)![1];
function boot(classes = ['gm-app', 'gm-entry-boot'], children = 0) {
  let timeout: () => void = () => {}; let changed: () => void = () => {};
  let cleared = false; let disconnected = false; let reloads = 0;
  const cls = new Set(classes);
  const root = { childElementCount: children };
  const elements: any[] = [];
  function element() { return { style: {}, setAttribute() {}, append(...items: any[]) { this.children = items; }, children: [] as any[], remove() { elements.splice(elements.indexOf(this), 1); } }; }
  runInNewContext(script, {
    document: { getElementById: () => root, documentElement: { classList: { contains: (s: string) => cls.has(s), remove: (s: string) => cls.delete(s) } }, createElement: element, body: { appendChild: (e: any) => elements.push(e) } },
    MutationObserver: class { constructor(cb: () => void) { changed = cb; } observe() {} disconnect() { disconnected = true; } },
    setTimeout(cb: () => void, ms: number) { assert.equal(ms,12000); timeout=cb; return 1; },
    clearTimeout() { cleared=true; }, location: { reload() { reloads++; } },
  });
  return { root, cls, elements, expire: () => timeout(), change: () => changed(), get reloads() { return reloads; }, get cleaned() { return cleared && disconnected; } };
}
test('missing module shows retry without automatic reload or green screen', () => {
  const b=boot(); b.expire(); assert.equal(b.elements.length,1); assert.equal(b.cls.has('gm-entry-boot'),false); assert.equal(b.reloads,0);
  b.elements[0].children[2].onclick(); assert.equal(b.reloads,1);
});
test('normal mount cancels recovery without touching animation', () => {
  const b=boot(); b.root.childElementCount=1; b.change(); assert.ok(b.cleaned); assert.ok(b.cls.has('gm-entry-boot')); assert.equal(b.elements.length,0);
});
test('late module mount removes retry instead of obscuring app', () => {
  const b=boot(); b.expire(); b.root.childElementCount=1; b.change(); assert.ok(b.cleaned); assert.equal(b.elements.length,0);
});
test('pre-rendered public landing remains intact', () => {
  const b=boot([]); b.expire(); assert.equal(b.elements.length,0); assert.ok(b.cleaned);
});
test('already rendered root including app loading/error screen stays untouched', () => {
  const b=boot(['gm-app'],1); b.expire(); assert.equal(b.elements.length,0);
});
test('app launch without entry animation still gets recovery', () => {
  const b=boot(['gm-app']); b.expire(); assert.equal(b.elements.length,1); assert.equal(b.reloads,0);
});

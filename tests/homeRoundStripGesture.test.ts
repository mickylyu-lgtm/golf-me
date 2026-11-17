import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('Home rounds strip owns horizontal gestures without blocking native vertical scroll',()=>{
 const source=readFileSync(new URL('../src/pages/Home.tsx',import.meta.url),'utf8');
 const strip=source.match(/<div\s+data-no-swipe\s+className="([^"]*-mx-4[^"\n]*)"\s*>/);
 assert.ok(strip,'rounds strip opts out of parent tab swiping');
 assert.match(strip[1],/overflow-x-auto/);assert.match(strip[1],/overscroll-x-contain/);
 assert.doesNotMatch(strip[1],/touch-pan-x|touch-none/);
 assert.match(source,/stripRounds\.rounds\.map\(\(call\) => \(\s*<RoundStripCard key=\{call.id\} call=\{call\}/);
});

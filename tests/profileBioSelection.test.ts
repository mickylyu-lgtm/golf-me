import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('only displayed profile bios opt in to native touch text selection', () => {
  const member = read('src/pages/GolferProfilePage.tsx');
  const me = read('src/pages/Profile.tsx');
  assert.match(member, /<p className="select-text [^"]*">\{golfer\.bio\}<\/p>/);
  assert.match(me, /<p data-no-swipe className="[^"]*\bselect-text\b[^"]*">\{currentUser\.bio\}<\/p>/);
  assert.match(read('src/components/layout/RootTabCarousel.tsx'), /closest\([^\n]+\[data-no-swipe\]/);
  assert.match(read('src/index.css'), /body \.select-text,\s*body \.select-text \*\s*\{\s*-webkit-user-select: text;\s*user-select: text;\s*-webkit-touch-callout: default;/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/pages/GolfCalls.tsx', import.meta.url), 'utf8');
const marker = 'const matchedResults = useMemo(() => {';
const start = source.indexOf(marker) + marker.length;
const end = source.indexOf('\n  }, [isMatched', start);
assert.ok(start >= marker.length && end > start);
const body = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function run(overrides = {}) {
  const calls = [
    { id: '18', holes: 18, hostId: 'host', joinedGolferIds: ['host'], totalSpots: 4, distanceMiles: 800 },
    { id: '9', holes: 9, hostId: 'host', joinedGolferIds: ['host'], totalSpots: 4, distanceMiles: 900 },
  ];
  const scope = {
    isMatched: true, baseResults: calls, radius: 25, effectiveLoc: { label: 'Trip' },
    resolveCallDistanceMiles: () => 2, when: null, customDate: null, intent: 'join', budgetMax: null,
    skill: null, vibeFilter: null, walk: null, currentUser: { id: 'viewer' },
    effectivePrefs: { roundLengthPreference: '9 Holes' }, preferenceContext: {}, getGolfer: () => ({ id: 'host' }),
    evaluatePreferenceMatch: (prefs, _id, call) => prefs.roundLengthPreference === 'No Preference' ? [] : [{ matched: prefs.roundLengthPreference === `${call.holes} Holes` }],
    computeCallCompatibility: (_user, call) => ({ overall: call.holes === 18 ? 90 : 70 }),
    hostedFirst: (items) => items,
    ...overrides,
  };
  const result = new Function(...Object.keys(scope), body)(...Object.values(scope));
  return { result, calls };
}
test('matched browse ranks per-search preferences before compatibility without discarding other rounds', () => {
  assert.deepEqual(run().result.map((x) => x.call.id), ['9', '18']);
  assert.deepEqual(run({ effectivePrefs: { roundLengthPreference: '18 Holes' } }).result.map((x) => x.call.id), ['18', '9']);
  assert.deepEqual(run({ effectivePrefs: { roundLengthPreference: 'No Preference' } }).result.map((x) => x.call.id), ['18', '9']);
});
test('filter, score and card receive the same travel distance without changing provider rows', () => {
  const scored = [];
  const { result, calls } = run({ computeCallCompatibility: (_u, c) => { scored.push(c.distanceMiles); return { overall: 50 }; } });
  assert.deepEqual(scored, [2, 2]);
  assert.ok(result.every((x) => x.call.distanceMiles === 2));
  assert.deepEqual(calls.map((x) => x.distanceMiles), [800, 900]);
});
test('unknown travel distance does not match radius and card preferences are scoped to matched browse', () => {
  assert.deepEqual(run({ resolveCallDistanceMiles: () => undefined }).result, []);
  assert.match(source, /matchPreferences=\{isMatched \? effectivePrefs : undefined\}/);
  const card = fs.readFileSync(new URL('../src/components/golfcall/GolfCallCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /evaluatePreferenceMatch\(matchPreferences \?\? currentUser/);
});

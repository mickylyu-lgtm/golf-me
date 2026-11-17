import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { listView } from '../src/lib/loadStatus.ts';

const require = createRequire(import.meta.url);
type Element = { type: unknown; props: Record<string, any> };
function render(page: 'SavedPosts' | 'MyPosts', status: Record<string, unknown>, count = 0, isDemo = false) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `post${i}`, authorId: 'me', createdAt: '2026-11-17' }));
  let retried = 0;
  const retry = () => { retried++; };
  const community = { hasLoaded: true, loadError: false, isLoading: false, refreshFailed: false, retry, ...status };
  const mocks: Record<string, unknown> = {
    useNavigate: () => () => {}, useData: () => ({ currentUser: { id: 'me' }, posts: rows, savedPostsList: rows }),
    useAuth: () => ({ isDemo }), useRealCommunity: () => community, useLocale: () => ({ t: (key: string) => key }),
    listView,
  };
  const module = { exports: {} as Record<string, () => Element> };
  const source = readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)((name: string) => name === 'react/jsx-runtime' ? require(name) : new Proxy({}, { get: (_, key) => mocks[String(key)] ?? String(key) }), module, module.exports);
  const root = module.exports[page]();
  const elements: Element[] = [];
  function visit(value: any) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object' || !value.props) return;
    elements.push(value); visit(value.props.children);
  }
  visit(root);
  return { find: (type: string) => elements.find(e => e.type === type), retried: () => retried, retry };
}

for (const page of ['SavedPosts', 'MyPosts'] as const) {
  test(`${page}: initial loading never claims posts are empty`, () => {
    const ui = render(page, { hasLoaded: false, isLoading: true });
    assert.ok(ui.find('GolfMeLoader')); assert.equal(ui.find('EmptyState'), undefined);
  });
  test(`${page}: failed load exposes working retry instead of empty`, () => {
    const ui = render(page, { loadError: true });
    assert.equal(ui.find('EmptyState'), undefined);
    assert.equal(ui.find('LoadErrorState')?.props.onRetry, ui.retry);
    ui.find('LoadErrorState')!.props.onRetry(); assert.equal(ui.retried(), 1);
  });
  test(`${page}: retry loading, successful empty and recovered posts remain distinct`, () => {
    assert.ok(render(page, { loadError: true, isLoading: true }).find('GolfMeLoader'));
    assert.ok(render(page, {}).find('EmptyState'));
    assert.ok(render(page, {}, 1).find('PostCard'));
  });
  test(`${page}: failed refresh keeps posts and offers retry`, () => {
    const ui = render(page, { refreshFailed: true }, 1);
    assert.ok(ui.find('PostCard'));
    assert.equal(ui.find('StaleDataNotice')?.props.onRetry, ui.retry);
    assert.equal(ui.find('LoadErrorState'), undefined);
  });
  test(`${page}: demo ignores real loading and error flags`, () => {
    const ui = render(page, { hasLoaded: false, loadError: true, isLoading: true, refreshFailed: true }, 0, true);
    assert.ok(ui.find('EmptyState')); assert.equal(ui.find('GolfMeLoader'), undefined); assert.equal(ui.find('StaleDataNotice'), undefined);
  });
}

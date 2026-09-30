import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const Adapter = require(path.join(ROOT, 'orthography-resolver-adapter.js'));

const bundle = {
  bundleContentId: 'accepted-test-bundle',
  resolveUnit(input) {
    if (input === '学校') return { kind: 'resolved', lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098', historical: { surface: '學校' } };
    if (input === '今日') return { kind: 'candidates', lexicalCandidates: [{ lexicalIdentity: 'a' }, { lexicalIdentity: 'b' }] };
    if (input === '未知語') return { kind: 'unresolved', lexicalCandidates: [] };
    if (input === '台風') return { kind: 'resolved', lexicalIdentity: 'unidic-cwj:2025.12:lemma:21903', historical: { surface: '颱風' } };
    return { kind: 'unresolved' };
  },
  render(unit) { return unit.historical?.surface ?? ''; }
};

const legacy = (input) => ({ 学校: '學校', 今日: '今日', 未知語: '未知語', 台風: '台風' })[input] ?? input;

test('shadow adapter never changes authoritative legacy output', () => {
  const adapter = Adapter.createAdapter({ resolverBundle: bundle, legacyTransform: legacy });
  for (const source of ['学校', '今日', '未知語', '台風']) {
    const result = adapter.evaluate(source);
    assert.equal(result.authoritativeOutput, legacy(source));
    assert.equal(result.legacyOutput, legacy(source));
  }
});

test('shadow adapter exposes resolved, candidates, unresolved and diff classes deterministically', () => {
  const adapter = Adapter.createAdapter({ resolverBundle: bundle, legacyTransform: legacy });
  const school = adapter.evaluate('学校');
  assert.equal(school.classification, 'legacy-changed/core-resolved');
  assert.equal(school.core.trace.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(school.core.output, '學校');

  const today = adapter.evaluate('今日');
  assert.equal(today.classification, 'legacy-unchanged/core-candidates');
  assert.equal(today.core.kind, 'candidates');

  const unknown = adapter.evaluate('未知語');
  assert.equal(unknown.classification, 'legacy-unchanged/core-unresolved');

  const taifu = adapter.evaluate('台風');
  assert.equal(taifu.classification, 'legacy-output!=core-output');
  assert.equal(taifu.authoritativeOutput, '台風');
  assert.equal(taifu.core.output, '颱風');
});

test('resolver failures fail closed to legacy authoritative output', () => {
  const broken = { ...bundle, resolveUnit() { throw new Error('bundle rejected'); } };
  const adapter = Adapter.createAdapter({ resolverBundle: broken, legacyTransform: legacy });
  const result = adapter.evaluate('学校');
  assert.equal(result.classification, 'core-error');
  assert.equal(result.authoritativeOutput, '學校');
  assert.equal(result.core.output, null);
  assert.match(result.core.error, /bundle rejected/);
});

test('adapter rejects incomplete resolver bundle before evaluation', () => {
  assert.throws(() => Adapter.createAdapter({ resolverBundle: {}, legacyTransform: legacy }), /resolveUnit/);
});

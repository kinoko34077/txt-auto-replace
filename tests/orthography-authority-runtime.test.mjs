import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = fs.readFileSync(path.join(ROOT, 'orthography-authority-runtime.js'), 'utf8');

const makeSandbox = (bundle) => {
  const sandbox = {
    OrthographyResolverLoader: { load: async () => bundle }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'orthography-authority-runtime.js' });
  return sandbox;
};

const bundle = {
  resolveUnit(input) {
    if (input === '学校') return { kind: 'resolved', lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098' };
    if (input === '台風') return { kind: 'resolved', lexicalIdentity: 'unidic-cwj:2025.12:lemma:21903' };
    if (input === '今日') return { kind: 'candidates', lexicalIdentity: null };
    return { kind: 'unresolved', lexicalIdentity: null };
  },
  render(unit) {
    if (unit.lexicalIdentity.endsWith(':8098')) return '學校';
    if (unit.lexicalIdentity.endsWith(':21903')) return '颱風';
    return '';
  }
};

test('policy stores surfaces and canonical identities but no duplicated target spelling', () => {
  const sandbox = makeSandbox(bundle);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.OrthographyAuthorityRuntime.ADMISSIONS)), {
    学校: 'unidic-cwj:2025.12:lemma:8098',
    台風: 'unidic-cwj:2025.12:lemma:21903'
  });
  const serialized = JSON.stringify(sandbox.OrthographyAuthorityRuntime.ADMISSIONS);
  assert.equal(serialized.includes('學校'), false);
  assert.equal(serialized.includes('颱風'), false);
});

test('admitted exact units use generic resolver render after lexical identity check', async () => {
  const sandbox = makeSandbox(bundle);
  await sandbox.OrthographyAuthorityRuntime.initialize();
  const school = sandbox.OrthographyAuthorityRuntime.resolve('学校');
  assert.equal(school.output, '學校');
  assert.equal(school.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  const taifu = sandbox.OrthographyAuthorityRuntime.resolve('台風');
  assert.equal(taifu.output, '颱風');
  assert.equal(taifu.lexicalIdentity, 'unidic-cwj:2025.12:lemma:21903');
});

test('candidate, unresolved, non-admitted and identity-mismatch cases decline authority', async () => {
  const sandbox = makeSandbox(bundle);
  await sandbox.OrthographyAuthorityRuntime.initialize();
  assert.equal(sandbox.OrthographyAuthorityRuntime.resolve('今日'), null);
  assert.equal(sandbox.OrthographyAuthorityRuntime.resolve('未知語'), null);
  assert.equal(sandbox.OrthographyAuthorityRuntime.resolve('学校です'), null);

  const mismatch = makeSandbox({
    resolveUnit() { return { kind: 'resolved', lexicalIdentity: 'unidic-cwj:2025.12:lemma:999' }; },
    render() { return 'BAD'; }
  });
  await mismatch.OrthographyAuthorityRuntime.initialize();
  assert.equal(mismatch.OrthographyAuthorityRuntime.resolve('学校'), null);
});

test('not-ready and resolver errors decline authority without throwing', async () => {
  const sandbox = makeSandbox({
    resolveUnit() { throw new Error('bad resolver'); },
    render() { throw new Error('bad render'); }
  });
  assert.equal(sandbox.OrthographyAuthorityRuntime.resolve('学校'), null);
  await sandbox.OrthographyAuthorityRuntime.initialize();
  assert.equal(sandbox.OrthographyAuthorityRuntime.resolve('学校'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AUTHORITY_PATH = path.join(ROOT, 'orthography-authority-runtime.js');
const authoritySource = fs.existsSync(AUTHORITY_PATH) ? fs.readFileSync(AUTHORITY_PATH, 'utf8') : '';
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const loadRealResolverBundle = () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source('transform-shared.js'), sandbox, { filename: 'transform-shared.js' });
  for (const file of [
    'lexical-runtime.js',
    'historical-native-runtime.js',
    'historical-sino-runtime.js',
    'safe-character-runtime.js'
  ]) {
    vm.runInNewContext(source(`orthography-core/runtime/${file}`), sandbox, { filename: file });
  }
  vm.runInNewContext(source('orthography-core/runtime/orthography-resolver.js'), sandbox, { filename: 'orthography-resolver.js' });
  vm.runInNewContext(source('orthography-core/runtime/resolver-bundle-runtime.js'), sandbox, { filename: 'resolver-bundle-runtime.js' });
  const artifact = JSON.parse(source('orthography-core/resolver-bundle.json'));
  return sandbox.ResolverBundleRuntime.createResolverBundle(artifact);
};

const loadAuthority = ({ bundle = loadRealResolverBundle(), loadError = null } = {}) => {
  assert.notEqual(authoritySource, '', 'orthography-authority-runtime.js must exist');
  const sandbox = {
    OrthographyResolverLoader: {
      async load() {
        if (loadError) throw loadError;
        return bundle;
      },
      snapshot() { return { status: loadError ? 'error' : 'ready' }; }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(authoritySource, sandbox, { filename: 'orthography-authority-runtime.js' });
  return sandbox.OrthographyAuthorityRuntime;
};

const tokenizer = (...surfaces) => ({
  tokenize() { return surfaces.map((surface_form) => ({ surface_form })); }
});

test('admitted exact tokens are rendered by the real source-locked resolver', async () => {
  const runtime = loadAuthority();
  await runtime.initialize();
  const actual = runtime.preprocess('学校 と 台風', tokenizer('学校', 'と', '台風'));
  assert.equal(actual, '學校 と 颱風');
  const metrics = JSON.parse(JSON.stringify(runtime.metrics()));
  assert.equal(metrics.delegated, 2);
  assert.equal(metrics.byIdentity['unidic-cwj:2025.12:lemma:8098'], 1);
  assert.equal(metrics.byIdentity['unidic-cwj:2025.12:lemma:21903'], 1);
});

test('token boundaries prevent blind substring delegation', async () => {
  const runtime = loadAuthority();
  await runtime.initialize();
  assert.equal(runtime.preprocess('学校法人', tokenizer('学校法人')), '学校法人');
  assert.equal(runtime.preprocess('学校法人', tokenizer('学校', '法人')), '學校法人');
});

test('non-admitted ambiguous unresolved and policy-gap inputs remain untouched', async () => {
  const runtime = loadAuthority();
  await runtime.initialize();
  const input = '今日 思う 買う 合う 未知語 味わおう';
  const actual = runtime.preprocess(input, tokenizer('今日', '思う', '買う', '合う', '未知語', '味わおう'));
  assert.equal(actual, input);
  assert.equal(runtime.metrics().delegated, 0);
});

test('identity mismatch and non-resolved core states fail closed', async () => {
  const fakeBundle = {
    resolveUnit(surface) {
      if (surface === '学校') return { kind: 'resolved', lexicalIdentity: 'wrong:identity' };
      if (surface === '台風') return { kind: 'candidates', lexicalIdentity: null };
      return { kind: 'unresolved' };
    },
    render() { return '危険'; }
  };
  const runtime = loadAuthority({ bundle: fakeBundle });
  await runtime.initialize();
  assert.equal(runtime.preprocess('学校 台風', tokenizer('学校', '台風')), '学校 台風');
  assert.equal(runtime.metrics().delegated, 0);
});

test('loader tokenizer and token-alignment failures preserve original source', async () => {
  const loadFailure = loadAuthority({ loadError: new Error('resolver unavailable') });
  await assert.rejects(() => loadFailure.initialize(), /resolver unavailable/);
  assert.equal(loadFailure.preprocess('学校', tokenizer('学校')), '学校');

  const runtime = loadAuthority();
  await runtime.initialize();
  assert.equal(runtime.preprocess('学校', null), '学校');
  assert.equal(runtime.preprocess('学校', { tokenize() { throw new Error('tokenizer failed'); } }), '学校');
  assert.equal(runtime.preprocess('学校', tokenizer('不存在')), '学校');
});

test('authority runtime retains aggregate provenance only, not raw source text', async () => {
  const runtime = loadAuthority();
  await runtime.initialize();
  runtime.preprocess('学校', tokenizer('学校'));
  assert.equal(typeof runtime.observations, 'undefined');
  assert.equal(typeof runtime.history, 'undefined');
  assert.equal(runtime.status().ready, true);
});

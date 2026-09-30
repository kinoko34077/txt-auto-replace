import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const JSON5 = require(path.join(ROOT, 'lib', 'json5.min.js'));
const kuromoji = require(path.join(ROOT, 'lib', 'kuromoji.js'));
const TransformEngine = require(path.join(ROOT, 'transform-engine.js'));

function source(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function loadRuntime({ authority, engine }) {
  const runtimeSource = source('authoring-playground-runtime.js');
  const sandbox = {
    OrthographyAuthorityRuntime: authority,
    TransformEngine: engine,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(runtimeSource, sandbox, { filename: 'authoring-playground-runtime.js' });
  return sandbox.AuthoringPlaygroundRuntime;
}

function fakeTokenizer() {
  return { tokenize(text) { return [{ surface_form: text }]; } };
}

function loadRealAuthority() {
  const resolverSandbox = {};
  resolverSandbox.globalThis = resolverSandbox;
  vm.runInNewContext(source('transform-shared.js'), resolverSandbox, { filename: 'transform-shared.js' });
  for (const file of [
    'lexical-runtime.js',
    'historical-native-runtime.js',
    'historical-sino-runtime.js',
    'safe-character-runtime.js'
  ]) {
    vm.runInNewContext(source(`orthography-core/runtime/${file}`), resolverSandbox, { filename: file });
  }
  vm.runInNewContext(source('orthography-core/runtime/orthography-resolver.js'), resolverSandbox, { filename: 'orthography-resolver.js' });
  vm.runInNewContext(source('orthography-core/runtime/resolver-bundle-runtime.js'), resolverSandbox, { filename: 'resolver-bundle-runtime.js' });
  const artifact = JSON.parse(source('orthography-core/resolver-bundle.json'));
  const bundle = resolverSandbox.ResolverBundleRuntime.createResolverBundle(artifact);

  const authoritySandbox = {
    OrthographyResolverLoader: {
      async load() { return bundle; },
      snapshot() { return { status: 'ready' }; }
    }
  };
  authoritySandbox.globalThis = authoritySandbox;
  vm.runInNewContext(source('orthography-authority-runtime.js'), authoritySandbox, { filename: 'orthography-authority-runtime.js' });
  return authoritySandbox.OrthographyAuthorityRuntime;
}

function loadStages() {
  const manifest = JSON5.parse(source('transform-bundles.json5'));
  const bundleFiles = {};
  for (const bundle of manifest.bundles ?? []) {
    bundleFiles[bundle.id] = JSON5.parse(source(bundle.path));
  }
  return TransformEngine.loadStagesFromDefinitions(manifest, bundleFiles, {}).stages;
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: path.join(ROOT, 'dict') }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
}

test('comparison reports exact match and first mismatch deterministically', () => {
  const runtime = loadRuntime({ authority: {}, engine: {} });
  assert.equal(typeof runtime.compareText, 'function');

  const exact = runtime.compareText('學校\n颱風', '學校\r\n颱風');
  assert.equal(exact.matches, true);
  assert.equal(exact.firstDifference, null);

  const mismatch = runtime.compareText('學校\n台風', '學校\n颱風');
  assert.equal(mismatch.matches, false);
  assert.equal(mismatch.firstDifference.line, 2);
  assert.equal(mismatch.firstDifference.column, 1);
  assert.equal(mismatch.firstDifference.actual, '台');
  assert.equal(mismatch.firstDifference.expected, '颱');
});

test('authoring runtime applies resolver authority before one compiled legacy/profile pipeline and records changed stages', async () => {
  const calls = [];
  const authority = {
    async initialize() { calls.push('authority:init'); },
    preprocess(text, tokenizer) {
      calls.push(['authority:preprocess', text, tokenizer]);
      return text.replace('学校', '學校');
    },
    status() { return { ready: true, loader: { status: 'ready' } }; },
    metrics() { return { delegated: 1, fallbacks: 0, byIdentity: { school: 1 } }; },
  };
  const engine = {
    compileRuntimePlan(stages) {
      calls.push(['engine:compile', stages.map((stage) => stage.id)]);
      return { stages };
    },
    transformTextWithPlan(text, plan, tokenizer, options) {
      calls.push(['engine:transform', text, plan.stages.length, tokenizer]);
      options.debugCollector({ phase: 'stage-result', stageId: 'profile-style', stageKind: 'dictionary-rules', before: text, after: `${text}｡` });
      return `${text}｡`;
    },
  };

  const runtimeApi = loadRuntime({ authority, engine });
  const tokenizer = fakeTokenizer();
  const runtime = runtimeApi.createAuthoringRuntime({ stages: [{ id: 'profile-style' }], tokenizer });
  const init = await runtime.initialize();
  assert.equal(init.resolverReady, true);

  const result = runtime.transform('学校', { expected: '學校｡' });
  assert.equal(result.coreOutput, '學校');
  assert.equal(result.output, '學校｡');
  assert.equal(result.comparison.matches, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.stageTrace)), [{
    stageId: 'profile-style',
    stageKind: 'dictionary-rules',
    before: '學校',
    after: '學校｡',
  }]);
  assert.equal(calls[0][0], 'engine:compile');
  assert.equal(calls[1], 'authority:init');
  assert.equal(calls[2][0], 'authority:preprocess');
  assert.equal(calls[3][0], 'engine:transform');
});

test('resolver initialization failure fails closed while legacy/profile transformation remains usable', async () => {
  const authority = {
    async initialize() { throw new Error('resolver unavailable'); },
    preprocess(text) { return `MUST-NOT-RUN:${text}`; },
    status() { return { ready: false, loader: { status: 'error' } }; },
    metrics() { return { delegated: 0, fallbacks: 0, byIdentity: {} }; },
  };
  const engine = {
    compileRuntimePlan(stages) { return { stages }; },
    transformTextWithPlan(text, plan, tokenizer, options) {
      options.debugCollector({ phase: 'stage-result', stageId: 'legacy', stageKind: 'dictionary-rules', before: text, after: '奇蹟' });
      return '奇蹟';
    },
  };

  const runtimeApi = loadRuntime({ authority, engine });
  const runtime = runtimeApi.createAuthoringRuntime({ stages: [{ id: 'legacy' }], tokenizer: fakeTokenizer() });
  const init = await runtime.initialize();
  assert.equal(init.resolverReady, false);
  assert.match(init.resolverError, /resolver unavailable/);

  const result = runtime.transform('奇跡');
  assert.equal(result.coreOutput, '奇跡');
  assert.equal(result.output, '奇蹟');
  assert.equal(result.resolver.ready, false);
});

test('real local authoring pipeline transforms a representative mixed sentence end to end', async () => {
  const tokenizer = await buildTokenizer();
  const runtimeApi = loadRuntime({ authority: loadRealAuthority(), engine: TransformEngine });
  const runtime = runtimeApi.createAuthoringRuntime({ stages: loadStages(), tokenizer });
  const init = await runtime.initialize();
  assert.equal(init.resolverReady, true);

  const input = '学校の台風。それをやっぱり分かることは奇跡だ。';
  const expected = '學校の颱風｡其を矢ッ張分るヿは奇蹟だ｡';
  const result = runtime.transform(input, { expected });

  assert.equal(result.coreOutput, '學校の颱風。それをやっぱり分かることは奇跡だ。');
  assert.equal(result.output, expected);
  assert.equal(result.comparison.matches, true);
  assert.equal(result.resolver.metrics.delta.delegated, 2);
  assert.ok(result.stageTrace.some((entry) => entry.stageId === 'surface-normalization'));
  assert.ok(result.stageTrace.some((entry) => entry.stageId === 'lexical-replacements'));
  assert.ok(result.stageTrace.some((entry) => entry.stageId === 'official-homophone-restoration'));
});

test('playground page is standalone-local and loads the real local transformation assets', () => {
  const html = fs.readFileSync(path.join(ROOT, 'playground.html'), 'utf8');
  assert.match(html, /id="sourceText"/);
  assert.match(html, /id="outputText"/);
  assert.match(html, /id="expectedText"/);
  assert.match(html, /lib\/kuromoji\.js/);
  assert.match(html, /transform-engine\.js/);
  assert.match(html, /orthography-resolver-loader\.js/);
  assert.match(html, /orthography-authority-runtime\.js/);
  assert.match(html, /authoring-playground-runtime\.js/);
  assert.match(html, /playground\.js/);
  assert.doesNotMatch(html, /api\.kinotch\.workers\.dev/);
});

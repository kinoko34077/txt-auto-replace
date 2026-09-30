import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const bridgeSource = fs.readFileSync(path.join(ROOT, 'orthography-transform-bridge.js'), 'utf8');

const loadBridge = ({ initReject = false } = {}) => {
  const observations = [];
  let initCalls = 0;
  const engine = {
    transformTextWithPlan(input) { return `${input}-legacy-plan`; },
    transformTextWithStages(input) { return `${input}-legacy-stages`; }
  };
  const sandbox = {
    TransformEngine: engine,
    OrthographyShadowRuntime: {
      initialize() {
        initCalls += 1;
        return initReject ? Promise.reject(new Error('resolver unavailable')) : Promise.resolve();
      },
      observe(sourceText, legacyOutput) {
        observations.push({ sourceText, legacyOutput });
        return { sourceText, legacyOutput };
      }
    },
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'orthography-transform-bridge.js' });
  return { sandbox, engine, observations, get initCalls() { return initCalls; } };
};

test('bridge returns legacy TransformEngine output byte-for-byte and records shadow observation', async () => {
  const runtime = loadBridge();
  await Promise.resolve();
  const actual = runtime.engine.transformTextWithPlan('学校');
  assert.equal(actual, '学校-legacy-plan');
  assert.deepEqual(runtime.observations, [{ sourceText: '学校', legacyOutput: '学校-legacy-plan' }]);
  assert.equal(runtime.initCalls, 1);
});

test('bridge wraps stages path without changing output', () => {
  const runtime = loadBridge();
  const actual = runtime.engine.transformTextWithStages('台風');
  assert.equal(actual, '台風-legacy-stages');
  assert.deepEqual(runtime.observations, [{ sourceText: '台風', legacyOutput: '台風-legacy-stages' }]);
});

test('shadow initialization failure never breaks legacy transform', async () => {
  const runtime = loadBridge({ initReject: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.engine.transformTextWithPlan('今日'), '今日-legacy-plan');
});

test('nested TransformEngine calls create one outer observation', () => {
  const observations = [];
  const engine = {
    transformTextWithStages(input) { return `${input}-inner`; },
    transformTextWithPlan(input) { return this.transformTextWithStages(`${input}-outer`); }
  };
  const sandbox = {
    TransformEngine: engine,
    OrthographyShadowRuntime: {
      initialize() { return Promise.resolve(); },
      observe(sourceText, legacyOutput) { observations.push({ sourceText, legacyOutput }); }
    },
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'orthography-transform-bridge.js' });
  assert.equal(engine.transformTextWithPlan('x'), 'x-outer-inner');
  assert.deepEqual(observations, [{ sourceText: 'x', legacyOutput: 'x-outer-inner' }]);
});

test('authority preprocessing runs before the legacy engine and shadow still observes original source', async () => {
  const observations = [];
  const preprocessed = [];
  const engine = {
    transformTextWithPlan(input) { return `${input}-legacy`; }
  };
  const sandbox = {
    TransformEngine: engine,
    OrthographyAuthorityRuntime: {
      initialize() { return Promise.resolve(); },
      preprocess(sourceText, tokenizer) {
        preprocessed.push({ sourceText, tokenizer });
        return sourceText === '学校' ? '學校' : sourceText;
      }
    },
    OrthographyShadowRuntime: {
      initialize() { return Promise.resolve(); },
      observe(sourceText, legacyOutput) { observations.push({ sourceText, legacyOutput }); }
    },
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'orthography-transform-bridge.js' });
  await Promise.resolve();
  const tokenizer = { tokenize() { return []; } };
  const actual = engine.transformTextWithPlan('学校', {}, tokenizer, {});
  assert.equal(actual, '學校-legacy');
  assert.deepEqual(preprocessed, [{ sourceText: '学校', tokenizer }]);
  assert.deepEqual(observations, [{ sourceText: '学校', legacyOutput: '學校-legacy' }]);
});

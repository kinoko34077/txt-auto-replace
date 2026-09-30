import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const bridgeSource = fs.readFileSync(path.join(ROOT, 'orthography-transform-bridge.js'), 'utf8');

const loadBridge = ({ initReject = false, authority = {} } = {}) => {
  const observations = [];
  let shadowInitCalls = 0;
  let authorityInitCalls = 0;
  let legacyCalls = 0;
  const engine = {
    transformTextWithPlan(input) { legacyCalls += 1; return `${input}-legacy-plan`; },
    transformTextWithStages(input) { legacyCalls += 1; return `${input}-legacy-stages`; }
  };
  const sandbox = {
    TransformEngine: engine,
    OrthographyShadowRuntime: {
      initialize() {
        shadowInitCalls += 1;
        return initReject ? Promise.reject(new Error('resolver unavailable')) : Promise.resolve();
      },
      observe(sourceText, legacyOutput) {
        observations.push({ sourceText, legacyOutput });
        return { sourceText, legacyOutput };
      }
    },
    OrthographyAuthorityRuntime: {
      initialize() {
        authorityInitCalls += 1;
        return initReject ? Promise.reject(new Error('resolver unavailable')) : Promise.resolve();
      },
      resolve(sourceText) { return authority[sourceText] ?? null; }
    },
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'orthography-transform-bridge.js' });
  return {
    sandbox,
    engine,
    observations,
    get shadowInitCalls() { return shadowInitCalls; },
    get authorityInitCalls() { return authorityInitCalls; },
    get legacyCalls() { return legacyCalls; }
  };
};

test('non-admitted input returns legacy output byte-for-byte and records shadow observation', async () => {
  const runtime = loadBridge();
  await Promise.resolve();
  const actual = runtime.engine.transformTextWithPlan('今日');
  assert.equal(actual, '今日-legacy-plan');
  assert.deepEqual(runtime.observations, [{ sourceText: '今日', legacyOutput: '今日-legacy-plan' }]);
  assert.equal(runtime.legacyCalls, 1);
  assert.equal(runtime.shadowInitCalls, 1);
  assert.equal(runtime.authorityInitCalls, 1);
});

test('admitted exact unit bypasses legacy and returns resolver output', () => {
  const runtime = loadBridge({
    authority: {
      学校: { sourceText: '学校', lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098', output: '學校', authority: 'japanese-orthography-resolver' },
      台風: { sourceText: '台風', lexicalIdentity: 'unidic-cwj:2025.12:lemma:21903', output: '颱風', authority: 'japanese-orthography-resolver' }
    }
  });
  assert.equal(runtime.engine.transformTextWithPlan('学校'), '學校');
  assert.equal(runtime.engine.transformTextWithStages('台風'), '颱風');
  assert.equal(runtime.legacyCalls, 0);
  assert.deepEqual(runtime.observations, []);
});

test('authority initialization failure never breaks legacy transform', async () => {
  const runtime = loadBridge({ initReject: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.engine.transformTextWithPlan('今日'), '今日-legacy-plan');
  assert.equal(runtime.legacyCalls, 1);
});

test('nested TransformEngine calls create one outer fallback observation', () => {
  const observations = [];
  let nestingLegacyCalls = 0;
  const engine = {
    transformTextWithStages(input) { nestingLegacyCalls += 1; return `${input}-inner`; },
    transformTextWithPlan(input) { nestingLegacyCalls += 1; return this.transformTextWithStages(`${input}-outer`); }
  };
  const sandbox = {
    TransformEngine: engine,
    OrthographyShadowRuntime: {
      initialize() { return Promise.resolve(); },
      observe(sourceText, legacyOutput) { observations.push({ sourceText, legacyOutput }); }
    },
    OrthographyAuthorityRuntime: {
      initialize() { return Promise.resolve(); },
      resolve() { return null; }
    },
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'orthography-transform-bridge.js' });
  assert.equal(engine.transformTextWithPlan('x'), 'x-outer-inner');
  assert.equal(nestingLegacyCalls, 2);
  assert.deepEqual(observations, [{ sourceText: 'x', legacyOutput: 'x-outer-inner' }]);
});

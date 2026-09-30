import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const bridgeSource = fs.readFileSync(path.join(ROOT, 'kinotch-profile-style-bridge.js'), 'utf8');

function loadBridge({ composeThrows = false } = {}) {
  const calls = [];
  const originalStages = [{ id: 'lexical-replacements', rules: [{ from: 'こと', to: 'ヿ' }] }];
  const composedStages = [{ id: 'kinotch-token-style', rules: [{ from: 'こと', to: 'ヿ' }] }];
  const engine = {
    loadStagesFromDefinitions(...args) {
      calls.push(['load', ...args]);
      return { stages: originalStages, bundles: ['original'], stringRuleCount: 1, tokenRuleCount: 1 };
    }
  };
  const profile = {
    status() { return { ready: true }; },
    composeStages(stages) {
      calls.push(['compose', stages]);
      if (composeThrows) throw new Error('profile compose failed');
      return composedStages;
    }
  };
  const sandbox = { TransformEngine: engine, KinotchProfileStyleRuntime: profile, Promise };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'kinotch-profile-style-bridge.js' });
  return { engine, calls, originalStages, composedStages };
}

test('shared bridge composes verified profile stages for every TransformEngine stage load', () => {
  const runtime = loadBridge();
  const result = runtime.engine.loadStagesFromDefinitions({ bundles: [] }, {}, {});
  assert.strictEqual(result.stages, runtime.composedStages);
  assert.deepEqual(result.bundles, ['original']);
  assert.deepEqual(runtime.calls.map((entry) => entry[0]), ['load', 'compose']);
});

test('shared bridge fails closed to accepted local stages when profile composition fails', () => {
  const runtime = loadBridge({ composeThrows: true });
  const result = runtime.engine.loadStagesFromDefinitions({ bundles: [] }, {}, {});
  assert.strictEqual(result.stages, runtime.originalStages);
});

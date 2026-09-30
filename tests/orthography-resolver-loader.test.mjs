import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const loadRuntime = ({ fetchImpl, createResolverBundle } = {}) => {
  const sandbox = {
    fetch: fetchImpl,
    chrome: { runtime: { getURL: (value) => `chrome-extension://test/${value}` } },
    ResolverBundleRuntime: { createResolverBundle: createResolverBundle ?? ((artifact) => artifact.bundle) },
    OrthographyResolverAdapter: {
      createAdapter({ resolverBundle }) {
        return {
          evaluateWithLegacyOutput(input, legacyOutput) {
            return { sourceText: input, legacyOutput, authoritativeOutput: legacyOutput, core: { kind: 'resolved', output: resolverBundle.output }, classification: legacyOutput === resolverBundle.output ? 'legacy-changed/core-resolved' : 'legacy-output!=core-output' };
          }
        };
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source('orthography-resolver-loader.js'), sandbox, { filename: 'orthography-resolver-loader.js' });
  vm.runInNewContext(source('orthography-shadow-runtime.js'), sandbox, { filename: 'orthography-shadow-runtime.js' });
  return sandbox;
};

test('resolver loader fetches packaged artifact and activates atomically', async () => {
  const calls = [];
  const sandbox = loadRuntime({
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, async json() { return { bundle: { output: '學校' } }; } };
    }
  });
  const bundle = await sandbox.OrthographyResolverLoader.load();
  assert.equal(bundle.output, '學校');
  assert.deepEqual(calls, ['chrome-extension://test/orthography-core/resolver-bundle.json']);
  assert.equal(sandbox.OrthographyResolverLoader.snapshot().status, 'ready');
});

test('resolver loader fails closed and exposes error state', async () => {
  const sandbox = loadRuntime({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(() => sandbox.OrthographyResolverLoader.load(), /fetch failed: 404/);
  const status = sandbox.OrthographyResolverLoader.snapshot();
  assert.equal(status.status, 'error');
  assert.equal(status.bundle, null);
});

test('shadow runtime uses precomputed legacy output and retains aggregate metrics only', async () => {
  const sandbox = loadRuntime({ fetchImpl: async () => ({ ok: true, async json() { return { bundle: { output: '學校' } }; } }) });
  await sandbox.OrthographyShadowRuntime.initialize();
  const result = sandbox.OrthographyShadowRuntime.observe('学校', '學校');
  assert.equal(result.authoritativeOutput, '學校');
  assert.equal(result.core.output, '學校');
  assert.equal(sandbox.OrthographyShadowRuntime.status().ready, true);
  assert.equal(sandbox.OrthographyShadowRuntime.status().observations, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.OrthographyShadowRuntime.metrics())), {
    total: 1,
    classifications: { 'legacy-changed/core-resolved': 1 }
  });
  assert.equal(typeof sandbox.OrthographyShadowRuntime.observations, 'undefined', 'raw page text history must not be retained/exposed');
});

test('shadow runtime is a no-op before resolver activation and clear resets aggregate metrics', () => {
  const sandbox = loadRuntime();
  assert.equal(sandbox.OrthographyShadowRuntime.observe('学校', '學校'), null);
  assert.equal(sandbox.OrthographyShadowRuntime.metrics().total, 0);
  sandbox.OrthographyShadowRuntime.clear();
  assert.equal(sandbox.OrthographyShadowRuntime.metrics().total, 0);
});

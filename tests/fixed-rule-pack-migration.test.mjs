import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const JSON5 = require(path.join(ROOT_DIR, 'lib', 'json5.min.js'));
const kuromoji = require(path.join(ROOT_DIR, 'lib', 'kuromoji.js'));
const TransformEngine = require(path.join(ROOT_DIR, 'transform-engine.js'));

const CORE_SHA = '671e5e58a39e925653389e5547a7316ca51ec57f';
const LOCK_PATH = path.join(ROOT_DIR, 'transforms', 'kinotch-fixed-source-lock.json');

class LocalFileXMLHttpRequest {
  open(method, url) {
    this.method = method;
    this.url = url;
    this.responseType = 'arraybuffer';
  }

  send() {
    fs.readFile(this.url, (error, buffer) => {
      if (error) {
        this.status = 404;
        this.statusText = error.message;
        if (typeof this.onerror === 'function') this.onerror(error);
        return;
      }
      this.status = 200;
      this.statusText = 'OK';
      this.response = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      if (typeof this.onload === 'function') this.onload();
    });
  }
}

global.XMLHttpRequest = LocalFileXMLHttpRequest;

const parseJson5File = (filePath) => JSON5.parse(fs.readFileSync(filePath, 'utf8'));

const loadStages = () => {
  const manifest = parseJson5File(path.join(ROOT_DIR, 'transform-bundles.json5'));
  const bundleFiles = {};
  for (const bundle of manifest.bundles || []) {
    bundleFiles[bundle.id] = parseJson5File(path.join(ROOT_DIR, bundle.path));
  }
  return TransformEngine.loadStagesFromDefinitions(manifest, bundleFiles, {}).stages;
};

const buildTokenizer = () => new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: path.join(ROOT_DIR, 'dict') }).build((error, tokenizer) => {
    if (error) reject(error);
    else resolve(tokenizer);
  });
});

const transform = (input, stages, tokenizer, activeBundles) => {
  const activeSet = new Set(activeBundles);
  const selected = stages.filter((stage) => activeSet.has(stage.id));
  const plan = TransformEngine.compileRuntimePlan(selected, { revision: 1 });
  return TransformEngine.transformTextWithPlan(input, plan, tokenizer, {});
};

test('generated fixed rule packs are locked to the accepted merged core artifact', () => {
  const verify = spawnSync(process.execPath, ['tools/verify_generated_rule_packs.js'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout || 'generated rule-pack verification failed');

  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  assert.equal(lock.coreCommit, CORE_SHA);
  assert.equal(lock.profileId, 'kinotch-fixed');
  assert.equal(lock.canonicalSourceDigest, 'cd3bc74e9daa4fb5a40f2f5962bb4263187aaaf6b9bfc206732993dcc6ccdf69');
  assert.equal(lock.sourceSetDigest, 'df96296fedabfe0355c6c799b5eaf538d2f35923467ee9d4c1bfbe6b276e7acd');
});

test('generated snapshots preserve existing loader/runtime behavior', async () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  assert.equal(lock.coreCommit, CORE_SHA);

  const tokenizer = await buildTokenizer();
  const stages = loadStages();
  const cases = [
    {
      id: 'legacy-school',
      input: '学校',
      expected: '學校',
      bundles: ['legacy-kanji'],
    },
    {
      id: 'official-kiseki',
      input: '奇跡',
      expected: '奇蹟',
      bundles: ['official-homophone-restoration'],
    },
    {
      id: 'official-multi-target',
      input: '興奮',
      expectedAny: ['昂奮', '亢奮'],
      bundles: ['official-homophone-restoration'],
    },
    {
      id: 'project-multi-target',
      input: 'ドイツ',
      expectedAny: ['独逸', '独乙'],
      bundles: ['homophone-kanji'],
    },
    {
      id: 'legacy-ben',
      input: '弁護',
      expected: '辨護',
      bundles: ['legacy-kanji'],
    },
    {
      id: 'stage-order',
      input: '学校の奇跡。',
      expected: '學校の奇蹟｡',
      bundles: ['surface-normalization', 'legacy-kanji', 'official-homophone-restoration'],
    },
  ];

  for (const item of cases) {
    const actual = transform(item.input, stages, tokenizer, item.bundles);
    if (item.expectedAny) {
      assert.ok(item.expectedAny.includes(actual), `${item.id}: ${actual}`);
    } else {
      assert.equal(actual, item.expected, item.id);
    }
  }
});

test('Phase 4.5B consumer packages the accepted source-locked token-style overlay', () => {
  const required = [
    'transforms/kinotch-token-style/source-lock.json',
    'transforms/kinotch-token-style/manifest.json',
    'transforms/kinotch-token-style/20-kinotch-token-style.json5',
  ];
  const missing = required.filter((relativePath) => !fs.existsSync(path.join(ROOT_DIR, relativePath)));
  assert.deepEqual(missing, [], `missing source-locked token-style package: ${missing.join(', ')}`);
});

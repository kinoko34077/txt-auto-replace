import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const JSON5 = require(path.join(ROOT_DIR, 'lib', 'json5.min.js'));
const kuromoji = require(path.join(ROOT_DIR, 'lib', 'kuromoji.js'));
const TransformEngine = require(path.join(ROOT_DIR, 'transform-engine.js'));

const CORE_SHA = '671e5e58a39e925653389e5547a7316ca51ec57f';
const LOCK_PATH = path.join(ROOT_DIR, 'transforms', 'kinotch-fixed-source-lock.json');
const TOKEN_STYLE_UPSTREAM_SHA = '5dea2af61646949227c1191886febb6800b12796';
const TOKEN_STYLE_CANONICAL_SOURCE_DIGEST = '0f0d2b4699ad040977fcaf47d528bb5b387515a42edd77e07bad8ebb53b7f877';
const TOKEN_STYLE_ARTIFACT_GENERATION = '574f0deeface6dcf8348ef57d42c38a2c2323bce421992676aad2058bb7c6cd1';
const TOKEN_STYLE_BUNDLE_SHA256 = 'c3d1f58309b2060d37591ece438fdc3d047025b03d4398ca4f219737b7f424d1';
const TOKEN_STYLE_MANIFEST_SHA256 = '8eb4a459a1f5de0f2195956f6d3e21ec223fac769d463a709a1711903fc20d6e';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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
  const packageDir = path.join(ROOT_DIR, 'transforms', 'kinotch-token-style');
  const lockPath = path.join(packageDir, 'source-lock.json');
  const manifestPath = path.join(packageDir, 'manifest.json');
  const bundlePath = path.join(packageDir, '20-kinotch-token-style.json5');
  const required = [lockPath, manifestPath, bundlePath];
  const missing = required.filter((filePath) => !fs.existsSync(filePath));
  assert.deepEqual(
    missing,
    [],
    `missing source-locked token-style package: ${missing.map((filePath) => path.relative(ROOT_DIR, filePath)).join(', ')}`,
  );

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(lock.schemaVersion, '1');
  assert.equal(lock.kind, 'kinotch-token-style-consumer-package');
  assert.equal(lock.sourceRepository, 'kinoko34077/japanese-orthography');
  assert.equal(lock.coreCommit, TOKEN_STYLE_UPSTREAM_SHA);
  assert.equal(lock.sourcePath, 'data/profiles/kinotch/token-style-overlay.json');
  assert.equal(lock.sourceBlobSha, 'e965b04e48c324a06ea6c42c4c551a567817ca28');
  assert.equal(lock.profileId, 'kinotch-authoring');
  assert.equal(lock.authority, 'project_profile');
  assert.equal(lock.responsibility, 'style_render');
  assert.equal(lock.genericSafety, 'not_implied');
  assert.equal(lock.buildSourceIdentity, 'canonical-content-addressed');
  assert.equal(lock.canonicalSourceDigest, TOKEN_STYLE_CANONICAL_SOURCE_DIGEST);
  assert.equal(lock.artifactGeneration, TOKEN_STYLE_ARTIFACT_GENERATION);

  const manifestBuffer = fs.readFileSync(manifestPath);
  const bundleBuffer = fs.readFileSync(bundlePath);
  assert.equal(manifestBuffer.byteLength, 884);
  assert.equal(sha256(manifestBuffer), TOKEN_STYLE_MANIFEST_SHA256);
  assert.equal(bundleBuffer.byteLength, 214);
  assert.equal(sha256(bundleBuffer), TOKEN_STYLE_BUNDLE_SHA256);

  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  assert.equal(manifest.artifactSchemaVersion, '1');
  assert.equal(manifest.profileId, 'kinotch-authoring');
  assert.equal(manifest.authority, 'project_profile');
  assert.equal(manifest.responsibility, 'style_render');
  assert.equal(manifest.genericSafety, 'not_implied');
  assert.equal(manifest.packId, 'token-style');
  assert.equal(manifest.buildSourceIdentity, 'canonical-content-addressed');
  assert.equal(manifest.canonicalSourceDigest, TOKEN_STYLE_CANONICAL_SOURCE_DIGEST);
  assert.equal(manifest.artifactGeneration, TOKEN_STYLE_ARTIFACT_GENERATION);
  assert.deepEqual(manifest.adoptedSource, {
    repository: 'kinoko34077/txt-auto-replace',
    commit: '48ceade01db46af3fad7acfb8743c3d841885c33',
    path: 'transforms/20-lexical-replacements.json5',
    blobSha: '32d4acff7532b5dd21d0bab1d1ba414298f27687',
  });
  assert.deepEqual(manifest.files, [{
    path: '20-kinotch-token-style.json5',
    payloadDigest: TOKEN_STYLE_BUNDLE_SHA256,
    byteLength: 214,
  }]);

  assert.deepEqual(JSON.parse(bundleBuffer.toString('utf8')), {
    id: 'kinotch-token-style',
    label: 'KiNoTch. token style',
    kind: 'token-rules',
    rules: [{ from: 'こと', to: 'ヿ', type: 'literal', priority: 100 }],
  });
});

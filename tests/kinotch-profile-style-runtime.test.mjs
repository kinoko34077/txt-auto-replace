import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const JSON5 = require(path.join(ROOT, 'lib', 'json5.min.js'));
const TransformEngine = require(path.join(ROOT, 'transform-engine.js'));

const EXPECTED = Object.freeze({
  upstreamCommit: '5dea2af61646949227c1191886febb6800b12796',
  canonicalSourceDigest: '0f0d2b4699ad040977fcaf47d528bb5b387515a42edd77e07bad8ebb53b7f877',
  artifactGeneration: '574f0deeface6dcf8348ef57d42c38a2c2323bce421992676aad2058bb7c6cd1',
  payloadSha256: 'c3d1f58309b2060d37591ece438fdc3d047025b03d4398ca4f219737b7f424d1',
  payloadByteLength: 214,
  manifestSha256: '8eb4a459a1f5de0f2195956f6d3e21ec223fac769d463a709a1711903fc20d6e',
  manifestByteLength: 884
});

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function loadRuntimeModule() {
  return require(path.join(ROOT, 'kinotch-profile-style-runtime.js'));
}

function fakeTokenizerFor(source) {
  const surfaces = source === 'こと'
    ? ['こと']
    : source === 'ことごと'
      ? ['ことごと']
      : source === '学校のこと'
        ? ['学校', 'の', 'こと']
        : [source];
  return {
    tokenize() {
      return surfaces.map((surface_form) => ({ surface_form }));
    }
  };
}

function acceptedArtifact() {
  return {
    manifest: {
      artifactSchemaVersion: '1',
      profileId: 'kinotch-authoring',
      authority: 'project_profile',
      responsibility: 'style_render',
      genericSafety: 'not_implied',
      packId: 'token-style',
      buildSourceIdentity: 'canonical-content-addressed',
      artifactGeneration: EXPECTED.artifactGeneration,
      canonicalSourceDigest: EXPECTED.canonicalSourceDigest,
      adoptedSource: {
        repository: 'kinoko34077/txt-auto-replace',
        commit: '48ceade01db46af3fad7acfb8743c3d841885c33',
        path: 'transforms/20-lexical-replacements.json5',
        blobSha: '32d4acff7532b5dd21d0bab1d1ba414298f27687'
      },
      files: [{
        path: '20-kinotch-token-style.json5',
        payloadDigest: EXPECTED.payloadSha256,
        byteLength: EXPECTED.payloadByteLength
      }]
    },
    bundle: {
      id: 'kinotch-token-style',
      label: 'KiNoTch. token style',
      kind: 'token-rules',
      rules: [{ from: 'こと', to: 'ヿ', type: 'literal', priority: 100 }]
    }
  };
}

function loadConsumerStages() {
  const manifest = JSON5.parse(fs.readFileSync(path.join(ROOT, 'transform-bundles.json5'), 'utf8'));
  const bundleFiles = {};
  for (const definition of manifest.bundles ?? []) {
    bundleFiles[definition.id] = JSON5.parse(fs.readFileSync(path.join(ROOT, definition.path), 'utf8'));
  }
  return TransformEngine.loadStagesFromDefinitions(manifest, bundleFiles, {}).stages;
}

test('committed token-style snapshot is pinned to exact accepted upstream generation', () => {
  const lockPath = path.join(ROOT, 'profiles', 'kinotch-token-style', 'source-lock.json');
  const manifestPath = path.join(ROOT, 'profiles', 'kinotch-token-style', 'manifest.json');
  const payloadPath = path.join(ROOT, 'profiles', 'kinotch-token-style', '20-kinotch-token-style.json5');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const manifestBytes = fs.readFileSync(manifestPath);
  const payloadBytes = fs.readFileSync(payloadPath);

  assert.equal(lock.sourceRepository, 'kinoko34077/japanese-orthography');
  assert.equal(lock.upstreamCommit, EXPECTED.upstreamCommit);
  assert.equal(lock.artifactGeneration, EXPECTED.artifactGeneration);
  assert.equal(lock.canonicalSourceDigest, EXPECTED.canonicalSourceDigest);
  assert.equal(lock.files.manifest.sha256, EXPECTED.manifestSha256);
  assert.equal(lock.files.payload.sha256, EXPECTED.payloadSha256);
  assert.equal(manifestBytes.byteLength, EXPECTED.manifestByteLength);
  assert.equal(payloadBytes.byteLength, EXPECTED.payloadByteLength);
  assert.equal(sha256(manifestBytes), EXPECTED.manifestSha256);
  assert.equal(sha256(payloadBytes), EXPECTED.payloadSha256);
});

test('verified project style overlay transforms only exact こと tokens', async () => {
  const api = loadRuntimeModule();
  const runtime = api.createProfileStyleRuntime({
    loadArtifact: async () => acceptedArtifact()
  });
  await runtime.initialize();

  assert.equal(runtime.preprocess('こと', fakeTokenizerFor('こと')), 'ヿ');
  assert.equal(runtime.preprocess('ことごと', fakeTokenizerFor('ことごと')), 'ことごと');
  assert.equal(runtime.preprocess('学校のこと', fakeTokenizerFor('学校のこと')), '学校のヿ');
  assert.equal(runtime.metrics().delegated, 2);
  assert.equal(runtime.status().ready, true);
});

test('verified stage composition transfers only こと authority out of the local lexical stage', async () => {
  const api = loadRuntimeModule();
  const runtime = api.createProfileStyleRuntime({ loadArtifact: async () => acceptedArtifact() });
  await runtime.initialize();

  const originalStages = loadConsumerStages();
  const composed = runtime.composeStages(originalStages);
  const lexical = composed.find((stage) => stage.id === 'lexical-replacements');
  const profile = composed.find((stage) => stage.id === 'kinotch-token-style');

  assert.ok(lexical);
  assert.ok(profile);
  assert.equal(lexical.rules.some((rule) => rule.from === 'こと' && rule.to === 'ヿ'), false);
  assert.equal(lexical.rules.some((rule) => rule.from === 'それ' && rule.to === '其'), true);
  assert.deepEqual(
    profile.rules.map(({ from, to, type, priority }) => ({ from, to, type, priority })),
    [{ from: 'こと', to: 'ヿ', type: 'literal', priority: 100 }]
  );
  assert.equal(
    composed.flatMap((stage) => stage.rules ?? []).filter((rule) => rule.from === 'こと' && rule.to === 'ヿ').length,
    1
  );
  assert.equal(
    TransformEngine.transformTextWithStages('こと', composed, fakeTokenizerFor('こと')),
    'ヿ'
  );
});

test('profile initialization failure leaves source unchanged so accepted local stage remains fallback', async () => {
  const api = loadRuntimeModule();
  const runtime = api.createProfileStyleRuntime({
    loadArtifact: async () => { throw new Error('profile identity mismatch'); }
  });
  await assert.rejects(runtime.initialize(), /profile identity mismatch/);

  const tokenizer = fakeTokenizerFor('こと');
  const source = runtime.preprocess('こと', tokenizer);
  assert.equal(source, 'こと');
  assert.equal(runtime.status().ready, false);

  const stages = loadConsumerStages();
  assert.strictEqual(runtime.composeStages(stages), stages);
  assert.equal(TransformEngine.transformTextWithStages(source, stages, tokenizer), 'ヿ');
});

test('malformed or wrong-identity artifact is rejected before activation', async () => {
  const api = loadRuntimeModule();
  const artifact = acceptedArtifact();
  artifact.manifest.artifactGeneration = '0'.repeat(64);
  const runtime = api.createProfileStyleRuntime({ loadArtifact: async () => artifact });
  await assert.rejects(runtime.initialize(), /artifact generation/i);
  assert.equal(runtime.preprocess('こと', fakeTokenizerFor('こと')), 'こと');
});

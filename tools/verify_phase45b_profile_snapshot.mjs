import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(ROOT, 'profiles', 'kinotch-token-style');
const EXPECTED_UPSTREAM = '5dea2af61646949227c1191886febb6800b12796';
const EXPECTED_GENERATION = '574f0deeface6dcf8348ef57d42c38a2c2323bce421992676aad2058bb7c6cd1';
const EXPECTED_SOURCE_DIGEST = '0f0d2b4699ad040977fcaf47d528bb5b387515a42edd77e07bad8ebb53b7f877';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lock = JSON.parse(fs.readFileSync(path.join(DIR, 'source-lock.json'), 'utf8'));
const manifestBytes = fs.readFileSync(path.join(DIR, lock.files.manifest.path));
const payloadBytes = fs.readFileSync(path.join(DIR, lock.files.payload.path));
const browserBytes = fs.readFileSync(path.join(DIR, lock.files.browserArtifact.path));

assert.equal(lock.sourceRepository, 'kinoko34077/japanese-orthography');
assert.equal(lock.upstreamCommit, EXPECTED_UPSTREAM);
assert.equal(lock.artifactGeneration, EXPECTED_GENERATION);
assert.equal(lock.canonicalSourceDigest, EXPECTED_SOURCE_DIGEST);
for (const [key, bytes] of [['manifest', manifestBytes], ['payload', payloadBytes], ['browserArtifact', browserBytes]]) {
  assert.equal(bytes.byteLength, lock.files[key].byteLength, `${key} byte length drift`);
  assert.equal(sha256(bytes), lock.files[key].sha256, `${key} digest drift`);
}

const manifest = JSON.parse(manifestBytes.toString('utf8'));
const bundle = JSON.parse(payloadBytes.toString('utf8'));
assert.equal(manifest.artifactGeneration, EXPECTED_GENERATION);
assert.equal(manifest.canonicalSourceDigest, EXPECTED_SOURCE_DIGEST);
assert.equal(manifest.files.length, 1);
assert.equal(manifest.files[0].payloadDigest, lock.files.payload.sha256);
assert.equal(manifest.files[0].byteLength, lock.files.payload.byteLength);

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(browserBytes.toString('utf8'), sandbox, { filename: 'profiles/kinotch-token-style/artifact.js' });
assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.KinotchTokenStyleArtifact)),
  { manifest, bundle },
  'browser artifact must package the exact verified manifest and payload'
);

process.stdout.write(`${JSON.stringify({ upstreamCommit: lock.upstreamCommit, artifactGeneration: lock.artifactGeneration, canonicalSourceDigest: lock.canonicalSourceDigest })}\n`);

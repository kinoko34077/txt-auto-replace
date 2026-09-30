import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SNAPSHOT_ROOT = path.join(ROOT, 'orthography-core');
const EXPECTED_CORE = '21f4cb0d0fcf29a6327a7ac36a54bd41f524079c';

const sha256 = (payload) => createHash('sha256').update(payload).digest('hex');
const gitBlob = (payload) => createHash('sha1')
  .update(Buffer.from(`blob ${payload.byteLength}\0`))
  .update(payload)
  .digest('hex');

const lock = JSON.parse(await readFile(path.join(SNAPSHOT_ROOT, 'source-lock.json'), 'utf8'));
assert.equal(lock.schemaVersion, '1');
assert.equal(lock.kind, 'japanese-orthography-resolver-consumer-snapshot');
assert.equal(lock.sourceRepository, 'kinoko34077/japanese-orthography');
assert.equal(lock.coreCommit, EXPECTED_CORE);

const artifactBytes = await readFile(path.join(SNAPSHOT_ROOT, lock.artifact.path));
assert.equal(artifactBytes.byteLength, lock.artifact.byteLength, 'resolver artifact byte length');
assert.equal(sha256(artifactBytes), lock.artifact.sha256, 'resolver artifact SHA-256');
const artifact = JSON.parse(artifactBytes.toString('utf8'));
assert.equal(artifact.bundleContentId, lock.bundleContentId);
assert.equal(artifact.lexicalArtifact.lexicalNamespaceId, lock.lexicalNamespaceId);

assert.deepEqual(lock.externalRuntimeDependencies, [{
  consumerPath: 'transform-shared.js',
  upstreamPath: 'runtime/transform-shared.js',
  gitBlob: '24518621cb7816f8daee6bc67911a14bed74cac6'
}]);
const sharedBytes = await readFile(path.join(ROOT, lock.externalRuntimeDependencies[0].consumerPath));
assert.equal(gitBlob(sharedBytes), lock.externalRuntimeDependencies[0].gitBlob, 'external TransformShared blob');

const expectedOrder = [
  'runtime/lexical-runtime.js',
  'runtime/historical-native-runtime.js',
  'runtime/historical-sino-runtime.js',
  'runtime/safe-character-runtime.js',
  'runtime/orthography-resolver.js',
  'runtime/resolver-bundle-runtime.js'
];
assert.deepEqual(lock.runtimeFiles.map((entry) => entry.upstreamPath), expectedOrder);

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(sharedBytes.toString('utf8'), sandbox, { filename: 'transform-shared.js' });
for (const entry of lock.runtimeFiles) {
  const bytes = await readFile(path.join(SNAPSHOT_ROOT, entry.path));
  assert.equal(bytes.byteLength, entry.byteLength, `${entry.path} byteLength`);
  assert.equal(sha256(bytes), entry.sha256, `${entry.path} SHA-256`);
  assert.equal(gitBlob(bytes), entry.gitBlob, `${entry.path} Git blob`);
  vm.runInNewContext(bytes.toString('utf8'), sandbox, { filename: entry.path });
}

const bundle = sandbox.ResolverBundleRuntime.createResolverBundle(artifact);
assert.equal(bundle.bundleContentId, lock.bundleContentId);
assert.equal(bundle.render(bundle.resolveUnit('学校'), { mode: 'plain' }), '學校');
assert.equal(bundle.render(bundle.resolveUnit('台風'), { mode: 'plain' }), '颱風');
assert.equal(bundle.resolveUnit('今日').kind, 'candidates');
assert.equal(bundle.resolveUnit('未知語').kind, 'unresolved');

console.log(JSON.stringify({
  coreCommit: lock.coreCommit,
  bundleContentId: lock.bundleContentId,
  lexicalNamespaceId: lock.lexicalNamespaceId,
  runtimeFiles: lock.runtimeFiles.length
}));

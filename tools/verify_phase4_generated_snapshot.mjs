import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SNAPSHOT = path.resolve(process.argv[2] ?? path.join(ROOT, 'phase4-generated'));
const EXPECTED_CORE = '21f4cb0d0fcf29a6327a7ac36a54bd41f524079c';
const require = createRequire(import.meta.url);
const JSON5 = require(path.join(ROOT, 'lib', 'json5.min.js'));
const kuromoji = require(path.join(ROOT, 'lib', 'kuromoji.js'));
const TransformEngine = require(path.join(ROOT, 'transform-engine.js'));
const Adapter = require(path.join(ROOT, 'orthography-resolver-adapter.js'));

const sha256 = (payload) => createHash('sha256').update(payload).digest('hex');
const gitBlob = (payload) => createHash('sha1').update(Buffer.from(`blob ${payload.byteLength}\0`)).update(payload).digest('hex');
const parseJson5 = (filePath) => JSON5.parse(fs.readFileSync(filePath, 'utf8'));

const lock = JSON.parse(await readFile(path.join(SNAPSHOT, 'source-lock.json'), 'utf8'));
assert.equal(lock.schemaVersion, '1');
assert.equal(lock.kind, 'japanese-orthography-resolver-consumer-snapshot');
assert.equal(lock.sourceRepository, 'kinoko34077/japanese-orthography');
assert.equal(lock.coreCommit, EXPECTED_CORE);

const artifactBytes = await readFile(path.join(SNAPSHOT, lock.artifact.path));
assert.equal(artifactBytes.byteLength, lock.artifact.byteLength);
assert.equal(sha256(artifactBytes), lock.artifact.sha256);
const artifact = JSON.parse(artifactBytes.toString('utf8'));
assert.equal(artifact.bundleContentId, lock.bundleContentId);
assert.equal(artifact.lexicalArtifact.lexicalNamespaceId, lock.lexicalNamespaceId);

for (const entry of lock.runtimeFiles) {
  const payload = await readFile(path.join(SNAPSHOT, entry.path));
  assert.equal(payload.byteLength, entry.byteLength, `${entry.path} byteLength`);
  assert.equal(sha256(payload), entry.sha256, `${entry.path} sha256`);
  assert.equal(gitBlob(payload), entry.gitBlob, `${entry.path} gitBlob`);
}

assert.deepEqual(lock.externalRuntimeDependencies, [{
  consumerPath: 'transform-shared.js',
  upstreamPath: 'runtime/transform-shared.js',
  gitBlob: '24518621cb7816f8daee6bc67911a14bed74cac6'
}]);
const consumerSharedBytes = await readFile(path.join(ROOT, lock.externalRuntimeDependencies[0].consumerPath));
assert.equal(gitBlob(consumerSharedBytes), lock.externalRuntimeDependencies[0].gitBlob, 'consumer shared runtime must equal accepted upstream blob');

const runtimeBundleBytes = await readFile(path.join(SNAPSHOT, lock.runtimeBundle.path));
assert.equal(runtimeBundleBytes.byteLength, lock.runtimeBundle.byteLength);
assert.equal(sha256(runtimeBundleBytes), lock.runtimeBundle.sha256);
assert.deepEqual(lock.runtimeBundle.components, [
  'runtime/lexical-runtime.js',
  'runtime/historical-native-runtime.js',
  'runtime/historical-sino-runtime.js',
  'runtime/safe-character-runtime.js',
  'runtime/orthography-resolver.js',
  'runtime/resolver-bundle-runtime.js'
]);

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(consumerSharedBytes.toString('utf8'), sandbox, { filename: 'transform-shared.js' });
vm.runInNewContext(runtimeBundleBytes.toString('utf8'), sandbox, { filename: lock.runtimeBundle.path });
const resolverBundle = sandbox.ResolverBundleRuntime.createResolverBundle(artifact);
assert.equal(resolverBundle.bundleContentId, lock.bundleContentId);

class LocalFileXMLHttpRequest {
  open(method, url) { this.method = method; this.url = url; this.responseType = 'arraybuffer'; }
  send() {
    fs.readFile(this.url, (error, buffer) => {
      if (error) { this.status = 404; this.statusText = error.message; if (typeof this.onerror === 'function') this.onerror(error); return; }
      this.status = 200; this.statusText = 'OK'; this.response = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); if (typeof this.onload === 'function') this.onload();
    });
  }
}
global.XMLHttpRequest = LocalFileXMLHttpRequest;

const manifest = parseJson5(path.join(ROOT, 'transform-bundles.json5'));
const bundleFiles = {};
for (const definition of manifest.bundles || []) bundleFiles[definition.id] = parseJson5(path.join(ROOT, definition.path));
const stages = TransformEngine.loadStagesFromDefinitions(manifest, bundleFiles, {}).stages;
const plan = TransformEngine.compileRuntimePlan(stages, { revision: 1 });
const tokenizer = await new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: path.join(ROOT, 'dict') }).build((error, value) => error ? reject(error) : resolve(value));
});
const legacyTransform = (input) => TransformEngine.transformTextWithPlan(input, plan, tokenizer, {});
const adapter = Adapter.createAdapter({ resolverBundle, legacyTransform });

const cases = ['学校', '今日', '未知語', '台風', '思う', '味わおう', '買う', '合う'];
const results = cases.map((sourceText) => adapter.evaluate(sourceText));
const second = cases.map((sourceText) => adapter.evaluate(sourceText));
assert.deepEqual(JSON.parse(JSON.stringify(results)), JSON.parse(JSON.stringify(second)), 'shadow evidence must be deterministic');
for (const result of results) assert.equal(result.authoritativeOutput, result.legacyOutput, `${result.sourceText} legacy authority`);

const school = results.find((item) => item.sourceText === '学校');
assert.equal(school.core.trace.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
assert.equal(school.core.output, '學校');
const today = results.find((item) => item.sourceText === '今日');
assert.equal(today.core.kind, 'candidates');
const unknown = results.find((item) => item.sourceText === '未知語');
assert.equal(unknown.core.kind, 'unresolved');
const taifu = results.find((item) => item.sourceText === '台風');
assert.equal(taifu.core.trace.lexicalIdentity, 'unidic-cwj:2025.12:lemma:21903');
assert.equal(taifu.core.output, '颱風');

const evidence = {
  schemaVersion: '1',
  kind: 'txt-auto-phase4-shadow-evidence',
  upstream: { repository: lock.sourceRepository, commit: lock.coreCommit, bundleContentId: lock.bundleContentId, lexicalNamespaceId: lock.lexicalNamespaceId, runtimeBundleSha256: lock.runtimeBundle.sha256 },
  legacyAuthority: true,
  results
};
await writeFile(path.join(SNAPSHOT, 'shadow-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ upstream: evidence.upstream, classifications: results.map(({ sourceText, legacyOutput, core, classification }) => ({ sourceText, legacyOutput, coreKind: core.kind, coreOutput: core.output, classification })) }, null, 2));

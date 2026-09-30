import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const upstreamRoot = process.cwd();
const outputDir = path.resolve(process.argv[2] ?? '../phase4-generated');
const sourceRepository = 'kinoko34077/japanese-orthography';

const json = async (relativePath) => JSON.parse(await readFile(path.join(upstreamRoot, relativePath), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: upstreamRoot, encoding: 'utf8' }).trim();
const sha256File = async (filePath) => createHash('sha256').update(await readFile(filePath)).digest('hex');

const builderModule = await import(pathToFileURL(path.join(upstreamRoot, 'tools/resolver-bundle.ts')).href);
const [lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
  json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
  json('data/historical/native/kkh-kana-first-slice.json'),
  json('data/historical/sino/kkh-jion-first-slice.json'),
  json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
  json('data/packs/contextual-kanji/manifest.json'),
  json('data/packs/contextual-kanji/merged-tai.json'),
  json('data/deterministic/safe-character-first-slice.json')
]);

const artifact = builderModule.buildResolverBundleArtifact({
  lexicalSource,
  nativeSlice,
  sinoSlice,
  contextualBindingSlice,
  contextualManifest,
  contextualTaiPack,
  safeCharacterSlice
});

const activationRuntimePaths = [
  'runtime/transform-shared.js',
  'runtime/lexical-runtime.js',
  'runtime/historical-native-runtime.js',
  'runtime/historical-sino-runtime.js',
  'runtime/safe-character-runtime.js',
  'runtime/orthography-resolver.js',
  'runtime/resolver-bundle-runtime.js'
];
const supportRuntimePaths = ['runtime/real-text-evaluation-runtime.js'];
const runtimePaths = [...activationRuntimePaths, ...supportRuntimePaths];

await mkdir(path.join(outputDir, 'runtime'), { recursive: true });
const runtimeFiles = [];
for (const upstreamPath of runtimePaths) {
  const basename = path.basename(upstreamPath);
  const sourcePath = path.join(upstreamRoot, upstreamPath);
  const targetPath = path.join(outputDir, 'runtime', basename);
  await copyFile(sourcePath, targetPath);
  const fileStat = await stat(targetPath);
  runtimeFiles.push({
    path: `runtime/${basename}`,
    upstreamPath,
    gitBlob: git('rev-parse', `HEAD:${upstreamPath}`),
    sha256: await sha256File(targetPath),
    byteLength: fileStat.size
  });
}

const runtimeBundlePath = path.join(outputDir, 'resolver-runtime-bundle.js');
const runtimeBundleParts = [];
for (const upstreamPath of activationRuntimePaths) {
  runtimeBundleParts.push(await readFile(path.join(upstreamRoot, upstreamPath), 'utf8'));
}
await writeFile(runtimeBundlePath, `${runtimeBundleParts.join('\n')}\n`, 'utf8');
const runtimeBundleStat = await stat(runtimeBundlePath);

const artifactPath = path.join(outputDir, 'resolver-bundle.json');
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
const artifactStat = await stat(artifactPath);
const coreCommit = git('rev-parse', 'HEAD');
const lock = {
  schemaVersion: '1',
  kind: 'japanese-orthography-resolver-consumer-snapshot',
  sourceRepository,
  coreCommit,
  bundleContentId: artifact.bundleContentId,
  lexicalNamespaceId: artifact.lexicalArtifact.lexicalNamespaceId,
  artifact: {
    path: 'resolver-bundle.json',
    sha256: await sha256File(artifactPath),
    byteLength: artifactStat.size
  },
  runtimeBundle: {
    path: 'resolver-runtime-bundle.js',
    components: activationRuntimePaths,
    sha256: await sha256File(runtimeBundlePath),
    byteLength: runtimeBundleStat.size
  },
  runtimeFiles
};
await writeFile(path.join(outputDir, 'source-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  coreCommit,
  bundleContentId: artifact.bundleContentId,
  lexicalNamespaceId: artifact.lexicalArtifact.lexicalNamespaceId,
  runtimeFiles: runtimeFiles.length,
  runtimeBundleSha256: lock.runtimeBundle.sha256,
  outputDir
})}\n`);

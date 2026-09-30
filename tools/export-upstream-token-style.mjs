import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const upstreamRoot = process.cwd();
const outputDir = path.resolve(process.argv[2] ?? '../phase45b-generated');
const sourceRepository = 'kinoko34077/japanese-orthography';
const payloadName = '20-kinotch-token-style.json5';

const git = (...args) => execFileSync('git', args, { cwd: upstreamRoot, encoding: 'utf8' }).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileMeta = async (filePath) => {
  const bytes = await readFile(filePath);
  return { sha256: sha256(bytes), byteLength: (await stat(filePath)).size };
};

const loader = await import(pathToFileURL(path.join(upstreamRoot, 'tools/profile-loader.ts')).href);
const compiler = await import(pathToFileURL(path.join(upstreamRoot, 'tools/profile-compiler.ts')).href);
const overlay = await loader.loadKinotchTokenStyleOverlay(upstreamRoot);
const compiled = compiler.compileKinotchTokenStyleOverlay(overlay);
const manifestText = compiled['manifest.json'];
const payloadText = compiled[payloadName];
const manifest = JSON.parse(manifestText);
const bundle = JSON.parse(payloadText);
const artifactScript = `(function (root) {\n  "use strict";\n\n  root.KinotchTokenStyleArtifact = Object.freeze(${JSON.stringify({ manifest, bundle }, null, 2)});\n})(typeof globalThis !== "undefined" ? globalThis : this);\n`;

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'manifest.json'), manifestText, 'utf8');
await writeFile(path.join(outputDir, payloadName), payloadText, 'utf8');
await writeFile(path.join(outputDir, 'artifact.js'), artifactScript, 'utf8');

const manifestMeta = await fileMeta(path.join(outputDir, 'manifest.json'));
const payloadMeta = await fileMeta(path.join(outputDir, payloadName));
const artifactMeta = await fileMeta(path.join(outputDir, 'artifact.js'));
const upstreamCommit = git('rev-parse', 'HEAD');
const lock = {
  schemaVersion: '1',
  kind: 'japanese-orthography-kinotch-token-style-consumer-snapshot',
  sourceRepository,
  upstreamCommit,
  artifactGeneration: manifest.artifactGeneration,
  canonicalSourceDigest: manifest.canonicalSourceDigest,
  adoptedSource: manifest.adoptedSource,
  files: {
    manifest: { path: 'manifest.json', ...manifestMeta },
    payload: { path: payloadName, ...payloadMeta },
    browserArtifact: { path: 'artifact.js', ...artifactMeta }
  }
};
await writeFile(path.join(outputDir, 'source-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ upstreamCommit, artifactGeneration: manifest.artifactGeneration, canonicalSourceDigest: manifest.canonicalSourceDigest, outputDir })}\n`);

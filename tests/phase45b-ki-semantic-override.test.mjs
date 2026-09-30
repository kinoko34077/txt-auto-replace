import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const JSON5 = require(path.join(ROOT, 'lib', 'json5.min.js'));
const kuromoji = require(path.join(ROOT, 'lib', 'kuromoji.js'));
const TransformEngine = require(path.join(ROOT, 'transform-engine.js'));

class LocalFileXMLHttpRequest {
  open(method, url) { this.method = method; this.url = url; this.responseType = 'arraybuffer'; }
  send() {
    fs.readFile(this.url, (error, buffer) => {
      if (error) {
        this.status = 404;
        if (typeof this.onerror === 'function') this.onerror(error);
        return;
      }
      this.status = 200;
      this.response = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      if (typeof this.onload === 'function') this.onload();
    });
  }
}
global.XMLHttpRequest = LocalFileXMLHttpRequest;

const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

function loadStages() {
  const manifest = JSON5.parse(source('transform-bundles.json5'));
  const bundleFiles = {};
  for (const bundle of manifest.bundles ?? []) bundleFiles[bundle.id] = JSON5.parse(source(bundle.path));
  return TransformEngine.loadStagesFromDefinitions(manifest, bundleFiles, {}).stages;
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: path.join(ROOT, 'dict') }).build((error, tokenizer) => {
      if (error) reject(error); else resolve(tokenizer);
    });
  });
}

test('奇 semantic override is lexical rather than a global character rewrite', async () => {
  const tokenizer = await buildTokenizer();
  const stages = loadStages();
  const transform = (text) => TransformEngine.transformTextWithStages(text, stages, tokenizer);

  assert.equal(transform('奇跡'), '奇蹟');
  assert.equal(transform('奇形'), '畸形');
  assert.equal(transform('奇'), '奇');
});

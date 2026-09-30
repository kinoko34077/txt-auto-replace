import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const scripts = manifest.content_scripts?.[0]?.js ?? [];
const expectedSequence = [
  'transform-shared.js',
  'orthography-core/runtime/lexical-runtime.js',
  'orthography-core/runtime/historical-native-runtime.js',
  'orthography-core/runtime/historical-sino-runtime.js',
  'orthography-core/runtime/safe-character-runtime.js',
  'orthography-core/runtime/orthography-resolver.js',
  'orthography-core/runtime/resolver-bundle-runtime.js',
  'orthography-resolver-adapter.js',
  'orthography-resolver-loader.js',
  'orthography-shadow-runtime.js',
  'structured-dictionary.js',
  'transform-engine.js',
  'orthography-transform-bridge.js',
  'text-api-client.js',
  'content.js'
];

test('Phase 4 resolver dependencies load before bridge and content runtime', () => {
  const positions = expectedSequence.map((entry) => scripts.indexOf(entry));
  assert.ok(positions.every((position) => position >= 0), `missing script: ${expectedSequence[positions.findIndex((position) => position < 0)]}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'resolver/bridge scripts must preserve dependency order');
});

test('resolver artifact is exposed without adding extension permissions', () => {
  assert.deepEqual(manifest.permissions, ['storage', 'tabs']);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>', 'https://api.kinotch.workers.dev/*']);
  const resources = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []);
  assert.ok(resources.includes('orthography-core/resolver-bundle.json'));
});

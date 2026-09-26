import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Options exposes a persisted-baseline dirty state and unload guard', async () => {
  const [html, source] = await Promise.all([read('options.html'), read('options-continuity.js')]);

  assert.match(html, /options-continuity\.js/);
  assert.match(source, /saveStateNode\.id\s*=\s*["']save-state["']/);
  assert.match(source, /savedRevision/);
  assert.match(source, /workingRevision/);
  assert.match(source, /refreshDirtyState/);
  assert.match(source, /beforeunload/);
  assert.match(source, /event\.returnValue\s*=\s*["']{2}/);
});

test('Options dirty tracking includes drag and keyboard state mutations', async () => {
  const source = await read('options-continuity.js');

  assert.match(source, /addEventListener\(["']drop["']/);
  assert.match(source, /addEventListener\(["']keydown["']/);
  assert.match(source, /有効化\|無効化/);
  assert.match(source, /dictionary-rules|token-rules/);
});

test('Options transient selection controls do not count as persisted changes', async () => {
  const source = await read('options-continuity.js');

  assert.match(source, /isTransientSelectionControl/);
  assert.match(source, /firstElementChild/);
  assert.match(source, /explorer-row/);
});

test('Popup mutations share pending rollback handling and delete is confirmed', async () => {
  const source = await read('popup.js');

  assert.match(source, /operationPending/);
  assert.match(source, /runPersistedMutation/);
  assert.match(source, /confirm\(/);
  assert.match(source, /previousPayload/);
  assert.match(source, /runtimeError/);
});

test('Operations manual documents live apply instead of mandatory target-page reload after Options save', async () => {
  const manual = await read('docs/operation_manual.md');
  const section = manual.match(/### 3\.2[\s\S]*?(?=### 3\.3)/)?.[0] ?? '';

  assert.match(section, /現在のタブ.*即時|即時.*現在のタブ/);
  assert.doesNotMatch(section, /保存後は変換対象のタブを再読み込みする/);
});

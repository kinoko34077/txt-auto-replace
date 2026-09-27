import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Options continuity is driven by explicit persistence events', async () => {
  const [optionsSource, continuitySource] = await Promise.all([
    read('options.js'),
    read('options-continuity.js'),
  ]);

  assert.match(optionsSource, /settings-dirty/);
  assert.match(optionsSource, /settings-saved/);
  assert.match(optionsSource, /publishPersistenceState\(\{ label \}\)/);
  assert.match(optionsSource, /markPersistedPayloadSaved\(payload, \{ source: "save" \}\)/);
  assert.match(optionsSource, /markPersistedPayloadSaved\(buildPayload\(\), \{ source: "initialize" \}\)/);
  assert.match(continuitySource, /addEventListener\(["']settings-dirty["']/);
  assert.match(continuitySource, /addEventListener\(["']settings-saved["']/);
  assert.doesNotMatch(continuitySource, /const mutationText =/);
  assert.doesNotMatch(continuitySource, /const statusObserver =/);

  class FakeElement {
    constructor(id = '') {
      this.id = id;
      this.dataset = {};
      this.listeners = new Map();
      this.classList = { contains: () => false };
      this.attributes = new Map();
      this.textContent = '';
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) ?? [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    closest() {
      return null;
    }

    insertAdjacentElement(_position, element) {
      this.afterElement = element;
      return element;
    }
  }

  const saveButton = new FakeElement('save-all');
  const statusNode = new FakeElement('status');
  const documentListeners = new Map();
  const document = {
    getElementById(id) {
      return id === 'save-all' ? saveButton : id === 'status' ? statusNode : null;
    },
    createElement() {
      return new FakeElement();
    },
    addEventListener(type, callback) {
      const callbacks = documentListeners.get(type) ?? [];
      callbacks.push(callback);
      documentListeners.set(type, callbacks);
    },
    dispatchEvent(event) {
      for (const callback of documentListeners.get(event.type) ?? []) {
        callback(event);
      }
    },
  };
  const context = {
    console,
    document,
    window: { addEventListener() {} },
    Element: FakeElement,
    HTMLElement: FakeElement,
    MutationObserver: class { observe() {} },
    globalThis: null,
  };
  context.globalThis = context;

  vm.runInNewContext(continuitySource, context, { filename: 'options-continuity.js' });
  document.dispatchEvent({ type: 'settings-dirty', detail: { label: 'unrecognized mutation' } });
  assert.equal(saveButton.dataset.dirty, 'true');
  document.dispatchEvent({ type: 'settings-saved' });
  assert.equal(saveButton.dataset.dirty, 'false');
});

test('Options exposes a persisted-baseline dirty state and unload guard', async () => {
  const [html, source] = await Promise.all([read('options.html'), read('options-continuity.js')]);

  assert.match(html, /options-continuity\.js/);
  assert.match(source, /saveStateNode\.id\s*=\s*["']save-state["']/);
  assert.match(source, /let dirty\s*=\s*false/);
  assert.match(source, /refreshDirtyState/);
  assert.match(source, /beforeunload/);
  assert.match(source, /event\.returnValue\s*=\s*["']{2}/);
});

test('Options dirty tracking does not infer state from UI gestures or wording', async () => {
  const source = await read('options-continuity.js');

  assert.match(source, /addEventListener\(["']settings-dirty["']/);
  assert.match(source, /addEventListener\(["']settings-saved["']/);
  assert.doesNotMatch(source, /addEventListener\(["']drop["']/);
  assert.doesNotMatch(source, /addEventListener\(["']keydown["']/);
  assert.doesNotMatch(source, /isTransientSelectionControl/);
  assert.doesNotMatch(source, /statusObserver/);
});

test('Popup mutations share pending rollback handling and delete is confirmed', async () => {
  const source = await read('popup.js');

  assert.match(source, /operationPending/);
  assert.match(source, /runPersistedMutation/);
  assert.match(source, /confirm\(/);
  assert.match(source, /previousPayload/);
  assert.match(source, /runtimeError/);
});

test('Operations manual keeps live apply guidance for Options save', async () => {
  const manual = await read('docs/operation_manual.md');
  const section = manual.match(/### 3\.2[\s\S]*?(?=### 3\.3)/)?.[0] ?? '';

  assert.match(section, /現在のタブ.*即時|即時.*現在のタブ/);
  assert.doesNotMatch(section, /保存後は変換対象のタブを再読み込みする/);
});

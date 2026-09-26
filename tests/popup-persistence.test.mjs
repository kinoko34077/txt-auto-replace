import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const STORAGE_KEY = 'bundleOverrideSettingsV1';
const source = await fs.readFile(new URL('../popup.js', import.meta.url), 'utf8');

const clone = (value) => JSON.parse(JSON.stringify(value));

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    if (this._textContent === '') this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  async dispatch(type) {
    for (const callback of this.listeners.get(type) ?? []) {
      await callback({ target: this, currentTarget: this });
    }
  }

  querySelectorAll(selector) {
    const tags = new Set(selector.split(',').map((value) => value.trim().toUpperCase()));
    const result = [];
    const visit = (node) => {
      for (const child of node.children ?? []) {
        if (tags.has(child.tagName)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

const makePayload = () => ({
  schema_version: 3,
  runtime_settings: {
    skipEditableInputs: false,
    globalEnabled: true,
    ruby: {
      enabled: true,
      hidden: false,
      default_markers: { open: '《', close: '》' },
    },
  },
  disabled_sites: { domains: [] },
  page_ruby_settings: { url_overrides: {}, domain_defaults: {} },
  popup_bundle_id: 'popup-quick-replacements',
  roots: [{
    id: 'popup-quick-replacements',
    label: 'Popup 追加語彙',
    kind: 'token-rules',
    enabled: true,
    order: 57,
    rules: [{ id: 'r1', from: 'A', to: 'B', priority: 90, enabled: true, regex: false }],
    children: [],
  }],
});

async function boot() {
  const ids = [
    'page-context', 'selection-preview', 'status', 'global-enabled', 'toggle-site', 'toggle-tab',
    'open-options', 'ruby-context', 'ruby-open', 'ruby-close', 'save-ruby-markers', 'entry-from',
    'entry-to', 'entry-priority', 'entry-enabled', 'entry-regex', 'entry-basic', 'add-entry', 'popup-entries',
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id.includes('entry-') || id.includes('ruby-') || id === 'global-enabled' ? 'input' : 'div', id)]));
  elements.get('entry-priority').value = '90';
  elements.get('entry-enabled').checked = true;

  const document = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => {
      const node = new FakeElement('#text');
      node.textContent = text;
      return node;
    },
  };

  const env = {
    stored: makePayload(),
    runtimeError: null,
    failNextSet: false,
    failRuntimeApply: false,
    setCount: 0,
    confirmResult: true,
  };

  const chrome = {
    storage: {
      local: {
        get(_keys, callback) {
          callback({ [STORAGE_KEY]: clone(env.stored) });
        },
        set(payload, callback) {
          env.setCount += 1;
          if (env.failNextSet) {
            env.failNextSet = false;
            env.runtimeError = { message: 'storage unavailable' };
            callback();
            env.runtimeError = null;
            return;
          }
          env.stored = clone(payload[STORAGE_KEY]);
          callback();
        },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      get lastError() { return env.runtimeError; },
      sendMessage(message, callback) {
        if (message.type === 'APPLY_SETTINGS_UPDATE' && env.failRuntimeApply) {
          env.failRuntimeApply = false;
          env.runtimeError = { message: 'runtime unavailable' };
          callback(null);
          env.runtimeError = null;
          return;
        }
        callback({ ok: true });
      },
      openOptionsPage() {},
    },
    tabs: {
      async query() { return [{ id: 1, url: 'https://example.com/' }]; },
      sendMessage(_tabId, _message, callback) {
        callback({
          url: 'https://example.com/',
          hostname: 'example.com',
          selectionText: 'A',
          siteDisabled: false,
          tabDisabled: false,
        });
      },
    },
  };

  const TransformShared = {
    normalizeRubyRuntimeSettings(value) {
      return value ?? { enabled: true, hidden: false, default_markers: { open: '《', close: '》' } };
    },
    normalizePageRubySettings(value) {
      return {
        url_overrides: { ...(value?.url_overrides ?? {}) },
        domain_defaults: { ...(value?.domain_defaults ?? {}) },
      };
    },
    resolveEffectiveRubySettings(_page, runtime) {
      return { markers: runtime?.default_markers ?? { open: '《', close: '》' }, source: 'default' };
    },
    normalizeRubyMarkers(value) {
      return { open: String(value?.open ?? '《') || '《', close: String(value?.close ?? '》') || '》' };
    },
  };

  const context = {
    console,
    document,
    chrome,
    TransformShared,
    confirm: () => env.confirmResult,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'popup.js' });
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  const all = () => {
    const result = [...elements.values()];
    const visit = (node) => {
      for (const child of node.children ?? []) {
        result.push(child);
        visit(child);
      }
    };
    elements.forEach(visit);
    return result;
  };
  const findButton = (label) => all().find((node) => node.tagName === 'BUTTON' && node.textContent === label);

  return { env, elements, findButton };
}

test('delete confirmation can cancel without touching persistence', async () => {
  const app = await boot();
  app.env.confirmResult = false;
  const deleteButton = app.findButton('削除');
  assert.ok(deleteButton);

  await deleteButton.dispatch('click');

  assert.equal(app.env.setCount, 0);
  assert.equal(app.env.stored.roots[0].rules.length, 1);
});

test('storage failure rolls a destructive delete back to the persisted payload', async () => {
  const app = await boot();
  app.env.failNextSet = true;
  const deleteButton = app.findButton('削除');
  assert.ok(deleteButton);

  await deleteButton.dispatch('click');

  assert.equal(app.env.stored.roots[0].rules.length, 1);
  assert.match(app.elements.get('status').textContent, /元に戻しました/);
  assert.equal(app.elements.get('add-entry').disabled, false);
  assert.ok(app.findButton('削除'), 'rolled-back rule must be rendered again');
});

test('runtime notification failure does not roll back a storage-successful update', async () => {
  const app = await boot();
  app.env.failRuntimeApply = true;
  const updateButton = app.findButton('更新');
  assert.ok(updateButton);

  const inputs = app.elements.get('popup-entries').querySelectorAll('input');
  const toInput = inputs[1];
  toInput.value = 'C';
  await updateButton.dispatch('click');

  assert.equal(app.env.stored.roots[0].rules[0].to, 'C');
  assert.match(app.elements.get('status').textContent, /反映に失敗/);
  assert.doesNotMatch(app.elements.get('status').textContent, /元に戻しました/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const policy = require("../remote-api-privacy-policy.js");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

test("no stored opt-in = local-only, even with standard remote-eligible bundle", () => {
  assert.deepEqual(policy.normalize(undefined), { enabled: false, allowedDomains: [] });
  let remoteCalls = 0;
  if (policy.permits(undefined, "https:", "mail.example")) remoteCalls++;
  assert.equal(remoteCalls, 0);
});

test("positive opt-in without site allowlist stays local", () => {
  assert.equal(policy.permits({ enabled: true }, "https:", "example.com"), false);
});

test("both explicit global permission and exact HTTPS host required", () => {
  const value = { enabled: true, allowedDomains: ["example.com"] };
  assert.equal(policy.permits(value, "https:", "example.com"), true);
  assert.equal(policy.permits(value, "https:", "other.example.com"), false);
  assert.equal(policy.permits(value, "http:", "example.com"), false);
  assert.equal(policy.permits(value, "file:", "example.com"), false);
  assert.equal(policy.permits({ ...value, enabled: false }, "https:", "example.com"), false);
});

test("site revocation and global disable stop subsequent calls", () => {
  let remoteCalls = 0;
  const run = (settings) => {
    if (policy.permits(settings, "https:", "example.com")) remoteCalls++;
  };
  run({ enabled: true, allowedDomains: ["example.com"] });
  run({ enabled: true, allowedDomains: [] });
  run({ enabled: false, allowedDomains: ["example.com"] });
  assert.equal(remoteCalls, 1);
});

test("nonboolean or malformed opt-in never becomes consent", () => {
  assert.equal(policy.normalize({ enabled: "true", allowedDomains: ["example.com"] }).enabled, false);
  assert.equal(policy.permits({ enabled: 1, allowedDomains: ["example.com"] }, "https:", "example.com"), false);
  assert.equal(policy.permits({ enabled: true, allowedDomains: "example.com" }, "https:", "example.com"), false);
});

test("invalid domain and wildcards are not silently admitted", () => {
  const out = policy.normalize({ enabled: true, allowedDomains: [
    "EXAMPLE.COM", "example.com", "*.example.com", "example.com/path",
    "a..example.com", null, "", "evil.com?x", "example.com."
  ] });
  assert.deepEqual(out.allowedDomains, ["example.com"]);
});

test("imported settings never silently grant remote permission", () => {
  const untrustedImported = {
    globalEnabled: true,
    remoteProcessing: { enabled: true, allowedDomains: ["private.example"] },
  };
  const defaultUser = policy.preserveConsentOnImport(untrustedImported, undefined);
  assert.deepEqual(defaultUser.remoteProcessing, { enabled: false, allowedDomains: [] });
  assert.equal(policy.permits(defaultUser.remoteProcessing, "https:", "private.example"), false);
  const existingUser = policy.preserveConsentOnImport(untrustedImported, {
    enabled: true, allowedDomains: ["user-approved.example"],
  });
  assert.deepEqual(existingUser.remoteProcessing, {
    enabled: true, allowedDomains: ["user-approved.example"],
  });
  assert.equal(policy.permits(existingUser.remoteProcessing, "https:", "private.example"), false);
  assert.equal(policy.permits(existingUser.remoteProcessing, "https:", "user-approved.example"), true);
  assert.ok(source("options.js").includes("RemotePrivacyPolicy.preserveConsentOnImport("));
});

test("stale Options tab cannot silently regrant after another tab revokes", () => {
  const allowed = { enabled: true, allowedDomains: ["private.example"] };
  const revoked = { enabled: false, allowedDomains: [] };
  // Tab A has a stale, UNEDITED in-memory copy; Tab B already persisted revoke.
  const staleA = policy.reconcileForSave(allowed, allowed, revoked);
  assert.deepEqual(staleA, { ok: true, policy: revoked, reason: "PRESERVE_LATEST" });
  assert.equal(policy.permits(staleA.policy, "https:", "private.example"), false);
  // A deliberately changed grant, but B changed policy while A was open.
  const conflict = policy.reconcileForSave(allowed, revoked, { enabled: true, allowedDomains: ["other.example"] });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "CONCURRENT_CONSENT_CHANGE");
  // Current owner can make an explicit change to the latest baseline.
  const fresh = policy.reconcileForSave(revoked, allowed, revoked);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.reason, "EXPLICIT_CONSENT_EDIT");
});

test("only explicit Options edits can write dedicated consent key", () => {
  const options = source("options.js");
  const content = source("content.js");
  const popup = source("popup.js");
  const background = source("background.js");
  const key = "remoteProcessingConsentV1";
  assert.ok(options.includes(key) && content.includes(key));
  assert.ok(!popup.includes(key) && !background.includes(key));
  assert.match(options, /consentChange: decision\.reason === "EXPLICIT_CONSENT_EDIT"/);
  assert.match(options, /if \(consentChange\)/);
  assert.match(options, /\[REMOTE_CONSENT_STORAGE_KEY\]/);
  assert.match(options, /const bundle = RemotePrivacyPolicy\.redactForExport\(payload\)/);
  assert.match(content, /REMOTE_CONSENT_STORAGE_KEY\]/);
  assert.match(content, /RemotePrivacyPolicy\.normalize\(storedValue\?\.__remoteConsent\)/);
  assert.doesNotMatch(popup, /remoteProcessing/);
  assert.doesNotMatch(background, /remoteProcessing/);
  assert.match(options, /const activeConsent = RemotePrivacyPolicy\.normalize/);
});

test("JSON/YAML export strips private hostnames and consent but leaves source unchanged", () => {
  const input = {
    roots: [{ id: "root" }],
    runtime_settings: { globalEnabled: true, remoteProcessing: { enabled: true, allowedDomains: ["private.example"] } },
  };
  const exported = policy.redactForExport(input);
  assert.equal("remoteProcessing" in exported.runtime_settings, false);
  assert.deepEqual(input.runtime_settings.remoteProcessing.allowedDomains, ["private.example"]);
  assert.equal(JSON.stringify(exported).includes("private.example"), false);
  assert.match(source("options.js"), /RemotePrivacyPolicy\.redactForExport\(buildPayload\(\)\)/);
});

test("content source performs consent check at both selection and send boundary", () => {
  const src = source("content.js");
  const selection = src.slice(src.indexOf("const canUseRemoteApiForTransform ="), src.indexOf("const canUseTransformBackend ="));
  const send = src.slice(src.indexOf("const sendRemoteTransformBatch ="), src.indexOf("const enqueueWorkerTransformRun ="));
  assert.match(selection, /RemotePrivacyPolicy\?\.permits\(activeRuntimeSettings.remoteProcessing/);
  assert.match(selection, /remotePolicyPending !== true/);
  const flush = src.slice(src.indexOf("const flushWorkerBatchQueue ="), src.indexOf("const scheduleWorkerBatchFlush ="));
  assert.match(flush, /const useRemoteApi = canUseRemoteApiForTransform\(\)/);
  assert.match(flush, /if \(useRemoteApi\)/);
  assert.doesNotMatch(send, /workerBatchQueue\.push/);
  assert.match(src, /thisPolicyGeneration !== remotePolicyGeneration/);
  assert.match(src, /chrome\.storage\.onChanged\.addListener/);
});

test("privacy module loads before content and options, visible UI is explicit", () => {
  const manifest = JSON.parse(source("manifest.json"));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf("remote-api-privacy-policy.js") >= 0);
  assert.ok(scripts.indexOf("remote-api-privacy-policy.js") < scripts.indexOf("content.js"));
  const html = source("options.html");
  assert.ok(html.indexOf('src="remote-api-privacy-policy.js"') < html.indexOf('src="options.js"'));
  assert.match(html, /runtime-remote-enabled/);
  assert.match(html, /runtime-remote-add-current/);
  assert.match(html, /runtime-remote-domain/);
  const options = source("options.js");
  assert.match(options, /RemotePrivacyPolicy\.normalize\(value\?\.remoteProcessing\)/);
  const siteConsent = options.slice(
    options.indexOf('runtimeRemoteAddCurrentButton?.addEventListener("click"'),
    options.indexOf('openShortcutsButton?.addEventListener')
  );
  assert.match(siteConsent, /RemotePrivacyPolicy\.normalizeHostname\(runtimeRemoteDomainInput/);
  assert.doesNotMatch(siteConsent, /getActiveTab\(/);
});


test("bulk settings failure after consent grant reports the partial write and retains authoritative consent", async () => {
  // Exercise the actual Options persistence function with deliberately failed
  // storage, rather than merely grepping the code or mocking the policy API.
  const { runInNewContext } = await import("node:vm");
  const options = source("options.js");
  const first = options.indexOf("const persistAllWithConsent = async () => {");
  const last = options.indexOf("const saveAllAndNotify = async () => {", first);
  assert.ok(first >= 0 && last > first, "Options persistence contract must be identifiable");
  const persistSource = options.slice(first, last);
  const consent = { enabled: true, allowedDomains: ["private.example"] };
  const state = {
    remoteConsentBaseline: { enabled: false, allowedDomains: [] },
    runtimeSettings: { remoteProcessing: { enabled: false, allowedDomains: [] } },
  };
  const writes = [];
  let renderCount = 0;
  let savedHistory = 0;
  const context = {
    preparePayloadWithCurrentConsent: async () => ({
      payload: { runtime_settings: { remoteProcessing: consent }, roots: [] },
      consentChange: true,
    }),
    RemotePrivacyPolicy: policy,
    state,
    navigator: { locks: { request: async (_name, _options, fn) => fn() } },
    storageSet: async (data) => {
      const names = Object.keys(data);
      writes.push(names[0]);
      if (names[0] === "bundleOverrideSettingsV1") throw new Error("quota");
    },
    REMOTE_CONSENT_STORAGE_KEY: "remoteProcessingConsentV1",
    STORAGE_KEY: "bundleOverrideSettingsV1",
    applyPersistedPayloadToState() { throw new Error("must not treat bundle as saved"); },
    renderApp() { renderCount++; },
    async savePayloadHistory() { savedHistory++; },
    markPersistedPayloadSaved() { throw new Error("must not mark bundle saved"); },
  };
  const persist = runInNewContext(persistSource + "\npersistAllWithConsent;", context);
  await assert.rejects(persist(), /外部送信許可の変更は反映されましたが、その他の設定は保存できませんでした: quota/);
  assert.deepEqual(writes, ["remoteProcessingConsentV1", "bundleOverrideSettingsV1"]);
  assert.deepEqual(state.remoteConsentBaseline, consent);
  assert.deepEqual(state.runtimeSettings.remoteProcessing, consent);
  assert.equal(renderCount, 1);
  assert.equal(savedHistory, 0);
});


test("two Options windows serialize explicit consent and reject an outdated regrant", async () => {
  const { runInNewContext } = await import("node:vm");
  const options = source("options.js");
  const start = options.indexOf("const preparePayloadWithCurrentConsent = async () => {");
  const end = options.indexOf("const saveAllAndNotify = async () => {", start);
  assert.ok(start >= 0 && end > start);
  const actualSaveSource = options.slice(start, end);
  const approved = { enabled: true, allowedDomains: ["private.example"] };
  const revoke = { enabled: false, allowedDomains: [] };
  const lateGrant = { enabled: true, allowedDomains: ["private.example", "new.example"] };
  const shared = { consent: approved, writes: [], maxConcurrent: 0, concurrent: 0 };
  let lastLock = Promise.resolve();
  const locks = {
    request(name, options, callback) {
      assert.equal(name, "txt-auto-replace.remote-consent.v1");
      assert.equal(options.mode, "exclusive");
      const run = lastLock.then(async () => {
        shared.concurrent++;
        shared.maxConcurrent = Math.max(shared.maxConcurrent, shared.concurrent);
        try { return await callback(); } finally { shared.concurrent--; }
      });
      lastLock = run.catch(() => {});
      return run;
    },
  };
  const makeWindow = (draft) => {
    const state = {
      remoteConsentBaseline: approved,
      runtimeSettings: { remoteProcessing: draft },
    };
    const context = {
      navigator: { locks },
      RemotePrivacyPolicy: policy,
      state,
      REMOTE_CONSENT_STORAGE_KEY: "remoteProcessingConsentV1",
      STORAGE_KEY: "bundleOverrideSettingsV1",
      buildPayload: () => ({
        roots: [], runtime_settings: { remoteProcessing: state.runtimeSettings.remoteProcessing },
      }),
      async storageGet() {
        return shared.consent;
      },
      async storageSet(data) {
        if ("remoteProcessingConsentV1" in data) {
          // Widen the vulnerable read-to-write window. Without an exclusive
          // lock both writers may see the original approved policy.
          await new Promise((resolve) => setTimeout(resolve, 20));
          shared.consent = data.remoteProcessingConsentV1;
          shared.writes.push(JSON.parse(JSON.stringify(shared.consent)));
        }
      },
      applyPersistedPayloadToState() {},
      renderApp() {},
      async savePayloadHistory() {},
      markPersistedPayloadSaved() {},
    };
    return runInNewContext(actualSaveSource + "\npersistAllWithConsent;", context);
  };
  const revokeSave = makeWindow(revoke);
  const staleGrantSave = makeWindow(lateGrant);
  const [first, second] = await Promise.allSettled([revokeSave(), staleGrantSave()]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(second.reason.message, /別の設定画面で外部送信許可が変更/);
  assert.deepEqual(shared.consent, revoke);
  assert.deepEqual(shared.writes, [revoke]);
  assert.equal(shared.maxConcurrent, 1);
});

test("when Web Locks is absent, explicit consent edits fail closed but ordinary saves work", async () => {
  const { runInNewContext } = await import("node:vm");
  const options = source("options.js");
  const start = options.indexOf("const preparePayloadWithCurrentConsent = async () => {");
  const end = options.indexOf("const saveAllAndNotify = async () => {", start);
  const actualSaveSource = options.slice(start, end);
  const prior = { enabled: false, allowedDomains: [] };
  const writes = [];
  const state = { remoteConsentBaseline: prior,
    runtimeSettings: { remoteProcessing: { enabled: true, allowedDomains: ["private.example"] } } };
  const context = {
    navigator: {},
    state,
    RemotePrivacyPolicy: policy,
    REMOTE_CONSENT_STORAGE_KEY: "remoteProcessingConsentV1",
    STORAGE_KEY: "bundleOverrideSettingsV1",
    buildPayload: () => ({ runtime_settings: { remoteProcessing: state.runtimeSettings.remoteProcessing } }),
    storageGet: async () => prior,
    storageSet: async (data) => { writes.push(Object.keys(data)[0]); },
    applyPersistedPayloadToState() {},
    renderApp() {},
    async savePayloadHistory() {},
    markPersistedPayloadSaved() {},
  };
  const persist = runInNewContext(actualSaveSource + "\npersistAllWithConsent;", context);
  await assert.rejects(persist(), /安全な排他保存を利用できません/);
  assert.deepEqual(writes, [], "unsupported lock must never grant external transmission");

  state.runtimeSettings.remoteProcessing = prior;
  await persist();
  assert.deepEqual(writes, ["bundleOverrideSettingsV1"],
    "ordinary settings remain usable without Web Locks");
});

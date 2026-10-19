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

test("popup and options saves preserve the current consent boundary", () => {
  const popup = source("popup.js");
  assert.match(popup, /remoteProcessing: value\?\.remoteProcessing/);
  assert.match(popup, /latest\?\.runtime_settings\?\.remoteProcessing/);
  const options = source("options.js");
  assert.match(options, /preparePayloadWithCurrentConsent\(\)/);
  assert.match(options, /RemotePrivacyPolicy\.reconcileForSave\(/);
  assert.match(options, /state\.remoteConsentBaseline = RemotePrivacyPolicy\.normalize/);
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

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
  assert.match(source("options.js"), /RemotePrivacyPolicy\\.preserveConsentOnImport\\(/);
});

test("content source performs consent check at both selection and send boundary", () => {
  const src = source("content.js");
  const selection = src.slice(src.indexOf("const canUseRemoteApiForTransform ="), src.indexOf("const canUseTransformBackend ="));
  const send = src.slice(src.indexOf("const sendRemoteTransformBatch ="), src.indexOf("const enqueueWorkerTransformRun ="));
  assert.match(selection, /RemotePrivacyPolicy\?\.permits\(activeRuntimeSettings.remoteProcessing/);
  assert.match(selection, /remotePolicyPending !== true/);
  assert.match(send, /if \(!canUseRemoteApiForTransform\(\)\)/);
  assert.match(send, /workerBatchQueue\.push\(\.\.\.runs\)/);
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
  assert.match(source("options.js"), /RemotePrivacyPolicy\.normalize\(value\?\.remoteProcessing\)/);
});

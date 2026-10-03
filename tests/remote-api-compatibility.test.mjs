import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const JSON5 = require("../lib/json5.min.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function computePackagedRuleSetHash() {
  const manifest = JSON5.parse(
    await readFile(path.join(root, "transform-bundles.json5"), "utf8"),
  );
  const files = {};
  for (const bundle of manifest.bundles ?? []) {
    files[bundle.id] = JSON5.parse(
      await readFile(path.join(root, bundle.path), "utf8"),
    );
  }
  return createHash("sha256")
    .update(JSON.stringify({ manifest, files }))
    .digest("hex");
}

const compatibility = require("../remote-api-compatibility.js");

test("pinned remote rule-set hash equals the packaged canonical rule definitions", async () => {
  assert.equal(
    compatibility.EXPECTED_RULE_SET_HASH,
    await computePackagedRuleSetHash(),
  );
});

test("compatible response preserves exact requested profile order", () => {
  const requestedProfiles = ["lexical-replacements", "okurigana-abbreviation"];
  const payload = {
    texts: ["其", "分る"],
    profile: [...requestedProfiles],
    ruleSetVersion: compatibility.EXPECTED_RULE_SET_VERSION,
    ruleSetHash: compatibility.EXPECTED_RULE_SET_HASH,
    engineVersion: "0.2.0-phase2",
  };
  assert.deepEqual(
    compatibility.validateRemoteBatchResponse(payload, {
      requestedProfiles,
      expectedTextCount: 2,
    }),
    payload.texts,
  );
});

test("same-length wrong profile is rejected", () => {
  assert.throws(
    () => compatibility.validateRemoteBatchResponse({
      texts: ["x", "y"],
      profile: ["legacy-kanji", "okurigana-abbreviation"],
      ruleSetVersion: compatibility.EXPECTED_RULE_SET_VERSION,
      ruleSetHash: compatibility.EXPECTED_RULE_SET_HASH,
    }, {
      requestedProfiles: ["lexical-replacements", "okurigana-abbreviation"],
      expectedTextCount: 2,
    }),
    /profile/i,
  );
});

test("same-profile wrong rule-set hash is rejected", () => {
  assert.throws(
    () => compatibility.validateRemoteBatchResponse({
      texts: ["x"],
      profile: ["legacy-kanji"],
      ruleSetVersion: compatibility.EXPECTED_RULE_SET_VERSION,
      ruleSetHash: "0".repeat(64),
    }, {
      requestedProfiles: ["legacy-kanji"],
      expectedTextCount: 1,
    }),
    /rule-set hash/i,
  );
});

test("unknown rule-set version is rejected", () => {
  assert.throws(
    () => compatibility.validateRemoteBatchResponse({
      texts: ["x"],
      profile: ["legacy-kanji"],
      ruleSetVersion: "rules-v999",
      ruleSetHash: compatibility.EXPECTED_RULE_SET_HASH,
    }, {
      requestedProfiles: ["legacy-kanji"],
      expectedTextCount: 1,
    }),
    /rule-set version/i,
  );
});

test("content runtime validates remote compatibility before any DOM apply and retains local fallback", async () => {
  const [manifestText, content] = await Promise.all([
    readFile(path.join(root, "manifest.json"), "utf8"),
    readFile(path.join(root, "content.js"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const scripts = manifest.content_scripts?.[0]?.js ?? [];
  const compatIndex = scripts.indexOf("remote-api-compatibility.js");
  const contentIndex = scripts.indexOf("content.js");
  assert.ok(compatIndex >= 0 && compatIndex < contentIndex);

  const validationIndex = content.indexOf("RemoteApiCompatibility.validateRemoteBatchResponse");
  const applyIndex = content.indexOf("applyWorkerTransformResult({", validationIndex);
  assert.ok(validationIndex >= 0, "content.js must validate remote response compatibility");
  assert.ok(applyIndex > validationIndex, "compatibility validation must occur before DOM apply");

  const failureIndex = content.indexOf("const markRemoteApiFailed");
  const restoreIndex = content.indexOf("restoreFirst: true", failureIndex);
  assert.ok(failureIndex >= 0 && restoreIndex > failureIndex);
});

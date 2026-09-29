"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const JSON5 = require(path.join(ROOT_DIR, "lib", "json5.min.js"));
const LOCK_PATH = path.join(ROOT_DIR, "transforms", "kinotch-fixed-source-lock.json");

const EXPECTED = Object.freeze({
  schemaVersion: "1",
  sourceRepository: "kinoko34077/japanese-orthography",
  coreCommit: "671e5e58a39e925653389e5547a7316ca51ec57f",
  artifactPath: "test/golden/kinotch-profile",
  artifactSchemaVersion: "1",
  profileId: "kinotch-fixed",
  buildSourceIdentity: "canonical-content-addressed",
  artifactGeneration: "9b0971ca30ba5dcecda05c0c615f84e74e1cb06a9f155bfb6a90c2a7bf80db16",
  canonicalSourceDigest: "cd3bc74e9daa4fb5a40f2f5962bb4263187aaaf6b9bfc206732993dcc6ccdf69",
  sourceSetDigest: "df96296fedabfe0355c6c799b5eaf538d2f35923467ee9d4c1bfbe6b276e7acd"
});

const EXPECTED_SOURCE_SET = Object.freeze([
  {
    repository: "kinoko34077/txt-auto-replace",
    commit: "b1227053c5df94c148ca2027b897a69199801e4e",
    path: "transforms/40-legacy-kanji.json5",
    blobSha: "57177fb8fba471f9c169283dcbae5830d5bac64f",
    role: "legacy"
  },
  {
    repository: "kinoko34077/txt-auto-replace",
    commit: "b1227053c5df94c148ca2027b897a69199801e4e",
    path: "transforms/50-official-homophone-restoration.json5",
    blobSha: "c3e35dd4431deeb13b94a7f3d5e43f978ed73ef3",
    role: "official-homophone"
  },
  {
    repository: "kinoko34077/txt-auto-replace",
    commit: "b1227053c5df94c148ca2027b897a69199801e4e",
    path: "transforms/55-homophone-kanji.json5",
    blobSha: "3d4ff5f2c1bdf8dd1cea4832d0a6d08592a218fd",
    role: "project-homophone"
  }
]);

const EXPECTED_FILES = Object.freeze([
  {
    path: "transforms/40-legacy-kanji.json5",
    upstreamArtifactPath: "test/golden/kinotch-profile/40-legacy-kanji.json5",
    payloadDigest: "88c0a09376690c677cc893aa5408809ad85ebe8996a3d9af158cbc788eadf70c",
    byteLength: 2089,
    bundleId: "legacy-kanji",
    order: 40
  },
  {
    path: "transforms/50-official-homophone-restoration.json5",
    upstreamArtifactPath: "test/golden/kinotch-profile/50-official-homophone-restoration.json5",
    payloadDigest: "c0a0de5eeb0332313745ed2067285e2bbf3540a63683701f684c63d4a9b41d83",
    byteLength: 29504,
    bundleId: "official-homophone-restoration",
    order: 50
  },
  {
    path: "transforms/55-homophone-kanji.json5",
    upstreamArtifactPath: "test/golden/kinotch-profile/55-homophone-kanji.json5",
    payloadDigest: "19ea69493a53fee296e5403b52ac8ad93a61a74c44d6622078c4c0b53c712527",
    byteLength: 356,
    bundleId: "homophone-kanji",
    order: 55
  }
]);

const fail = (message) => {
  throw new Error(message);
};

const requireEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const requireJsonEqual = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: generated-source identity drift`);
  }
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const main = () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));

  for (const [field, expected] of Object.entries(EXPECTED)) {
    requireEqual(lock[field], expected, `lock.${field}`);
  }
  requireJsonEqual(lock.adoptedSourceSet, EXPECTED_SOURCE_SET, "lock.adoptedSourceSet");

  if (!Array.isArray(lock.files) || lock.files.length !== EXPECTED_FILES.length) {
    fail(`lock.files: expected ${EXPECTED_FILES.length} entries`);
  }

  const manifest = JSON5.parse(fs.readFileSync(path.join(ROOT_DIR, "transform-bundles.json5"), "utf8"));
  const bundlesById = new Map((manifest.bundles || []).map((bundle) => [bundle.id, bundle]));

  for (const expected of EXPECTED_FILES) {
    const locked = lock.files.find((entry) => entry.path === expected.path);
    if (!locked) {
      fail(`lock.files: missing ${expected.path}`);
    }
    requireEqual(locked.upstreamArtifactPath, expected.upstreamArtifactPath, `${expected.path}.upstreamArtifactPath`);
    requireEqual(locked.payloadDigest, expected.payloadDigest, `${expected.path}.payloadDigest`);
    requireEqual(locked.byteLength, expected.byteLength, `${expected.path}.byteLength`);

    const payload = fs.readFileSync(path.join(ROOT_DIR, expected.path));
    requireEqual(payload.byteLength, expected.byteLength, `${expected.path} byte length`);
    requireEqual(sha256(payload), expected.payloadDigest, `${expected.path} sha256`);

    const bundle = bundlesById.get(expected.bundleId);
    if (!bundle) {
      fail(`transform-bundles.json5: missing ${expected.bundleId}`);
    }
    requireEqual(bundle.path, expected.path, `${expected.bundleId}.path`);
    requireEqual(bundle.order, expected.order, `${expected.bundleId}.order`);
    requireEqual(bundle.enabled, true, `${expected.bundleId}.enabled`);
  }

  console.log(`PASS generated fixed rule packs -> ${EXPECTED.coreCommit}`);
};

try {
  main();
} catch (error) {
  console.error(`FAIL generated fixed rule packs: ${error.message}`);
  process.exitCode = 1;
}

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCK_PATH = path.join(ROOT, "runtime-source-lock.json");
const EXPECTED = Object.freeze({
  schemaVersion: "1",
  sourceRepository: "kinoko34077/japanese-orthography",
  coreCommit: "ad54ead84c98b31a733cafa3c88739a1b03aaf27",
  artifactPath: "runtime",
  runtimeSemanticsVersion: "1"
});
const EXPECTED_FILES = Object.freeze([
  { path: "transform-shared.js", upstreamPath: "runtime/transform-shared.js", gitBlob: "24518621cb7816f8daee6bc67911a14bed74cac6", byteLength: 44306 },
  { path: "transform-engine.js", upstreamPath: "runtime/transform-engine.js", gitBlob: "9ed98ce3b8075828ee431ef30cfa7d9bcdd31f49", byteLength: 107309, requires: ["transform-shared"] },
  { path: "structured-dictionary.js", upstreamPath: "runtime/structured-dictionary.js", gitBlob: "21d9c1bc17b7ceadf29630d10ac3f905b2047883", byteLength: 21805 }
]);

const fail = (message) => { throw new Error(message); };
const equal = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const gitBlob = (payload) => crypto.createHash("sha1")
  .update(Buffer.from(`blob ${payload.byteLength}\0`))
  .update(payload)
  .digest("hex");

try {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  for (const [field, expected] of Object.entries(EXPECTED)) equal(lock[field], expected, `lock.${field}`);
  equal(lock.files, EXPECTED_FILES, "lock.files");

  for (const expected of EXPECTED_FILES) {
    const payload = fs.readFileSync(path.join(ROOT, expected.path));
    equal(payload.byteLength, expected.byteLength, `${expected.path}.byteLength`);
    equal(gitBlob(payload), expected.gitBlob, `${expected.path}.gitBlob`);
  }

  console.log(`PASS canonical shared runtime -> ${EXPECTED.coreCommit}`);
} catch (error) {
  console.error(`FAIL canonical shared runtime: ${error.message}`);
  process.exitCode = 1;
}

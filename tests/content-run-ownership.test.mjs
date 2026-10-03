import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  evaluateRestore,
  restoreOwnedTextRun
} = require("../content-run-ownership.js");

const ownership = Object.freeze({
  sourceText: "A",
  transformedText: "B",
  revision: 7
});

test("restore decision permits write only while live text is extension-owned", () => {
  assert.deepEqual(evaluateRestore(ownership, "B"), {
    decision: "restore",
    sourceText: "A"
  });
  assert.deepEqual(evaluateRestore(ownership, "C"), {
    decision: "external-change",
    sourceText: "C"
  });
  assert.deepEqual(evaluateRestore(ownership, "A"), {
    decision: "already-source",
    sourceText: "A"
  });
});

test("page mutation B -> C followed by restore preserves C without a write", () => {
  const nodes = [{ isConnected: true, nodeValue: "C" }];
  let writeCount = 0;

  const result = restoreOwnedTextRun(nodes, ownership, {
    readNodeValue: (node) => node.nodeValue,
    redistribute: (textNodes, currentParts, text) => {
      writeCount += 1;
      textNodes[0].nodeValue = text;
    }
  });

  assert.equal(result.restored, false);
  assert.equal(result.clearOwnership, true);
  assert.equal(result.decision, "external-change");
  assert.equal(nodes[0].nodeValue, "C");
  assert.equal(writeCount, 0);
});

test("owned B restores to A for disable/settings reapply", () => {
  const nodes = [{ isConnected: true, nodeValue: "B" }];
  let writeCount = 0;

  const result = restoreOwnedTextRun(nodes, ownership, {
    readNodeValue: (node) => node.nodeValue,
    redistribute: (textNodes, currentParts, text) => {
      writeCount += 1;
      textNodes[0].nodeValue = text;
    }
  });

  assert.equal(result.restored, true);
  assert.equal(result.clearOwnership, true);
  assert.equal(result.decision, "restore");
  assert.equal(nodes[0].nodeValue, "A");
  assert.equal(writeCount, 1);
});

test("unowned run never writes", () => {
  const nodes = [{ isConnected: true, nodeValue: "C" }];
  let writeCount = 0;
  const result = restoreOwnedTextRun(nodes, null, {
    readNodeValue: (node) => node.nodeValue,
    redistribute: () => {
      writeCount += 1;
    }
  });

  assert.equal(result.restored, false);
  assert.equal(result.clearOwnership, false);
  assert.equal(result.decision, "unowned");
  assert.equal(writeCount, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const DebugRuntimeChannel = require("../debug-runtime-channel.js");

function fakeDocument() {
  const attributes = new Map();
  const documentElement = {
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
  };
  return { documentElement, attributes };
}

test("untrusted page DOM cannot enable privileged debug authority", () => {
  const page = fakeDocument();
  page.documentElement.setAttribute(
    "data-jpn-transform-debug-targets",
    "secret-target",
  );

  const authority = DebugRuntimeChannel.createDebugAuthority(page);

  assert.equal(authority.hasTargets(), false);
  assert.deepEqual(authority.getTargets(), []);

  authority.setTargets(["Bluetooth", "Bluetooth", "  "]);
  assert.equal(authority.hasTargets(), true);
  assert.deepEqual(authority.getTargets(), ["Bluetooth"]);

  page.documentElement.setAttribute(
    "data-jpn-transform-debug-targets",
    "attacker-replacement",
  );
  assert.deepEqual(authority.getTargets(), ["Bluetooth"]);
});

test("legacy shared debug attributes are cleared and never serve as authority", () => {
  const page = fakeDocument();
  for (const attribute of DebugRuntimeChannel.LEGACY_DEBUG_ATTRIBUTES) {
    page.documentElement.setAttribute(attribute, "page-visible-value");
  }

  const authority = DebugRuntimeChannel.createDebugAuthority(page);
  authority.clearLegacyDomState();

  for (const attribute of DebugRuntimeChannel.LEGACY_DEBUG_ATTRIBUTES) {
    assert.equal(page.documentElement.hasAttribute(attribute), false);
  }
  assert.equal(authority.hasTargets(), false);
});

test("content runtime uses extension-owned debug messages and no DOM debug observer/export", async () => {
  const [manifestText, content] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../content.js", import.meta.url), "utf8"),
  ]);
  const scripts = JSON.parse(manifestText).content_scripts?.[0]?.js ?? [];

  assert.ok(
    scripts.indexOf("debug-runtime-channel.js") >= 0 &&
      scripts.indexOf("debug-runtime-channel.js") < scripts.indexOf("content.js"),
  );
  assert.match(content, /SET_RUNTIME_DEBUG_TARGETS/);
  assert.match(content, /debugAuthority\.setTargets\(message\.targets\)/);
  assert.match(content, /GET_RUNTIME_DEBUG_SNAPSHOT/);
  assert.doesNotMatch(content, /getDebugTargetsFromDocument/);
  assert.doesNotMatch(content, /observeDebugTargetChanges/);
  assert.doesNotMatch(content, /setAttribute\(DEBUG_(?:LAST|HISTORY|RUNTIME)_ATTRIBUTE/);
});

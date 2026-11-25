import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../options.js", import.meta.url), "utf8");

test("options.js error messages are not collapsed to question marks", () => {
  const matches = source.match(/new Error\((?:"[^"\n]*\?{3,}[^"\n]*"|`[^`\n]*\?{3,}[^`\n]*`)\)/g) ?? [];
  assert.deepEqual(matches, []);
});

test("options.js error messages carry no multi-pass mojibake", () => {
  // UTF-8 を CP932 として読み替えた文字列を再度保存すると現れる並び（驍ｵ・ｺ など）。
  const matches = source.match(/new Error\(`[^`\n]*(?:驍ｵ|鬮ｫ|鬮ｴ|鬯ｩ|髯樊)[^`\n]*`\)/g) ?? [];
  assert.deepEqual(matches, []);
});

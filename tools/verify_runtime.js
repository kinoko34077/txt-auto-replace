"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const JSON5 = require(path.join(ROOT_DIR, "lib", "json5.min.js"));
const kuromoji = require(path.join(ROOT_DIR, "lib", "kuromoji.js"));
const TransformEngine = require(path.join(ROOT_DIR, "transform-engine.js"));

class LocalFileXMLHttpRequest {
  open(method, url) {
    this.method = method;
    this.url = url;
    this.responseType = "arraybuffer";
  }

  send() {
    fs.readFile(this.url, (error, buffer) => {
      if (error) {
        this.status = 404;
        this.statusText = error.message;
        if (typeof this.onerror === "function") {
          this.onerror(error);
        }
        return;
      }

      this.status = 200;
      this.statusText = "OK";
      this.response = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      if (typeof this.onload === "function") {
        this.onload();
      }
    });
  }
}

global.XMLHttpRequest = LocalFileXMLHttpRequest;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {
    caseId: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--case") {
      result.caseId = args[index + 1] ?? null;
      index += 1;
    }
  }

  return result;
};

const parseJson5File = (filePath) => {
  const text = fs.readFileSync(filePath, "utf8");
  return JSON5.parse(text);
};

const loadBundleManifest = () => {
  return parseJson5File(path.join(ROOT_DIR, "transform-bundles.json5"));
};

const loadBundleFiles = (bundleManifest) => {
  const bundleFiles = {};

  for (const bundle of bundleManifest.bundles || []) {
    if (!bundle?.id || !bundle?.path) {
      continue;
    }

    bundleFiles[bundle.id] = parseJson5File(path.join(ROOT_DIR, bundle.path));
  }

  return bundleFiles;
};

const buildTokenizer = () => {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: path.join(ROOT_DIR, "dict") }).build((error, tokenizer) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(tokenizer);
    });
  });
};

const loadStages = (overridePayload = null) => {
  const bundleManifest = loadBundleManifest();
  const bundleFiles = loadBundleFiles(bundleManifest);
  const overrides = overridePayload
    ? TransformEngine.normalizeBundleOverridesPayload(overridePayload)
    : {};
  return TransformEngine.loadStagesFromDefinitions(bundleManifest, bundleFiles, overrides);
};

const filterStages = (stages, activeBundles) => {
  if (!Array.isArray(activeBundles) || activeBundles.length === 0) {
    return stages;
  }

  const activeSet = new Set(activeBundles);
  return stages.filter((stage) => activeSet.has(stage.id));
};

const summarizeStages = (stages) => {
  return stages.map((stage) => `${stage.order}:${stage.id}`).join(", ");
};

const FIXTURES = [
  {
    id: "wakaru-basic",
    input: "分かる",
    expected: "分る",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 基本形"
  },
  {
    id: "wakaru-masu",
    input: "分かります",
    expected: "分ります",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 連用形 + 助動詞"
  },
  {
    id: "wakaru-mizen",
    input: "分からない",
    expected: "分らない",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 未然形 fallback"
  },
  {
    id: "wakaru-katei",
    input: "分かれば",
    expected: "分れば",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 仮定形 fallback"
  },
  {
    id: "wakaru-imperative",
    input: "分かれ",
    expected: "分れ",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 命令形 fallback"
  },
  {
    id: "ataru-katei",
    input: "当たれば",
    expected: "当れば",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 仮定形"
  },
  {
    id: "ataru-imperative",
    input: "当たれ",
    expected: "当れ",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・ラ行 命令形"
  },
  {
    id: "kakidasu-past",
    input: "書き出した",
    expected: "書出した",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・サ行 過去形"
  },
  {
    id: "kakidasu-katei",
    input: "書き出せば",
    expected: "書出せば",
    activeBundles: ["okurigana-abbreviation"],
    note: "五段・サ行 仮定形"
  },
  {
    id: "nayami-kakidasu",
    input: "悩みを書き出す。",
    expected: "悩を書出す｡",
    activeBundles: ["surface-normalization", "okurigana-abbreviation"],
    note: "連用名詞 + 動詞 + 記号"
  },
  {
    id: "mendougoto-ataru",
    input: "面倒ごとに当たる。",
    expected: "事に当る｡",
    activeBundles: ["surface-normalization", "lexical-replacements", "okurigana-abbreviation"],
    note: "既定 sequence + 動詞 + 記号"
  },
  {
    id: "kiseki",
    input: "奇跡が起きた。",
    expected: "奇蹟が起きた｡",
    activeBundles: ["surface-normalization", "official-homophone-restoration"],
    note: "告示・同音書換復元 + 記号"
  }
];

const OVERRIDE_PAYLOAD = {
  roots: [
    {
      id: "okurigana-abbreviation",
      label: "送り仮名省略",
      kind: "token-rules",
      order: 30,
      enabled: true,
      entries: [
        {
          id: "wakaru-entry",
          from: "分かる",
          to: "分る",
          type: "verb",
          priority: 80,
          enabled: true,
          regex: false,
          match_target: "basic_form"
        },
        {
          id: "nayami-entry",
          from: "悩み",
          to: "悩",
          type: "renyou",
          priority: 75,
          enabled: true,
          regex: false
        },
        {
          id: "kakidasu-entry",
          from: "書き出す",
          to: "書出す",
          type: "verb",
          priority: 70,
          enabled: true,
          regex: false,
          match_target: "basic_form"
        },
        {
          id: "ataru-entry",
          from: "当たる",
          to: "当る",
          type: "verb",
          priority: 65,
          enabled: true,
          regex: false,
          match_target: "basic_form"
        }
      ],
      children: []
    },
    {
      id: "runtime-override-check",
      label: "runtime override check",
      kind: "token-rules",
      order: 25,
      enabled: true,
      entries: [
        {
          id: "koto-condition",
          from: "こと",
          to: "ヿ",
          type: "literal",
          priority: 95,
          enabled: true,
          regex: false,
          conditions: {
            current: [{ pos: "名詞", basic: "こと" }],
            prev: [{ pos: "動詞" }]
          }
        },
        {
          id: "mendou-sequence",
          from: "面倒 ごと",
          to: "面倒事",
          type: "replace-rule",
          priority: 90,
          enabled: true,
          regex: false,
          sequence: [
            { surface: "面倒", pos: "名詞" },
            { surface: "ごと", pos: "名詞", pos1: "接尾" }
          ]
        }
      ],
      children: []
    }
  ]
};

const OVERRIDE_FIXTURES = [
  {
    id: "override-wakaru-mizen",
    input: "分からない",
    expected: "分らない",
    activeBundles: ["okurigana-abbreviation"],
    note: "override 復元後も verb rule が token-rules のまま働く"
  },
  {
    id: "override-koto-condition",
    input: "すること",
    expected: "するヿ",
    activeBundles: ["runtime-override-check"],
    note: "current/prev 条件を保持"
  },
  {
    id: "override-sequence",
    input: "面倒ごと",
    expected: "面倒事",
    activeBundles: ["runtime-override-check"],
    note: "sequence を保持"
  }
];

const verifyStageOrder = (stages) => {
  const expectedIds = [
    "surface-normalization",
    "lexical-replacements",
    "okurigana-abbreviation",
    "legacy-kanji",
    "official-homophone-restoration",
    "homophone-kanji",
    "general-character-replacements"
  ];

  const actualIds = stages.map((stage) => stage.id);
  const matchesExpected = expectedIds.every((id, index) => actualIds[index] === id);
  const isSorted = stages.every((stage, index) => {
    if (index === 0) {
      return true;
    }
    return (stages[index - 1].order ?? 0) <= (stage.order ?? 0);
  });

  return {
    passed: matchesExpected && isSorted,
    expectedIds,
    actualIds
  };
};

const verifyOverrideRestoration = (stages) => {
  const targetStage = stages.find((stage) => stage.id === "runtime-override-check");
  if (!targetStage || targetStage.kind !== "token-rules") {
    return {
      passed: false,
      details: "runtime-override-check が token-rules として復元されていません。"
    };
  }

  const hasConditionRule = targetStage.rules.some((rule) => rule.from === "こと" && rule.conditions?.prev && rule.conditions?.current);
  const hasSequenceRule = targetStage.rules.some((rule) => Array.isArray(rule.sequence) && rule.sequence.length === 2);
  const hasBasicFormVerb = stages
    .find((stage) => stage.id === "okurigana-abbreviation")
    ?.rules.some((rule) => rule.from === "分かる" && rule.match_target === "basic_form" && rule.type === "verb");

  return {
    passed: Boolean(hasConditionRule && hasSequenceRule && hasBasicFormVerb),
    details: {
      hasConditionRule,
      hasSequenceRule,
      hasBasicFormVerb
    }
  };
};

const runFixtureSet = (label, stages, fixtures, tokenizer, caseId = null) => {
  const targetFixtures = caseId
    ? fixtures.filter((fixture) => fixture.id === caseId)
    : fixtures;

  const results = [];

  for (const fixture of targetFixtures) {
    const activeStages = filterStages(stages, fixture.activeBundles);
    const actual = TransformEngine.transformTextWithStages(fixture.input, activeStages, tokenizer);
    results.push({
      ...fixture,
      scope: label,
      actual,
      passed: actual === fixture.expected,
      stageSummary: summarizeStages(activeStages)
    });
  }

  return results;
};

const printFixtureResults = (results) => {
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    console.log(`${prefix} [${result.scope}] ${result.id} :: ${result.note}`);
    if (!result.passed) {
      console.log(`  input:    ${result.input}`);
      console.log(`  expected: ${result.expected}`);
      console.log(`  actual:   ${result.actual}`);
      console.log(`  stages:   ${result.stageSummary}`);
    }
  }
};

const main = async () => {
  const { caseId } = parseArgs();
  const tokenizer = await buildTokenizer();

  if (caseId) {
    const exists = [...FIXTURES, ...OVERRIDE_FIXTURES].some((fixture) => fixture.id === caseId);
    if (!exists) {
      throw new Error(`fixture が見つかりません: ${caseId}`);
    }
  }

  const defaultLoaded = loadStages();
  const overrideLoaded = loadStages(OVERRIDE_PAYLOAD);

  const orderCheck = verifyStageOrder(defaultLoaded.stages);
  console.log(orderCheck.passed
    ? `PASS [stage-order] ${orderCheck.actualIds.join(" -> ")}`
    : `FAIL [stage-order] expected=${orderCheck.expectedIds.join(" -> ")} actual=${orderCheck.actualIds.join(" -> ")}`);

  const overrideCheck = verifyOverrideRestoration(overrideLoaded.stages);
  console.log(overrideCheck.passed
    ? "PASS [override-restore] token-rules / basic_form / conditions / sequence"
    : `FAIL [override-restore] ${JSON.stringify(overrideCheck.details)}`);

  const defaultResults = runFixtureSet("default", defaultLoaded.stages, FIXTURES, tokenizer, caseId);
  const overrideResults = runFixtureSet("override", overrideLoaded.stages, OVERRIDE_FIXTURES, tokenizer, caseId);

  printFixtureResults(defaultResults);
  printFixtureResults(overrideResults);

  const allPassed = orderCheck.passed &&
    overrideCheck.passed &&
    [...defaultResults, ...overrideResults].every((result) => result.passed);

  if (!allPassed) {
    process.exitCode = 1;
    return;
  }

  console.log("PASS [summary] runtime verification completed.");
};

main().catch((error) => {
  console.error(`FAIL [fatal] ${error.stack || error.message}`);
  process.exitCode = 1;
});

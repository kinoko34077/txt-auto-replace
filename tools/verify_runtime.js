"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const JSON5 = require(path.join(ROOT_DIR, "lib", "json5.min.js"));
const kuromoji = require(path.join(ROOT_DIR, "lib", "kuromoji.js"));
const TransformShared = require(path.join(ROOT_DIR, "transform-shared.js"));
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

const transformWithCompiledPlan = (input, stages, tokenizer, options = {}) => {
  const revision = Number(options.revision) || 1;
  const plan = TransformEngine.compileRuntimePlan(stages, { revision });
  const metrics = options.metrics ?? null;
  const actual = TransformEngine.transformTextWithPlan(input, plan, tokenizer, { metrics });
  return {
    actual,
    plan,
    metrics
  };
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
  },
  {
    id: "katakana-long-vowel-computer",
    input: "コンピューター",
    expected: "コンピュータ",
    activeBundles: ["katakana-long-vowel-abbreviation"],
    note: "katakana trailing long vowel abbreviation"
  },
  {
    id: "katakana-long-vowel-user",
    input: "ユーザー",
    expected: "ユーザ",
    activeBundles: ["katakana-long-vowel-abbreviation"],
    note: "katakana trailing long vowel abbreviation"
  },
  {
    id: "katakana-long-vowel-excluded",
    input: "バッター",
    expected: "バッター",
    activeBundles: ["katakana-long-vowel-abbreviation"],
    note: "katakana long vowel exclusion entry"
  },
  {
    id: "katakana-long-vowel-standard",
    input: "\u30b9\u30bf\u30f3\u30c0\u30fc\u30c9",
    expected: "\u30b9\u30bf\u30f3\u30c0\u30fc\u30c9",
    activeBundles: ["katakana-long-vowel-abbreviation"],
    note: "internal long vowel mark is preserved"
  },
  {
    id: "katakana-long-vowel-computer-particle",
    input: "\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u30fc\u306f",
    expected: "\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u306f",
    activeBundles: ["katakana-long-vowel-abbreviation"],
    note: "trailing long vowel before non-katakana boundary"
  },
  {
    id: "katakana-long-vowel-user-interface",
    input: "\u30e6\u30fc\u30b6\u30fc\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9",
    expected: "\u30e6\u30fc\u30b6\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9",
    activeBundles: ["katakana-long-vowel-abbreviation"],
    note: "internal compound katakana long vowel boundary"
  }
  ,
  {
    id: "stage4-kawaru-basic",
    input: "\u5909\u308f\u308b",
    expected: "\u5909\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 stem compression"
  },
  {
    id: "stage4-okonau-basic",
    input: "\u884c\u306a\u3046",
    expected: "\u884c\u3046",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 removable kana in stem"
  },
  {
    id: "stage4-agaru-basic",
    input: "\u4e0a\u304c\u308b",
    expected: "\u4e0a\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 godan final compression"
  },
  {
    id: "stage4-owareba",
    input: "\u7d42\u308f\u308c\u3070",
    expected: "\u7d42\u308c\u3070",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 katei form compression"
  },
  {
    id: "stage4-hashiri",
    input: "\u8d70\u308a",
    expected: "\u8d70",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 renyou abbreviation"
  },
  {
    id: "stage4-yomi-nagara",
    input: "\u8aad\u307f\u4e4d\u3089",
    expected: "\u8aad\u4e4d\u3089",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 renyou before non-masu suffix"
  },
  {
    id: "stage4-hashiri-tai",
    input: "\u8d70\u308a\u5ea6\u3044",
    expected: "\u8d70\u5ea6\u3044",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 renyou before adjective-like suffix"
  },
  {
    id: "stage4-kaki-hajimeru",
    input: "\u66f8\u304d\u59cb\u3081\u308b",
    expected: "\u66f8\u59cb\u3081\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 compound verb prefix"
  },
  {
    id: "stage4-kakimasu",
    input: "\u66f8\u304d\u307e\u3059",
    expected: "\u66f8\u304d\u307e\u3059",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps renyou before masu"
  },
  {
    id: "stage4-mochi-agaru",
    input: "\u6301\u3061\u4e0a\u304c\u308b",
    expected: "\u6301\u4e0a\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 final godan inside compound"
  },
  {
    id: "stage4-utsuri-kawaru",
    input: "\u79fb\u308a\u5909\u308f\u308b",
    expected: "\u79fb\u5909\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 chained compound verbs"
  },
  {
    id: "stage4-tsumi-ageru",
    input: "\u7a4d\u307f\u4e0a\u3052\u308b",
    expected: "\u7a4d\u4e0a\u3052\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps final ichidan predicate"
  },
  {
    id: "stage4-hashiri-nukeru",
    input: "\u8d70\u308a\u629c\u3051\u308b",
    expected: "\u8d70\u629c\u3051\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps final ichidan predicate in compound"
  },
  {
    id: "stage4-tsumi-age",
    input: "\u7a4d\u307f\u4e0a\u3052",
    expected: "\u7a4d\u4e0a",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 drops final ichidan renyou nominalization"
  },
  {
    id: "stage4-kake-nuke",
    input: "\u99c6\u3051\u629c\u3051",
    expected: "\u99c6\u629c",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 drops both renyou parts in compound nominalization"
  },
  {
    id: "stage4-tachidomari",
    input: "\u7acb\u3061\u6b62\u307e\u308a",
    expected: "\u7acb\u6b62\u308a",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 compresses compound renyou nominalization by segment"
  },
  {
    id: "stage4-otoiawase",
    input: "\u304a\u554f\u3044\u5408\u308f\u305b",
    expected: "\u304a\u554f\u5408\u305b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 compresses compound noun after prefix token"
  },
  {
    id: "stage4-moushikomi",
    input: "\u7533\u3057\u8fbc\u307f",
    expected: "\u7533\u8fbc",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 drops one-kana final segment in compound noun"
  },
  {
    id: "stage4-kakunin-suru",
    input: "\u78ba\u8a8d\u3059\u308b",
    expected: "\u78ba\u8a8d\u3059",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 sahen terminal"
  },
  {
    id: "stage4-kakunin-suru-baai",
    input: "\u78ba\u8a8d\u3059\u308b\u5834\u5408",
    expected: "\u78ba\u8a8d\u3059\u308b\u5834\u5408",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps sahen attributive before noun"
  },
  {
    id: "stage4-kakunin-sureba",
    input: "\u78ba\u8a8d\u3059\u308c\u3070",
    expected: "\u78ba\u8a8d\u305b\u3070",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 sahen katei"
  },
  {
    id: "stage4-kakunin-shita",
    input: "\u78ba\u8a8d\u3057\u305f",
    expected: "\u78ba\u8a8d\u3057\u305f",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps sahen past"
  },
  {
    id: "stage4-kakunin-shi",
    input: "\u78ba\u8a8d\u3057",
    expected: "\u78ba\u8a8d\u3057",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps sahen renyou"
  },
  {
    id: "stage4-kakunin-shite",
    input: "\u78ba\u8a8d\u3057\u3066",
    expected: "\u78ba\u8a8d\u3057\u3066",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps sahen te-form"
  },
  {
    id: "stage4-kakunin-shimasu",
    input: "\u78ba\u8a8d\u3057\u307e\u3059",
    expected: "\u78ba\u8a8d\u3057\u307e\u3059",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps sahen masu"
  },
  {
    id: "stage4-kakunin-shiyou",
    input: "\u78ba\u8a8d\u3057\u3088\u3046",
    expected: "\u78ba\u8a8d\u3057\u3088\u3046",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps sahen volitional"
  },
  {
    id: "stage4-motte",
    input: "\u6301\u3063\u3066",
    expected: "\u6301\u3063\u3066",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 skips te-form phonological kana"
  },
  {
    id: "stage4-matta",
    input: "\u5f85\u3063\u305f",
    expected: "\u5f85\u3063\u305f",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 skips ta-form phonological kana"
  },
  {
    id: "stage4-yonda",
    input: "\u8aad\u3093\u3060",
    expected: "\u8aad\u3093\u3060",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 skips onbin past"
  },
  {
    id: "stage4-kaita",
    input: "\u66f8\u3044\u305f",
    expected: "\u66f8\u3044\u305f",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 skips i-onbin past"
  },
  {
    id: "stage4-tenjite",
    input: "転じて",
    expected: "転じて",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps jite te-form"
  },
  {
    id: "stage4-soujite",
    input: "総じて",
    expected: "総じて",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps jite te-form"
  },
  {
    id: "stage4-takamari",
    input: "高まり",
    expected: "高り",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 removes removable ma before renyou suffix"
  },
  {
    id: "stage4-atsumari",
    input: "集まり",
    expected: "集り",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 removes removable ma before renyou suffix"
  },
  {
    id: "stage4-takamatta",
    input: "高まった",
    expected: "高った",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 removes removable ma before ta-form suffix"
  },
  {
    id: "stage4-atsumatta",
    input: "集まった",
    expected: "集った",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 removes removable ma before ta-form suffix"
  },
  {
    id: "stage4-surechigau",
    input: "\u3059\u308c\u9055\u3046",
    expected: "\u3059\u308c\u9055\u3046",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 preserves kana prefix before kanji segment"
  },
  {
    id: "stage4-yokotawaru",
    input: "\u6a2a\u305f\u308f\u308b",
    expected: "\u6a2a\u305f\u308f\u308b",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 does not remove non-removable stem kana"
  },
  {
    id: "stage4-kudasai",
    input: "\u4e0b\u3055\u3044",
    expected: "\u4e0b\u3055\u3044",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 keeps non-independent auxiliary verb"
  },
  {
    id: "stage4-sunawachi",
    input: "\u5373\u3061",
    expected: "\u5373\u3061",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 does not shorten non-verb conjunction"
  },
  {
    id: "stage4-nochi",
    input: "\u4e43\u3061",
    expected: "\u4e43\u3061",
    activeBundles: ["okurigana-abbreviation-stage4"],
    note: "stage4 does not shorten single-segment noun"
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
        },
        {
          id: "nai-entry",
          from: "\u306A\u3044",
          to: "\u7121\u3044",
          type: "adjective",
          priority: 64,
          enabled: true,
          regex: false,
          match_target: "basic_form",
          conditions: {
            current: [{ pos: "\u5F62\u5BB9\u8A5E", pos1: "\u81EA\u7ACB", basic: "\u306A\u3044" }]
          }
        },
        {
          id: "naru-entry",
          from: "\u306A\u308B",
          to: "\u6210\u308B",
          type: "verb",
          priority: 63,
          enabled: true,
          regex: false,
          match_target: "basic_form"
        },
        {
          id: "ima-entry",
          from: "\u3044\u307E",
          to: "\u4ECA",
          priority: 61,
          enabled: true,
          regex: false,
          conditions: {
            current: [{ pos: "\u540D\u8A5E", pos1: "\u526F\u8A5E\u53EF\u80FD" }]
          }
        },
        {
          id: "yoi-entry",
          from: "\u3088\u3044",
          to: "\u5584\u3044",
          type: "adjective",
          priority: 60,
          enabled: true,
          regex: false,
          match_target: "basic_form",
          conditions: {
            current: [{ pos: "\u5F62\u5BB9\u8A5E", pos1: "\u81EA\u7ACB", basic: "\u3088\u3044" }]
          }
        },
        {
          id: "comma-from-token-entry",
          from: "\u8A00\u3046, \u8A9E\u308B",
          to: "\u8FF0\u3079\u308B",
          type: "verb",
          priority: 62,
          enabled: true,
          regex: false,
          match_target: "basic_form"
        },
        {
          id: "iu-entry",
          from: "\u3044\u3046",
          to: "\u8A00\u3046",
          type: "verb",
          priority: 61,
          enabled: true,
          regex: false,
          match_target: "basic_form",
          conditions: {
            current: [{ pos: "\u52D5\u8A5E", basic: "\u3044\u3046" }]
          }
        },
        {
          id: "iru-entry",
          from: "\u3044\u308B",
          to: "\u3090\u308B",
          type: "verb",
          priority: 60,
          enabled: true,
          regex: false,
          match_target: "basic_form",
          conditions: {
            current: [{ pos: "\u52D5\u8A5E", basic: "\u3044\u308B" }]
          }
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
    },
    {
      id: "comma-dictionary-check",
      label: "comma dictionary check",
      kind: "dictionary-rules",
      order: 58,
      enabled: true,
      entries: [
        {
          id: "comma-from-entry",
          from: "A,B",
          to: "C",
          priority: 50,
          enabled: true,
          regex: false
        }
      ],
      children: []
    },
    {
      id: "mixed-dictionary-check",
      label: "mixed dictionary check",
      kind: "dictionary-rules",
      order: 59,
      enabled: true,
      entries: [
        {
          id: "plain-kana-entry",
          from: "\u304B\u306A",
          to: "\u4EEE\u540D",
          priority: 51,
          enabled: true,
          regex: false
        },
        {
          id: "ra-suffix-entry",
          from: "\u3089",
          to: "\u7B49",
          priority: 52,
          enabled: true,
          regex: false,
          conditions: {
            current: [{ pos: "\u540D\u8A5E", pos1: "\u63A5\u5C3E", basic: "\u3089" }]
          }
        }
      ],
      children: []
    },
    {
      id: "general-character-replacements",
      label: "general character replacements override",
      kind: "token-rules",
      order: 60,
      enabled: true,
      entries: [
        {
          id: "override-ima-entry",
          from: "\u3044\u307E",
          to: "\u4ECA",
          priority: 61,
          enabled: true,
          regex: false,
          conditions: {
            current: [{ pos: "\u540D\u8A5E", pos1: "\u526F\u8A5E\u53EF\u80FD" }]
          }
        },
        {
          id: "override-yoi-entry",
          from: "\u3088\u3044",
          to: "\u5584\u3044",
          type: "adjective",
          priority: 60,
          enabled: true,
          regex: false,
          match_target: "basic_form",
          conditions: {
            current: [{ pos: "\u5F62\u5BB9\u8A5E", pos1: "\u81EA\u7ACB", basic: "\u3088\u3044" }]
          }
        },
        {
          id: "override-nai-entry",
          from: "\u306A\u3044",
          to: "\u7121\u3044",
          type: "adjective",
          priority: 59,
          enabled: true,
          regex: false,
          match_target: "basic_form",
          conditions: {
            current: [{ pos: "\u5F62\u5BB9\u8A5E", pos1: "\u81EA\u7ACB", basic: "\u306A\u3044" }]
          }
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
    expected: "\u5206\u3089\u306A\u3044",
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
  },
  {
    id: "override-nai-basic-form",
    input: "\u306A\u304F",
    expected: "\u7121\u304F",
    activeBundles: ["general-character-replacements"],
    note: "dictionary bundle override should run as token-rules"
  },
  {
    id: "override-nai-imperative",
    input: "\u306A\u304B\u308C",
    expected: "\u7121\u304B\u308C",
    activeBundles: ["general-character-replacements"],
    note: "adjective imperative-like form"
  },
  {
    id: "override-nai-nominal",
    input: "\u306A\u3055",
    expected: "\u7121\u3055",
    activeBundles: ["general-character-replacements"],
    note: "adjective nominalized form"
  },
  {
    id: "override-nai-stray-na",
    input: "\u306A",
    expected: "\u306A",
    activeBundles: ["general-character-replacements"],
    note: "standalone na should stay unchanged"
  },
  {
    id: "override-nai-auxiliary",
    input: "\u5206\u304B\u3089\u306A\u3044",
    expected: "\u5206\u3089\u306A\u3044",
    activeBundles: ["okurigana-abbreviation", "general-character-replacements"],
    note: "adjective current conditions should not rewrite auxiliary nai"
  },
  {
    id: "override-naru-basic-form",
    input: "\u306A\u308B",
    expected: "\u6210\u308B",
    activeBundles: ["okurigana-abbreviation"],
    note: "動詞の basic_form 一致"
  },
  {
    id: "override-naru-conditional-particle",
    input: "\u305D\u3046\u306A\u3089\u3002",
    expected: "\u305D\u3046\u306A\u3089\u3002",
    activeBundles: ["okurigana-abbreviation"],
    note: "未然形 fallback が別構文の なら を壊さない"
  },
  {
    id: "override-ima-does-not-hit-imasu",
    input: "\u3044\u307E\u3059",
    expected: "\u3044\u307E\u3059",
    activeBundles: ["general-character-replacements"],
    note: "noun token rule from overridden dictionary bundle should not behave like dictionary replacement"
  },
  {
    id: "override-yoi-basic-form",
    input: "\u3088\u3044",
    expected: "\u5584\u3044",
    activeBundles: ["general-character-replacements"],
    note: "adjective basic form should transform"
  },
  {
    id: "override-yoi-garu-connection",
    input: "\u3088\u3055",
    expected: "\u5584\u3055",
    activeBundles: ["general-character-replacements"],
    note: "adjective suffix form should transform"
  },
  {
    id: "override-yoi-imperative",
    input: "\u3088\u304B\u308C",
    expected: "\u5584\u304B\u308C",
    activeBundles: ["general-character-replacements"],
    note: "adjective imperative form should transform"
  },
  {
    id: "override-comma-token-first-candidate",
    input: "\u8A00\u3046",
    expected: "\u8FF0\u3079\u308B",
    activeBundles: ["okurigana-abbreviation"],
    note: "comma-separated token rule should match first candidate"
  },
  {
    id: "override-comma-token-second-candidate-spaced",
    input: "\u8A9E\u308B",
    expected: "\u8FF0\u3079\u308B",
    activeBundles: ["okurigana-abbreviation"],
    note: "comma-separated token rule should ignore spaces and match second candidate"
  },
  {
    id: "override-iu-basic-form",
    input: "\u3044\u3046",
    expected: "\u8A00\u3046",
    activeBundles: ["okurigana-abbreviation"],
    note: "verb token rule should still transform actual iu tokens"
  },
  {
    id: "override-iu-iiko-should-stay",
    input: "\u3044\u3044\u5B50",
    expected: "\u3044\u3044\u5B50",
    activeBundles: ["okurigana-abbreviation"],
    note: "verb fallback must not rewrite non-verb substring"
  },
  {
    id: "override-iru-basic-form",
    input: "\u3044\u308B",
    expected: "\u3090\u308B",
    activeBundles: ["okurigana-abbreviation"],
    note: "verb token rule should still transform actual iru tokens"
  },
  {
    id: "override-mixed-dictionary-token-rule-does-not-hit-substring",
    input: "\u50D5\u3089",
    expected: "\u50D5\u3089",
    activeBundles: ["mixed-dictionary-check"],
    note: "conditioned suffix rule inside dictionary bundle must not fall back to plain substring replacement"
  },
  {
    id: "override-mixed-dictionary-token-rule-token-stage-exists",
    input: "\u3089",
    expected: "\u3089",
    activeBundles: ["mixed-dictionary-check"],
    note: "conditioned suffix rule may stay unmatched, but must remain on token path instead of plain replacement"
  },
  {
    id: "override-mixed-dictionary-plain-rule-still-runs",
    input: "\u304B\u306A",
    expected: "\u4EEE\u540D",
    activeBundles: ["mixed-dictionary-check"],
    note: "plain dictionary rule should remain on dictionary path in mixed bundle"
  },
  {
    id: "override-tsuyoi-should-stay",
    input: "\u3064\u3088\u3044",
    expected: "\u3064\u3088\u3044",
    activeBundles: ["general-character-replacements"],
    note: "substring should not trigger adjective rule"
  }
];

const verifyStageOrder = (stages) => {
  const expectedIds = [
    "surface-normalization",
    "katakana-long-vowel-abbreviation",
    "lexical-replacements",
    "okurigana-abbreviation",
    "okurigana-abbreviation-stage4",
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
  const generalReplacementStage = stages.find((stage) => stage.id === "general-character-replacements");
  const hasTokenizedGeneralReplacement = generalReplacementStage?.kind === "token-rules" &&
    generalReplacementStage.rules.some((rule) => rule.from === "\u306A\u3044" && rule.match_target === "basic_form");

  return {
    passed: Boolean(hasConditionRule && hasSequenceRule && hasBasicFormVerb && hasTokenizedGeneralReplacement),
    details: {
      hasConditionRule,
      hasSequenceRule,
      hasBasicFormVerb,
      generalReplacementStageKind: generalReplacementStage?.kind ?? null,
      hasTokenizedGeneralReplacement
    }
  };
};

const verifyOverrideRestorationV2 = (stages) => {
  const targetStage = stages.find((stage) => stage.id === "runtime-override-check" && stage.kind === "token-rules");
  if (!targetStage) {
    return {
      passed: false,
      details: "runtime-override-check is not restored as token-rules"
    };
  }

  const hasConditionRule = targetStage.rules.some((rule) => rule.conditions?.prev && rule.conditions?.current);
  const hasSequenceRule = targetStage.rules.some((rule) => Array.isArray(rule.sequence) && rule.sequence.length === 2);
  const okuriganaStages = stages.filter((stage) => stage.id === "okurigana-abbreviation");
  const hasBasicFormVerb = okuriganaStages.some((stage) => {
    return stage.kind === "token-rules" && stage.rules.some((rule) => {
      return rule.to === "\u5206\u308B" && rule.match_target === "basic_form" && rule.type === "verb";
    });
  });
  const generalReplacementStage = stages.find((stage) => {
    return stage.id === "general-character-replacements" && stage.kind === "token-rules";
  });
  const hasTokenizedGeneralReplacement = generalReplacementStage?.rules.some((rule) => {
    return rule.from === "\u306A\u3044" && rule.match_target === "basic_form";
  });
  const mixedDictionaryStages = stages.filter((stage) => stage.id === "mixed-dictionary-check");
  const hasMixedDictionaryStage = mixedDictionaryStages.some((stage) => {
    return stage.kind === "dictionary-rules" && stage.rules.some((rule) => rule.from === "\u304B\u306A");
  });
  const hasMixedTokenStage = mixedDictionaryStages.some((stage) => {
    return stage.kind === "token-rules" && stage.rules.some((rule) => rule.from === "\u3089" && rule.conditions?.current);
  });

  return {
    passed: Boolean(
      hasConditionRule &&
      hasSequenceRule &&
      hasBasicFormVerb &&
      hasTokenizedGeneralReplacement &&
      hasMixedDictionaryStage &&
      hasMixedTokenStage
    ),
    details: {
      hasConditionRule,
      hasSequenceRule,
      hasBasicFormVerb,
      generalReplacementStageKind: generalReplacementStage?.kind ?? null,
      hasTokenizedGeneralReplacement,
      mixedDictionaryStageKinds: mixedDictionaryStages.map((stage) => stage.kind),
      hasMixedDictionaryStage,
      hasMixedTokenStage
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

const verifyCandidateParsing = () => {
  const matchExpanded = TransformEngine.splitMatchCandidates("A[B,C]D");
  const replacementExpanded = TransformEngine.splitReplacementCandidates("A[B,C]D");
  const escapedExpanded = TransformEngine.splitMatchCandidates("A\\[B\\,C\\]");
  const unmatchedExpanded = TransformEngine.splitMatchCandidates("[");
  const danglingExpanded = TransformEngine.splitMatchCandidates("abc[");
  const emptyBracketExpanded = TransformEngine.splitMatchCandidates("[]");

  return {
    passed: JSON.stringify(matchExpanded) === JSON.stringify(["ABD", "ACD"]) &&
      JSON.stringify(replacementExpanded) === JSON.stringify(["ABD", "ACD"]) &&
      JSON.stringify(escapedExpanded) === JSON.stringify(["A[B,C]"]) &&
      JSON.stringify(unmatchedExpanded) === JSON.stringify(["["]) &&
      JSON.stringify(danglingExpanded) === JSON.stringify(["abc["]) &&
      JSON.stringify(emptyBracketExpanded) === JSON.stringify(["[]"]),
    details: {
      matchExpanded,
      replacementExpanded,
      escapedExpanded,
      unmatchedExpanded,
      danglingExpanded,
      emptyBracketExpanded
    }
  };
};

const verifyManifestFallbackWithoutStorageOverride = () => {
  const loaded = loadStages();
  const stage = loaded.stages.find((candidate) => candidate.id === "surface-normalization");
  return {
    passed: Boolean(stage) && Array.isArray(stage.rules) && stage.rules.length > 0,
    details: {
      stageRuleCount: Array.isArray(stage?.rules) ? stage.rules.length : 0,
      stageIds: loaded.stages.map((candidate) => candidate.id)
    }
  };
};

const verifyEmptyOverrideSuppressesManifestRules = () => {
  const loaded = loadStages({
    roots: [
      {
        id: "surface-normalization",
        label: "surface-normalization",
        kind: "token-rules",
        enabled: true,
        order: 10,
        entries: [],
        children: []
      }
    ]
  });

  const stage = loaded.stages.find((candidate) => candidate.id === "surface-normalization");
  return {
    passed: !stage || (Array.isArray(stage.rules) && stage.rules.length === 0),
    details: {
      stageRuleCount: Array.isArray(stage?.rules) ? stage.rules.length : 0,
      stageIds: loaded.stages.map((candidate) => candidate.id)
    }
  };
};

const verifyStoredRootsSuppressMissingManifestBundles = () => {
  const loaded = loadStages({
    roots: [
      {
        id: "runtime-managed-only",
        label: "runtime-managed-only",
        kind: "dictionary-rules",
        enabled: true,
        order: 1,
        entries: [
          {
            id: "runtime-managed-entry",
            from: "managed-source",
            to: "managed-target",
            enabled: true,
            regex: false
          }
        ],
        children: []
      }
    ]
  });

  const manifestStage = loaded.stages.find((candidate) => candidate.id === "legacy-kanji");
  const managedStage = loaded.stages.find((candidate) => candidate.id === "runtime-managed-only");
  return {
    passed: !manifestStage && Boolean(managedStage) && managedStage.rules?.length === 1,
    details: {
      stageIds: loaded.stages.map((candidate) => candidate.id),
      managedRuleCount: Array.isArray(managedStage?.rules) ? managedStage.rules.length : 0
    }
  };
};

const verifyDisabledTokenSubtree = () => {
  const loaded = loadStages({
    roots: [
      {
        id: "runtime-override-check",
        label: "runtime-override-check",
        kind: "token-rules",
        enabled: true,
        order: 90,
        entries: [
          {
            id: "root-entry",
            from: "甲",
            to: "甲-root",
            enabled: true,
            regex: false
          }
        ],
        children: [
          {
            id: "disabled-child",
            label: "disabled-child",
            kind: "token-rules",
            enabled: false,
            entries: [
              {
                id: "disabled-entry",
                from: "乙",
                to: "乙-disabled",
                enabled: true,
                regex: false
              }
            ],
            children: []
          },
          {
            id: "enabled-child",
            label: "enabled-child",
            kind: "token-rules",
            enabled: true,
            entries: [
              {
                id: "enabled-entry",
                from: "丙",
                to: "丙-enabled",
                enabled: true,
                regex: false
              }
            ],
            children: []
          }
        ]
      }
    ]
  });

  const stage = loaded.stages.find((candidate) => candidate.id === "runtime-override-check" && candidate.kind === "token-rules");
  const ruleMap = new Map((stage?.rules ?? []).map((rule) => [rule.from, rule.to]));
  return {
    passed: Boolean(stage) &&
      ruleMap.get("甲") === "甲-root" &&
      ruleMap.get("丙") === "丙-enabled" &&
      !ruleMap.has("乙"),
    details: {
      rules: stage?.rules?.map((rule) => ({
        from: rule.from,
        to: rule.to,
        enabled: rule.enabled !== false
      })) ?? []
    }
  };
};

const verifyDisabledOverrideEntries = () => {
  const loaded = loadStages({
    roots: [
      {
        id: "disabled-entry-dictionary",
        label: "disabled-entry-dictionary",
        kind: "dictionary-rules",
        enabled: true,
        order: 91,
        entries: [
          {
            id: "disabled-dictionary-entry",
            from: "disabled-dic",
            to: "disabled-dic-hit",
            enabled: false,
            regex: false
          },
          {
            id: "enabled-dictionary-entry",
            from: "enabled-dic",
            to: "enabled-dic-hit",
            enabled: true,
            regex: false
          }
        ],
        children: []
      },
      {
        id: "disabled-entry-token",
        label: "disabled-entry-token",
        kind: "token-rules",
        enabled: true,
        order: 92,
        entries: [
          {
            id: "disabled-token-entry",
            from: "disabled-token",
            to: "disabled-token-hit",
            enabled: false,
            regex: false
          },
          {
            id: "enabled-token-entry",
            from: "enabled-token",
            to: "enabled-token-hit",
            enabled: true,
            regex: false
          }
        ],
        children: []
      }
    ]
  });

  const dictionaryStage = loaded.stages.find((candidate) => candidate.id === "disabled-entry-dictionary");
  const tokenStage = loaded.stages.find((candidate) => candidate.id === "disabled-entry-token");
  const dictionaryRuleMap = new Map((dictionaryStage?.rules ?? []).map((rule) => [rule.from, rule.to]));
  const tokenRuleMap = new Map((tokenStage?.rules ?? []).map((rule) => [rule.from, rule.to]));
  return {
    passed:
      dictionaryRuleMap.get("enabled-dic") === "enabled-dic-hit" &&
      !dictionaryRuleMap.has("disabled-dic") &&
      tokenRuleMap.get("enabled-token") === "enabled-token-hit" &&
      !tokenRuleMap.has("disabled-token"),
    details: {
      dictionaryRules: dictionaryStage?.rules?.map((rule) => ({ from: rule.from, enabled: rule.enabled !== false })) ?? [],
      tokenRules: tokenStage?.rules?.map((rule) => ({ from: rule.from, enabled: rule.enabled !== false })) ?? []
    }
  };
};

const verifyWildcardBehavior = (tokenizer) => {
  const dictionaryStages = [
    {
      id: "wildcard-dictionary",
      kind: "dictionary-rules",
      order: 1,
      rules: [
        {
          from: "*い",
          from_options: ["*い"],
          to: "*",
          candidates: ["*"],
          regex: false,
          enabled: true,
          priority: 10
        },
        {
          from: "A*B*C",
          from_options: ["A*B*C"],
          to: "X*Y*",
          candidates: ["X*Y*"],
          regex: false,
          enabled: true,
          priority: 10
        },
        {
          from: "\\*印",
          from_options: ["\\*印"],
          to: "記号",
          candidates: ["記号"],
          regex: false,
          enabled: true,
          priority: 10
        }
      ]
    }
  ];

  const tokenStages = [
    {
      id: "wildcard-token",
      kind: "token-rules",
      order: 1,
      rules: [
        {
          from: "高い",
          from_options: ["高い"],
          to: "高",
          candidates: ["高"],
          regex: false,
          enabled: true,
          priority: 10,
          conditions: {
            current: {
              pos: "形*"
            }
          }
        }
      ]
    }
  ];

  const dictionarySuffix = TransformEngine.transformTextWithStages("高い", dictionaryStages, tokenizer);
  const dictionaryCaptured = TransformEngine.transformTextWithStages("AfooBbarC", dictionaryStages, tokenizer);
  const dictionaryEscaped = TransformEngine.transformTextWithStages("*印", dictionaryStages, tokenizer);
  const tokenConditionWildcard = TransformEngine.transformTextWithStages("高い", tokenStages, tokenizer);
  const kanaInsensitiveHiraganaRule = TransformEngine.transformTextWithStages("ネコ", [{
    id: "kana-insensitive-hiragana",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "ねこ",
      from_options: ["ねこ"],
      to: "猫",
      candidates: ["猫"],
      regex: false,
      enabled: true,
      priority: 10,
      match_options: { kana_insensitive: true }
    }]
  }], tokenizer);
  const kanaInsensitiveKatakanaRule = TransformEngine.transformTextWithStages("ねこ", [{
    id: "kana-insensitive-katakana",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "ネコ",
      from_options: ["ネコ"],
      to: "猫",
      candidates: ["猫"],
      regex: false,
      enabled: true,
      priority: 10,
      match_options: { kana_insensitive: true }
    }]
  }], tokenizer);
  const kanaSensitiveRule = TransformEngine.transformTextWithStages("ネコ", [{
    id: "kana-sensitive",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "ねこ",
      from_options: ["ねこ"],
      to: "猫",
      candidates: ["猫"],
      regex: false,
      enabled: true,
      priority: 10
    }]
  }], tokenizer);
  const kanaInsensitiveWildcard = TransformEngine.transformTextWithStages("ネコ", [{
    id: "kana-insensitive-wildcard",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "*こ",
      from_options: ["*こ"],
      to: "*子",
      candidates: ["*子"],
      regex: false,
      enabled: true,
      priority: 10,
      match_options: { kana_insensitive: true }
    }]
  }], tokenizer);

  return {
    passed:
      dictionarySuffix === "高" &&
      dictionaryCaptured === "XfooYbar" &&
      dictionaryEscaped === "記号" &&
      tokenConditionWildcard === "高" &&
      kanaInsensitiveHiraganaRule === "猫" &&
      kanaInsensitiveKatakanaRule === "猫" &&
      kanaSensitiveRule === "ネコ" &&
      kanaInsensitiveWildcard === "ネ子",
    details: {
      dictionarySuffix,
      dictionaryCaptured,
      dictionaryEscaped,
      tokenConditionWildcard,
      kanaInsensitiveHiraganaRule,
      kanaInsensitiveKatakanaRule,
      kanaSensitiveRule,
      kanaInsensitiveWildcard
    }
  };
};

const verifyRegexReplacementBehavior = (tokenizer) => {
  const compactStages = [{
    id: "regex-check",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "(\\d{4})年([1-9]|1[0-2])月([1-9]|[12]\\d|3[01])日",
      to: "$1$2$3",
      candidates: ["$1$2$3"],
      regex: true,
      enabled: true,
      priority: 10
    }]
  }];
  const slashStages = [{
    id: "regex-slash-check",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "(\\d{4})年(\\d{1,2})月(\\d{1,2})日",
      to: "$1/$2/$3",
      regex: true,
      enabled: true,
      priority: 10
    }]
  }];
  const actual = TransformEngine.transformTextWithStages("2026年6月13日", compactStages, tokenizer);
  const slashActual = TransformEngine.transformTextWithStages("2026年6月14日", slashStages, tokenizer);
  return {
    passed: actual === "2026613" && slashActual === "2026/6/14",
    details: { actual, slashActual }
  };
};

const verifyRegexReplacementBehaviorV2 = (tokenizer) => {
  const compactStages = [{
    id: "regex-check-v2",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "(\\d{4})\\u5e74([1-9]|1[0-2])\\u6708([1-9]|[12]\\d|3[01])\\u65e5",
      to: "$1$2$3",
      regex: true,
      enabled: true,
      priority: 10
    }]
  }];
  const slashStages = [{
    id: "regex-slash-check-v2",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "(\\d{4})\\u5e74(\\d{1,2})\\u6708(\\d{1,2})\\u65e5",
      to: "$1/$2/$3",
      regex: true,
      enabled: true,
      priority: 10
    }]
  }];
  const namedStages = [{
    id: "regex-named-check-v2",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "(?<year>\\d{4})\\u5e74(?<month>\\d{1,2})\\u6708(?<day>\\d{1,2})\\u65e5",
      to: "$<year>-$<month>-$<day>",
      regex: true,
      enabled: true,
      priority: 10
    }, {
      from: "abc",
      to: "[$&]-$$",
      regex: true,
      enabled: true,
      priority: 9
    }]
  }];
  const actual = TransformEngine.transformTextWithStages("2026年6月13日", compactStages, tokenizer);
  const slashActual = TransformEngine.transformTextWithStages("2026年6月14日", slashStages, tokenizer);
  const namedActual = TransformEngine.transformTextWithStages("2026年6月14日 abc", namedStages, tokenizer);
  return {
    passed:
      actual === "2026613" &&
      slashActual === "2026/6/14" &&
      namedActual === "2026-6-14 [abc]-$",
    details: { actual, slashActual, namedActual }
  };
};

const verifyRegexRuleInTokenBundleBehavior = (tokenizer) => {
  const loaded = loadStages({
    roots: [
      {
        id: "regex-token-box",
        label: "regex-token-box",
        kind: "token-rules",
        enabled: true,
        order: 42,
        entries: [
          {
            id: "date-regex-token-entry",
            from: "(\\d{4})\\u5e74(\\d{1,2})\\u6708(\\d{1,2})\\u65e5",
            to: "$1$2$3",
            enabled: true,
            regex: true,
            priority: 100
          }
        ],
        children: []
      }
    ]
  });
  const actual = TransformEngine.transformTextWithStages(
    "2026\u5e746\u670814\u65e5",
    loaded.stages,
    tokenizer
  );
  const dictionaryStage = loaded.stages.find((stage) => stage.id === "regex-token-box" && stage.kind === "dictionary-rules");
  const tokenStage = loaded.stages.find((stage) => stage.id === "regex-token-box" && stage.kind === "token-rules");
  return {
    passed:
      actual === "2026614" &&
      Array.isArray(dictionaryStage?.rules) &&
      dictionaryStage.rules.some((rule) => rule.regex === true) &&
      (!tokenStage || !tokenStage.rules.some((rule) => rule.regex === true)),
    details: {
      actual,
      stageKinds: loaded.stages.map((stage) => `${stage.id}:${stage.kind}`),
      dictionaryRuleCount: dictionaryStage?.rules?.length ?? 0,
      tokenRuleCount: tokenStage?.rules?.length ?? 0
    }
  };
};

const verifyKatakanaLongVowelSettingsBehavior = (tokenizer) => {
  const stages = [{
    id: "katakana-long-vowel-abbreviation",
    kind: "token-rules",
    runtime_mode: "katakana-long-vowel-abbreviation",
    order: 15,
    settings: { min_length: 4 },
    rules: [{
      from: "\u30d0\u30c3\u30bf\u30fc",
      from_options: ["\u30d0\u30c3\u30bf\u30fc"],
      to: "\u30d0\u30c3\u30bf\u30fc",
      candidates: ["\u30d0\u30c3\u30bf\u30fc"],
      regex: false,
      enabled: true,
      priority: 100
    }]
  }];
  const user = TransformEngine.transformTextWithStages("\u30e6\u30fc\u30b6\u30fc", stages, tokenizer);
  const key = TransformEngine.transformTextWithStages("\u30ad\u30fc", stages, tokenizer);
  const compound = TransformEngine.transformTextWithStages(
    "\u30e6\u30fc\u30b6\u30fc\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9",
    stages,
    tokenizer
  );
  const excluded = TransformEngine.transformTextWithStages("\u30d0\u30c3\u30bf\u30fc", stages, tokenizer);
  return {
    passed:
      user === "\u30e6\u30fc\u30b6" &&
      key === "\u30ad\u30fc" &&
      compound === "\u30e6\u30fc\u30b6\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9" &&
      excluded === "\u30d0\u30c3\u30bf\u30fc",
    details: { user, key, compound, excluded }
  };
};

const verifySequenceConditionBehavior = (tokenizer) => {
  const stages = [{
    id: "sequence-condition-check",
    kind: "token-rules",
    order: 1,
    rules: [
      {
        from: "\u306f",
        from_options: ["\u306f"],
        to: "\u306f_MATCH",
        candidates: ["\u306f_MATCH"],
        regex: false,
        enabled: true,
        priority: 30,
        conditions: {
          prev: {
            sequence: [
              { surface: "\u79c1", pos: "\u540d\u8a5e" }
            ]
          }
        }
      },
      {
        from: "\u9762\u5012 \u3054\u3068",
        to: "\u9762\u5012\u4e8b_MATCH",
        candidates: ["\u9762\u5012\u4e8b_MATCH"],
        regex: false,
        enabled: true,
        priority: 20,
        sequence: [
          { surface: "\u9762\u5012", pos: "\u540d\u8a5e" },
          { surface: "\u3054\u3068", pos: "\u540d\u8a5e" }
        ],
        conditions: {
          current: {
            sequence: [
              { surface: "\u9762\u5012", pos: "\u540d\u8a5e" },
              { surface: "\u3054\u3068", pos: "\u540d\u8a5e" }
            ]
          },
          next: {
            sequence: [
              { surface: "\u306b", pos: "\u52a9\u8a5e" }
            ]
          }
        }
      },
      {
        from: "\u3053\u3068",
        from_options: ["\u3053\u3068"],
        to: "\u4e8b_NEG",
        candidates: ["\u4e8b_NEG"],
        regex: false,
        enabled: true,
        priority: 10,
        conditions: {
          current: { pos: "-[\u52d5\u8a5e,\u5f62\u5bb9\u8a5e]" }
        }
      }
    ]
  }];
  const prevSequence = TransformEngine.transformTextWithStages("\u79c1\u306f", stages, tokenizer);
  const currentNextSequence = TransformEngine.transformTextWithStages("\u9762\u5012\u3054\u3068\u306b", stages, tokenizer);
  const negativeNoun = TransformEngine.transformTextWithStages("\u3053\u3068", stages, tokenizer);
  return {
    passed:
      prevSequence === "\u79c1\u306f_MATCH" &&
      currentNextSequence === "\u9762\u5012\u4e8b_MATCH\u306b" &&
      negativeNoun === "\u4e8b_NEG",
    details: { prevSequence, currentNextSequence, negativeNoun }
  };
};

const verifyDictionaryCompiledBehavior = () => {
  const transform = (input, rules) => TransformEngine.transformTextWithStages(input, [{
    id: "compiled-dictionary",
    kind: "dictionary-rules",
    order: 1,
    rules
  }], null);

  const rule = (from, to, priority = 10) => ({
    from,
    from_options: [from],
    to,
    candidates: [to],
    regex: false,
    enabled: true,
    priority
  });

  const nonCascade = transform("A B", [
    rule("A", "B", 10),
    rule("B", "C", 10)
  ]);
  const longest = transform("ABC", [
    rule("AB", "X", 10),
    rule("ABC", "Y", 10)
  ]);
  const priority = transform("ABC", [
    rule("AB", "X", 100),
    rule("ABC", "Y", 10)
  ]);
  const order = transform("A", [
    rule("A", "X", 10),
    rule("A", "Y", 10)
  ]);

  const manyRules = [];
  for (let index = 0; index < 1200; index += 1) {
    manyRules.push(rule(`NO_MATCH_${index}`, "Z", 1));
  }
  manyRules.push(rule("TARGET", "OK", 10));
  const longInput = `${"x".repeat(40000)}TARGET`;
  const startedAt = Date.now();
  const performanceOutput = transform(longInput, manyRules);
  const elapsedMs = Date.now() - startedAt;

  return {
    passed:
      nonCascade === "B C" &&
      longest === "Y" &&
      priority === "XC" &&
      order === "X" &&
      performanceOutput.endsWith("OK") &&
      elapsedMs < 3000,
    details: {
      nonCascade,
      longest,
      priority,
      order,
      elapsedMs,
      performanceSuffix: performanceOutput.slice(-8)
    }
  };
};

const verifyCompiledPlanCompatibility = (stages, tokenizer) => {
  const fixtures = FIXTURES.slice(0, 12);
  const mismatches = [];

  for (const fixture of fixtures) {
    const activeStages = filterStages(stages, fixture.activeBundles);
    const direct = TransformEngine.transformTextWithStages(fixture.input, activeStages, tokenizer);
    const compiled = transformWithCompiledPlan(fixture.input, activeStages, tokenizer, { revision: 7 }).actual;
    if (direct !== compiled) {
      mismatches.push({
        id: fixture.id,
        direct,
        compiled
      });
    }
  }

  return {
    passed: mismatches.length === 0,
    details: {
      mismatches
    }
  };
};

const verifyTokenTriggerAndCaches = (stages, tokenizer) => {
  const lexicalStages = filterStages(stages, ["lexical-replacements"]);
  let tokenizeCalls = 0;
  const wrappedTokenizer = {
    tokenize(text) {
      tokenizeCalls += 1;
      return tokenizer.tokenize(text);
    }
  };
  const metrics = {
    planVersion: null,
    tokenizeCalls: 0,
    tokenizeSkipped: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
    tokenCacheHits: 0,
    tokenCacheMisses: 0,
    stageTimings: {}
  };
  const plan = TransformEngine.compileRuntimePlan(lexicalStages, { revision: 9 });
  const lexicalCompiledToken = plan.stages.find((stage) => stage.id === "lexical-replacements")?.compiledToken;
  const indexedSequenceRules = lexicalCompiledToken?.sequenceSurfaceMap?.get("面倒") ?? [];
  const skipped = TransformEngine.transformTextWithPlan("alphabet only text", plan, wrappedTokenizer, { metrics });
  const first = TransformEngine.transformTextWithPlan("それは面倒ごとです。", plan, wrappedTokenizer, { metrics });
  const second = TransformEngine.transformTextWithPlan("それは面倒ごとです。", plan, wrappedTokenizer, { metrics });
  const longMetrics = {
    tokenizeCalls: 0,
    tokenizeSkipped: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
    textCacheBypasses: 0,
    tokenCacheHits: 0,
    tokenCacheMisses: 0,
    tokenCacheBypasses: 0,
    processingMsTotal: 0,
    stageTimings: {}
  };
  const boundedPlan = TransformEngine.compileRuntimePlan(lexicalStages, {
    revision: 10,
    maxTextCacheLength: 4,
    maxTokenCacheLength: 4
  });
  const longInput = "それは面倒ごとです。";
  TransformEngine.transformTextWithPlan(longInput, boundedPlan, tokenizer, { metrics: longMetrics });
  TransformEngine.transformTextWithPlan(longInput, boundedPlan, tokenizer, { metrics: longMetrics });
  const dictionaryMetrics = {
    dictionaryMatches: 0,
    regexMatches: 0,
    wildcardMatches: 0,
    stageTimings: {}
  };
  const dictionaryStages = filterStages(stages, ["official-homophone-restoration"]);
  const dictionaryPlan = TransformEngine.compileRuntimePlan(dictionaryStages, { revision: 11 });
  TransformEngine.transformTextWithPlan("奇跡", dictionaryPlan, tokenizer, { metrics: dictionaryMetrics });

  return {
    passed: skipped === "alphabet only text" &&
      first === second &&
      tokenizeCalls === 1 &&
      metrics.tokenizeSkipped >= 1 &&
      metrics.textCacheHits >= 1 &&
      indexedSequenceRules.length >= 1 &&
      lexicalCompiledToken?.broadRules?.length === 0 &&
      Number(metrics.compileMs) >= 0 &&
      Number(metrics.processingMsTotal) >= 0 &&
      longMetrics.textCacheHits === 0 &&
      longMetrics.textCacheBypasses === 2 &&
      longMetrics.tokenCacheBypasses >= 2 &&
      dictionaryMetrics.dictionaryMatches >= 1,
    details: {
      skipped,
      first,
      second,
      tokenizeCalls,
      indexedSequenceRuleCount: indexedSequenceRules.length,
      broadRuleCount: lexicalCompiledToken?.broadRules?.length ?? null,
      metrics,
      longMetrics,
      dictionaryMetrics
    }
  };
};

const verifyRubyTransformBehavior = () => {
  const autoRubyStages = [{
    id: "ruby-auto-source",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9752\u6b6f",
      candidates: ["\u9752\u6b6f"],
      regex: false,
      enabled: true,
      priority: 100,
      match_options: {
        ruby_from_source: true
      }
    }]
  }];
  const explicitRubyStages = [{
    id: "ruby-explicit",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\uff5c\u9752\u6b6f\u300aBluetooth\u300b",
      candidates: ["\uff5c\u9752\u6b6f\u300aBluetooth\u300b"],
      regex: false,
      enabled: true,
      priority: 100,
      match_options: {
        ruby_from_source: true
      }
    }]
  }];
  const chainedRubyStages = [{
    id: "ruby-chain-1",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9752\u6b6f\u300aBluetooth\u300b",
      candidates: ["\u9752\u6b6f\u300aBluetooth\u300b"],
      regex: false,
      enabled: true,
      priority: 100
    }]
  }, {
    id: "ruby-chain-2",
    kind: "dictionary-rules",
    order: 2,
    rules: [{
      from: "\u9752\u6b6f",
      from_options: ["\u9752\u6b6f"],
      to: "\u9751\u9f52",
      candidates: ["\u9751\u9f52"],
      regex: false,
      enabled: true,
      priority: 90
    }]
  }, {
    id: "ruby-chain-source-candidate",
    kind: "dictionary-rules",
    order: 3,
    rules: [{
      from: "A",
      from_options: ["A", "B"],
      to: "X",
      candidates: ["X"],
      regex: false,
      enabled: true,
      priority: 80,
      match_options: {
        ruby_from_source: true
      }
    }]
  }];

  const autoRuby = TransformEngine.transformTextWithStages("Bluetooth", autoRubyStages, null);
  const reappliedAutoRuby = TransformEngine.transformTextWithStages(autoRuby, autoRubyStages, null);
  const explicitRuby = TransformEngine.transformTextWithStages("Bluetooth", explicitRubyStages, null);
  const chainedRuby = TransformEngine.transformTextWithStages("Bluetooth", chainedRubyStages, null);
  const trailingTextRuby = TransformEngine.transformTextWithStages("Bluetooth", [{
    id: "ruby-bar-at-replacement-head",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9752\u6b6f\u300aBluetooth\u300b\u3068\u8868\u8a18",
      candidates: ["\u9752\u6b6f\u300aBluetooth\u300b\u3068\u8868\u8a18"],
      regex: false,
      enabled: true,
      priority: 100
    }]
  }], null);
  const matchedSourceRuby = TransformEngine.transformTextWithStages("B", [{
    id: "ruby-source-candidate",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "A",
      from_options: ["A", "B"],
      to: "X",
      candidates: ["X"],
      regex: false,
      enabled: true,
      priority: 100,
      match_options: {
        ruby_from_source: true
      }
    }]
  }], null);
  const staleCandidateRuby = TransformEngine.transformTextWithStages("Bluetooth", [{
    id: "ruby-stale-candidate",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9752\u6b6f\u300aBluetooth\u300b",
      candidates: ["\u9752\u6b6f"],
      regex: false,
      enabled: true,
      priority: 100
    }]
  }], null);
  const shadowedRuby = TransformEngine.transformTextWithStages("Bluetooth", [{
    id: "ruby-shadow-earlier",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9751\u9f52",
      enabled: true,
      regex: false,
      priority: 90
    }]
  }, {
    id: "ruby-shadow-later",
    kind: "dictionary-rules",
    order: 2,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9751\u9f52\u300aBluetooth\u300b",
      enabled: true,
      regex: false,
      priority: 90
    }]
  }], null);
  const partialShadowRuby = TransformEngine.transformTextWithStages("ブルートゥース Bluetooth", [{
    id: "ruby-shadow-multi-earlier",
    kind: "dictionary-rules",
    order: 1,
    rules: [{
      from: "ブルートゥース",
      from_options: ["ブルートゥース", "Bluetooth"],
      to: "\u9751\u9f52",
      enabled: true,
      regex: false,
      priority: 90
    }]
  }, {
    id: "ruby-shadow-specific-later",
    kind: "dictionary-rules",
    order: 2,
    rules: [{
      from: "Bluetooth",
      from_options: ["Bluetooth"],
      to: "\u9751\u9f52\u300aBluetooth\u300b",
      enabled: true,
      regex: false,
      priority: 90
    }]
  }], null);

  return {
    passed:
      autoRuby === "\uff5c\u9752\u6b6f\u300aBluetooth\u300b" &&
      reappliedAutoRuby === "\uff5c\u9752\u6b6f\u300aBluetooth\u300b" &&
      explicitRuby === "\uff5c\u9752\u6b6f\u300aBluetooth\u300b" &&
      chainedRuby === "\uff5c\u9751\u9f52\u300aBluetooth\u300b" &&
      trailingTextRuby === "\uff5c\u9752\u6b6f\u300aBluetooth\u300b\u3068\u8868\u8a18" &&
      matchedSourceRuby === "\uff5cX\u300aB\u300b" &&
      staleCandidateRuby === "\uff5c\u9752\u6b6f\u300aBluetooth\u300b" &&
      shadowedRuby === "\uff5c\u9751\u9f52\u300aBluetooth\u300b" &&
      partialShadowRuby === "\u9751\u9f52 \uff5c\u9751\u9f52\u300aBluetooth\u300b",
    details: {
      autoRuby,
      reappliedAutoRuby,
      explicitRuby,
      chainedRuby,
      trailingTextRuby,
      matchedSourceRuby,
      staleCandidateRuby,
      shadowedRuby,
      partialShadowRuby
    }
  };
};

const verifyRubySharedBehavior = () => {
  const implicitNarou = TransformShared.parseRenderableRubySegments("山田太郎《やまだたろう》");
  const explicitNarou = TransformShared.parseRenderableRubySegments("｜山田太郎《やまだたろう》");
  const pageMarkers = TransformShared.parseRenderableRubySegments("漢字(かんじ)", { open: "(", close: ")" });
  const looseNarou = TransformShared.parseRenderableRubySegments("かな交じり《かなまじり》", undefined, {
    allowLooseNarouImplicitBase: true
  });
  const unmarkedLatinRuby = TransformShared.parseRenderableRubySegments("青歯《Bluetooth》", undefined, {
    allowLooseNarouImplicitBase: true
  });
  const latinRubyLimit10 = TransformShared.parseRenderableRubySegments("｜青歯《Bluetooth》", undefined, {
    maxBaseLength: 10,
    maxRubyLength: 10
  });
  const latinRubyLimit8 = TransformShared.parseRenderableRubySegments("｜青歯《Bluetooth》", undefined, {
    maxBaseLength: 10,
    maxRubyLength: 8
  });
  const latinRubyLengths = TransformShared.inspectRubyPairLimits("青歯", "Bluetooth", {
    maxBaseLength: 10,
    maxRubyLength: 10
  });
  const limitedNarou = TransformShared.parseRenderableRubySegments("かな交じり《かなまじり》", undefined, {
    allowLooseNarouImplicitBase: true,
    maxBaseLength: 2,
    maxRubyLength: 24
  });
  const effectiveRuby = TransformShared.resolveEffectiveRubySettings(
    {
      url_overrides: {
        "https://example.com/article": { open: "(", close: ")" }
      },
      domain_defaults: {
        "example.com": { open: "[", close: "]" }
      }
    },
    {
      enabled: true,
      hidden: false,
      default_markers: { open: "《", close: "》" }
    },
    "https://example.com/article",
    "example.com"
  );

  return {
    passed:
      implicitNarou.length === 1 &&
      implicitNarou[0].type === "ruby" &&
      implicitNarou[0].base === "山田太郎" &&
      implicitNarou[0].ruby === "やまだたろう" &&
      explicitNarou.length === 1 &&
      explicitNarou[0].type === "ruby" &&
      explicitNarou[0].base === "山田太郎" &&
      pageMarkers.length === 1 &&
      pageMarkers[0].type === "ruby" &&
      pageMarkers[0].base === "漢字" &&
      pageMarkers[0].ruby === "かんじ" &&
      looseNarou.length === 1 &&
      looseNarou[0].type === "ruby" &&
      looseNarou[0].base === "かな交じり" &&
      unmarkedLatinRuby.length === 1 &&
      unmarkedLatinRuby[0].type === "text" &&
      latinRubyLimit10.length === 1 &&
      latinRubyLimit10[0].type === "ruby" &&
      latinRubyLimit8.length === 1 &&
      latinRubyLimit8[0].type === "text" &&
      latinRubyLengths.baseLength === 2 &&
      latinRubyLengths.rubyLength === 9 &&
      latinRubyLengths.accepted === true &&
      limitedNarou.length === 1 &&
      limitedNarou[0].type === "text" &&
      effectiveRuby.source === "url" &&
      effectiveRuby.markers.open === "(" &&
      effectiveRuby.markers.close === ")",
    details: {
      implicitNarou,
      explicitNarou,
      pageMarkers,
      looseNarou,
      unmarkedLatinRuby,
      latinRubyLimit10,
      latinRubyLimit8,
      latinRubyLengths,
      limitedNarou,
      effectiveRuby
    }
  };
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

  const overrideCheck = verifyOverrideRestorationV2(overrideLoaded.stages);
  console.log(overrideCheck.passed
    ? "PASS [override-restore] token-rules / basic_form / conditions / sequence"
    : `FAIL [override-restore] ${JSON.stringify(overrideCheck.details)}`);

  const parserCheck = verifyCandidateParsing();
  console.log(parserCheck.passed
    ? "PASS [parser] bracket shorthand / escape"
    : `FAIL [parser] ${JSON.stringify(parserCheck.details)}`);

  const manifestFallbackCheck = verifyManifestFallbackWithoutStorageOverride();
  console.log(manifestFallbackCheck.passed
    ? "PASS [manifest-fallback] missing storage override uses bundled defaults"
    : `FAIL [manifest-fallback] ${JSON.stringify(manifestFallbackCheck.details)}`);

  const emptyOverrideCheck = verifyEmptyOverrideSuppressesManifestRules();
  console.log(emptyOverrideCheck.passed
    ? "PASS [override-empty] empty stored override suppresses bundled defaults"
    : `FAIL [override-empty] ${JSON.stringify(emptyOverrideCheck.details)}`);

  const missingManifestBundleCheck = verifyStoredRootsSuppressMissingManifestBundles();
  console.log(missingManifestBundleCheck.passed
    ? "PASS [override-authoritative] stored roots suppress missing manifest bundles"
    : `FAIL [override-authoritative] ${JSON.stringify(missingManifestBundleCheck.details)}`);

  const disabledSubtreeCheck = verifyDisabledTokenSubtree();
  console.log(disabledSubtreeCheck.passed
    ? "PASS [override-disabled] disabled token subtree stays out of runtime stage"
    : `FAIL [override-disabled] ${JSON.stringify(disabledSubtreeCheck.details)}`);

  const disabledEntryCheck = verifyDisabledOverrideEntries();
  console.log(disabledEntryCheck.passed
    ? "PASS [override-disabled-entry] disabled dictionary/token entries stay out of runtime stages"
    : `FAIL [override-disabled-entry] ${JSON.stringify(disabledEntryCheck.details)}`);

  const wildcardCheck = verifyWildcardBehavior(tokenizer);
  console.log(wildcardCheck.passed
    ? "PASS [wildcard] matcher / replacement / conditions"
    : `FAIL [wildcard] ${JSON.stringify(wildcardCheck.details)}`);

  const regexReplacementCheck = verifyRegexReplacementBehaviorV2(tokenizer);
  console.log(regexReplacementCheck.passed
    ? "PASS [regex] capture replacement"
    : `FAIL [regex] ${JSON.stringify(regexReplacementCheck.details)}`);

  const tokenBundleRegexCheck = verifyRegexRuleInTokenBundleBehavior(tokenizer);
  console.log(tokenBundleRegexCheck.passed
    ? "PASS [regex-token-bundle] regex rule in token bundle runs on dictionary path"
    : `FAIL [regex-token-bundle] ${JSON.stringify(tokenBundleRegexCheck.details)}`);

  const katakanaLongVowelSettingsCheck = verifyKatakanaLongVowelSettingsBehavior(tokenizer);
  console.log(katakanaLongVowelSettingsCheck.passed
    ? "PASS [katakana-long-vowel] min length / compound"
    : `FAIL [katakana-long-vowel] ${JSON.stringify(katakanaLongVowelSettingsCheck.details)}`);

  const sequenceConditionCheck = verifySequenceConditionBehavior(tokenizer);
  console.log(sequenceConditionCheck.passed
    ? "PASS [sequence-condition] prev/current/next sequence and negative matcher"
    : `FAIL [sequence-condition] ${JSON.stringify(sequenceConditionCheck.details)}`);

  const dictionaryCompiledCheck = verifyDictionaryCompiledBehavior();
  console.log(dictionaryCompiledCheck.passed
    ? `PASS [dictionary-compiled] non-cascade / priority / performance (${dictionaryCompiledCheck.details.elapsedMs}ms)`
    : `FAIL [dictionary-compiled] ${JSON.stringify(dictionaryCompiledCheck.details)}`);
  const compiledPlanCheck = verifyCompiledPlanCompatibility(defaultLoaded.stages, tokenizer);
  console.log(compiledPlanCheck.passed
    ? "PASS [compiled-plan] wrapper and compiled plan stay compatible"
    : `FAIL [compiled-plan] ${JSON.stringify(compiledPlanCheck.details)}`);
  const tokenTriggerCacheCheck = verifyTokenTriggerAndCaches(defaultLoaded.stages, tokenizer);
  console.log(tokenTriggerCacheCheck.passed
    ? "PASS [token-trigger-cache] trigger skip and caches reduce tokenize work"
    : `FAIL [token-trigger-cache] ${JSON.stringify(tokenTriggerCacheCheck.details)}`);

  const rubyTransformCheck = verifyRubyTransformBehavior();
  console.log(rubyTransformCheck.passed
    ? "PASS [ruby-transform] source ruby / explicit bar / chained stages"
    : `FAIL [ruby-transform] ${JSON.stringify(rubyTransformCheck.details)}`);

  const rubySharedCheck = verifyRubySharedBehavior();
  console.log(rubySharedCheck.passed
    ? "PASS [ruby-shared] narou / page markers / url override"
    : `FAIL [ruby-shared] ${JSON.stringify(rubySharedCheck.details)}`);

  const defaultResults = runFixtureSet("default", defaultLoaded.stages, FIXTURES, tokenizer, caseId);
  const overrideResults = runFixtureSet("override", overrideLoaded.stages, OVERRIDE_FIXTURES, tokenizer, caseId);

  printFixtureResults(defaultResults);
  printFixtureResults(overrideResults);

  const allPassed = orderCheck.passed &&
    overrideCheck.passed &&
    parserCheck.passed &&
    manifestFallbackCheck.passed &&
    emptyOverrideCheck.passed &&
    missingManifestBundleCheck.passed &&
    disabledSubtreeCheck.passed &&
    disabledEntryCheck.passed &&
    wildcardCheck.passed &&
    regexReplacementCheck.passed &&
    tokenBundleRegexCheck.passed &&
    katakanaLongVowelSettingsCheck.passed &&
    sequenceConditionCheck.passed &&
    dictionaryCompiledCheck.passed &&
    compiledPlanCheck.passed &&
    tokenTriggerCacheCheck.passed &&
    rubyTransformCheck.passed &&
    rubySharedCheck.passed &&
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

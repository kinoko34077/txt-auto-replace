"use strict";

const path = require("path");
const StructuredDictionary = require(path.join(__dirname, "..", "structured-dictionary.js"));

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const roots = [{
  id: "lexical",
  entries: [
    { id: "entry-ashita", from: "あした", to: "明日", priority: 90, enabled: true, regex: false },
    { id: "entry-asu", from: "あす", to: "明日", priority: 90, enabled: true, regex: false },
    { id: "entry-miru", from: "みる", to: "見る", priority: 80, enabled: true, regex: false },
    { id: "entry-conditional", from: "みる", to: "観る", priority: 80, enabled: true, regex: false, conditions: { current: { pos: "動詞" } } }
  ],
  children: []
}];

const migrated = StructuredDictionary.createFromRoots(roots);
const multiToOne = migrated.relations.find((relation) => relation.execution_binding?.entry_ids?.includes("entry-ashita"));
assert(multiToOne, "legacy rules must create relations");
assert(multiToOne.sources.length === 2, "same runtime rule and target must merge into many-to-one");
assert(multiToOne.execution_binding.entry_ids.length === 2, "merged relation must retain both legacy entry ids");

const roundTrip = StructuredDictionary.compileExecutableDictionary(migrated, []);
assert(roundTrip.rules.filter((rule) => ["あした", "あす"].includes(rule.from) && rule.to === "明日").length === 2, "many-to-one must compile one compatible legacy rule per source");

const words = [
  { id: "w-miru", value: "みる" },
  { id: "w-miru-kanji", value: "見る" },
  { id: "w-miru-watch", value: "観る" },
  { id: "w-hitori", value: "ひとり" },
  { id: "w-hitorijime", value: "ひとりじめ" }
];
const structured = StructuredDictionary.normalizeDictionary({
  format_version: 1,
  words,
  relations: [
    {
      id: "default-candidate",
      sources: ["w-miru"],
      targets: [{ word_id: "w-miru-kanji", default: true }, { word_id: "w-miru-watch" }],
      type: "replacement",
      mode: "default",
      enabled: true,
      priority: 90
    },
    {
      id: "derivation",
      sources: ["w-hitori"],
      targets: [{ word_id: "w-hitorijime" }],
      type: "derivation",
      mode: "manual",
      enabled: true
    },
    {
      id: "unresolved-many-to-many",
      sources: ["w-miru", "w-hitori"],
      targets: [{ word_id: "w-miru-kanji" }, { word_id: "w-hitorijime" }],
      type: "replacement",
      mode: "unresolved",
      enabled: true
    }
  ]
});

const compiled = StructuredDictionary.compileExecutableDictionary(structured, []);
assert(compiled.rules.length === 1 && compiled.rules[0].from === "みる" && compiled.rules[0].to === "見る", "default candidate alone must compile");
assert(!compiled.rules.some((rule) => rule.to === "ひとりじめ"), "derivation must never compile as replacement");
assert(compiled.diagnostics.some((issue) => issue.code === "unresolved-many-to-many"), "unresolved many-to-many must be diagnosed");

const conflicted = StructuredDictionary.compileExecutableDictionary(structured, [{ node_id: "", from: "みる", to: "既存" }]);
assert(conflicted.diagnostics.some((issue) => issue.code === "compile-conflict"), "existing tree rules must win compile conflicts");

const duplicateIds = StructuredDictionary.validateDictionary({
  words: [{ id: "duplicate", value: "甲" }, { id: "duplicate", value: "乙" }],
  relations: [{ id: "duplicate-relation" }, { id: "duplicate-relation" }]
});
assert(duplicateIds.errors.some((issue) => issue.code === "duplicate-word-id"), "duplicate word IDs must be diagnosed");
assert(duplicateIds.errors.some((issue) => issue.code === "duplicate-relation-id"), "duplicate relation IDs must be diagnosed");

const danglingMapping = StructuredDictionary.validateDictionary({
  words: [{ id: "source", value: "入力" }],
  relations: [{
    id: "mapping",
    sources: ["source"],
    targets: [],
    mappings: [{ source_id: "source", target_id: "missing" }],
    type: "related",
    mode: "manual"
  }]
});
assert(danglingMapping.errors.some((issue) => issue.code === "dangling-word" && issue.word_id === "missing"), "mapping word references must be diagnosed");

const synchronized = StructuredDictionary.synchronizeBindingsFromRoots(migrated, [{
  id: "lexical",
  entries: [
    { id: "entry-ashita", from: "あした", to: "明日", priority: 90, enabled: true, regex: false },
    { id: "entry-asu", from: "あす", to: "明日", priority: 90, enabled: true, regex: false },
    { id: "entry-miru", from: "みる", to: "見る", priority: 80, enabled: true, regex: false },
    { id: "entry-conditional", from: "みる", to: "観る", priority: 80, enabled: true, regex: false, conditions: { current: { pos: "動詞" } } }
  ],
  children: []
}]);
assert(synchronized.issues.length === 0, "unchanged bindings must synchronize without warnings");

console.log("PASS [structured-dictionary] migration, compilation, validation, and binding synchronization");

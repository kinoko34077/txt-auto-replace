// Structured dictionary model. This module intentionally does not depend on
// browser storage or the transform engine so future management tools can reuse it.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.StructuredDictionary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT_VERSION = 1;
  const RELATION_TYPES = new Set(["replacement", "candidate", "derivation", "related", "alias"]);
  const EXECUTION_MODES = new Set(["automatic", "default", "conditional", "manual", "unresolved"]);
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const text = (value) => `${value ?? ""}`.trim();

  const stableStringify = (value) => {
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const hash = (value) => {
    let result = 2166136261;
    for (const character of `${value ?? ""}`) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };

  const splitCandidates = (value) => Array.isArray(value)
    ? value.flatMap(splitCandidates)
    : `${value ?? ""}`.split(",").map(text).filter(Boolean);

  const createEmptyDictionary = () => ({
    format_version: FORMAT_VERSION,
    words: [],
    relations: [],
    metadata: {}
  });

  const normalizeWord = (word, fallbackId) => {
    const value = text(typeof word === "string" ? word : word?.value);
    if (!value) {
      return null;
    }
    return {
      id: text(typeof word === "string" ? fallbackId : word?.id) || fallbackId,
      value,
      metadata: word?.metadata && typeof word.metadata === "object" ? clone(word.metadata) : {}
    };
  };

  const normalizeTarget = (target) => {
    if (typeof target === "string") {
      return { word_id: text(target), default: false, conditions: null, metadata: {} };
    }
    return {
      word_id: text(target?.word_id ?? target?.id ?? target?.value),
      default: target?.default === true,
      conditions: target?.conditions && typeof target.conditions === "object" ? clone(target.conditions) : null,
      metadata: target?.metadata && typeof target.metadata === "object" ? clone(target.metadata) : {}
    };
  };

  const normalizeRelation = (relation, fallbackId) => {
    const sources = Array.isArray(relation?.sources) ? relation.sources.map(text).filter(Boolean) : [];
    const targets = Array.isArray(relation?.targets) ? relation.targets.map(normalizeTarget).filter((target) => target.word_id) : [];
    return {
      id: text(relation?.id ?? relation?.relationId) || fallbackId,
      sources: [...new Set(sources)],
      targets,
      mappings: Array.isArray(relation?.mappings)
        ? relation.mappings.map((mapping) => ({
          source_id: text(mapping?.source_id),
          target_id: text(mapping?.target_id),
          conditions: mapping?.conditions && typeof mapping.conditions === "object" ? clone(mapping.conditions) : null
        })).filter((mapping) => mapping.source_id && mapping.target_id)
        : [],
      type: RELATION_TYPES.has(text(relation?.type)) ? text(relation.type) : "replacement",
      mode: EXECUTION_MODES.has(text(relation?.mode)) ? text(relation.mode) : "automatic",
      enabled: relation?.enabled !== false,
      priority: Number.isFinite(Number(relation?.priority)) ? Number(relation.priority) : 0,
      conditions: relation?.conditions && typeof relation.conditions === "object" ? clone(relation.conditions) : null,
      metadata: relation?.metadata && typeof relation.metadata === "object" ? clone(relation.metadata) : {},
      execution_binding: relation?.execution_binding && typeof relation.execution_binding === "object"
        ? clone(relation.execution_binding)
        : null
    };
  };

  const normalizeDictionary = (input) => {
    const source = input && typeof input === "object" ? input : createEmptyDictionary();
    const words = [];
    const wordIds = new Set();
    const wordValues = new Set();
    for (const [index, rawWord] of (Array.isArray(source.words) ? source.words : []).entries()) {
      const word = normalizeWord(rawWord, `word-${index + 1}`);
      if (!word || wordIds.has(word.id) || wordValues.has(word.value)) {
        continue;
      }
      wordIds.add(word.id);
      wordValues.add(word.value);
      words.push(word);
    }
    const relations = [];
    const relationIds = new Set();
    for (const [index, rawRelation] of (Array.isArray(source.relations) ? source.relations : []).entries()) {
      const relation = normalizeRelation(rawRelation, `relation-${index + 1}`);
      if (relationIds.has(relation.id)) {
        continue;
      }
      relationIds.add(relation.id);
      relations.push(relation);
    }
    return {
      format_version: Number(source.format_version) || FORMAT_VERSION,
      words,
      relations,
      metadata: source.metadata && typeof source.metadata === "object" ? clone(source.metadata) : {}
    };
  };

  const createWordRegistry = (dictionary) => {
    const valueToId = new Map(dictionary.words.map((word) => [word.value, word.id]));
    const ensureWord = (value) => {
      const normalized = text(value);
      if (!normalized) {
        return null;
      }
      if (valueToId.has(normalized)) {
        return valueToId.get(normalized);
      }
      const baseId = `word-${hash(normalized)}`;
      let id = baseId;
      let suffix = 2;
      while (dictionary.words.some((word) => word.id === id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      dictionary.words.push({ id, value: normalized, metadata: {} });
      valueToId.set(normalized, id);
      return id;
    };
    return { ensureWord, valueToId };
  };

  const walkNodes = (nodes, visit) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== "object") {
        continue;
      }
      visit(node);
      walkNodes(node.children, visit);
    }
  };

  const ruleFingerprint = (entry) => stableStringify({
    to: text(entry?.to),
    candidates: Array.isArray(entry?.candidates) ? entry.candidates : null,
    priority: Number(entry?.priority) || 0,
    enabled: entry?.enabled !== false,
    regex: entry?.regex === true,
    type: text(entry?.type),
    match_target: entry?.match_target ?? null,
    match_options: entry?.match_options ?? null,
    conditions: entry?.conditions ?? null,
    sequence: entry?.sequence ?? null,
    character_map: entry?.character_map ?? null
  });

  const legacyRuleFromEntry = (entry) => ({
    to: text(entry?.to),
    candidates: Array.isArray(entry?.candidates) ? clone(entry.candidates) : null,
    priority: Number(entry?.priority) || 0,
    enabled: entry?.enabled !== false,
    regex: entry?.regex === true,
    type: text(entry?.type) || "replace-rule",
    match_target: entry?.match_target ?? null,
    match_options: entry?.match_options ? clone(entry.match_options) : null,
    conditions: entry?.conditions ? clone(entry.conditions) : null,
    sequence: entry?.sequence ? clone(entry.sequence) : null,
    character_map: entry?.character_map ? clone(entry.character_map) : null
  });

  const createFromRoots = (roots) => {
    const dictionary = createEmptyDictionary();
    const registry = createWordRegistry(dictionary);
    const grouped = new Map();
    walkNodes(roots, (node) => {
      for (const entry of Array.isArray(node.entries) ? node.entries : []) {
        const sources = entry?.regex === true ? [text(entry.from)] : splitCandidates(entry?.from_options ?? entry?.from);
        const to = text(entry?.to);
        if (!sources.length || !to) {
          continue;
        }
        const key = `${text(node.id)}|${ruleFingerprint(entry)}`;
        const group = grouped.get(key) ?? { node, entries: [], sources: [], rule: legacyRuleFromEntry(entry) };
        group.entries.push(entry);
        group.sources.push(...sources);
        grouped.set(key, group);
      }
    });
    for (const group of grouped.values()) {
      const sourceIds = [...new Set(group.sources)].map(registry.ensureWord).filter(Boolean);
      const candidateValues = group.rule.regex ? [group.rule.to] : (group.rule.candidates?.length ? group.rule.candidates : splitCandidates(group.rule.to));
      const targetIds = candidateValues.map(registry.ensureWord).filter(Boolean);
      const hasUnresolvedCandidates = !group.rule.regex && candidateValues.length > 1;
      const relationId = `relation-${hash(`${group.node.id}|${ruleFingerprint(group.entries[0])}|${sourceIds.join(",")}`)}`;
      dictionary.relations.push({
        id: relationId,
        sources: sourceIds,
        targets: targetIds.map((wordId, index) => ({
          word_id: wordId,
          default: candidateValues.length === 1 || index === 0,
          conditions: null,
          metadata: {}
        })),
        mappings: [],
        // Legacy candidate lists retain their original runtime binding, but are not
        // inferred as an automatic one-to-many graph mapping.
        type: hasUnresolvedCandidates ? "candidate" : "replacement",
        mode: hasUnresolvedCandidates ? "unresolved" : "automatic",
        enabled: group.rule.enabled,
        priority: group.rule.priority,
        conditions: group.rule.conditions,
        metadata: { origin: "legacy-tree" },
        execution_binding: {
          node_id: text(group.node.id),
          entry_ids: group.entries.map((entry) => text(entry.id)).filter(Boolean),
          source_kind: group.rule.sequence ? "token-sequence" : (group.rule.regex ? "regex" : "text"),
          rule: group.rule
        }
      });
    }
    return normalizeDictionary(dictionary);
  };

  const wordMap = (dictionary) => new Map(dictionary.words.map((word) => [word.id, word.value]));

  const validateDictionary = (input) => {
    const rawWords = Array.isArray(input?.words) ? input.words : [];
    const rawRelations = Array.isArray(input?.relations) ? input.relations : [];
    const dictionary = normalizeDictionary(input);
    const errors = [];
    const warnings = [];
    const rawWordIds = new Set();
    const rawRelationIds = new Set();
    for (const word of rawWords) {
      const id = text(typeof word === "string" ? "" : word?.id);
      if (!id) {
        continue;
      }
      if (rawWordIds.has(id)) {
        errors.push({ code: "duplicate-word-id", word_id: id });
      }
      rawWordIds.add(id);
    }
    for (const relation of rawRelations) {
      const id = text(relation?.id ?? relation?.relationId);
      if (!id) {
        continue;
      }
      if (rawRelationIds.has(id)) {
        errors.push({ code: "duplicate-relation-id", relation_id: id });
      }
      rawRelationIds.add(id);
    }
    const words = wordMap(dictionary);
    const automaticSources = new Map();
    for (const relation of dictionary.relations) {
      const path = relation.id;
      if (!relation.sources.length) {
        errors.push({ code: "missing-source", relation_id: relation.id, path });
      }
      if (relation.type === "replacement" && !relation.targets.length) {
        errors.push({ code: "missing-target", relation_id: relation.id, path });
      }
      for (const wordId of [
        ...relation.sources,
        ...relation.targets.map((target) => target.word_id),
        ...relation.mappings.flatMap((mapping) => [mapping.source_id, mapping.target_id])
      ]) {
        if (!words.has(wordId)) {
          errors.push({ code: "dangling-word", relation_id: relation.id, word_id: wordId, path });
        }
      }
      const defaults = relation.targets.filter((target) => target.default);
      if (defaults.length > 1) {
        errors.push({ code: "multiple-defaults", relation_id: relation.id, path });
      }
      if (relation.type === "replacement" && relation.enabled && relation.sources.length && relation.targets.length > 1) {
        if (relation.mode === "automatic") {
          errors.push({ code: "automatic-multiple-targets", relation_id: relation.id, path });
        } else if (relation.mode === "default" && defaults.length !== 1) {
          errors.push({ code: "missing-default", relation_id: relation.id, path });
        } else if (relation.mode === "manual" || relation.mode === "unresolved") {
          warnings.push({ code: "unresolved-candidates", relation_id: relation.id, path });
        }
      }
      if (relation.type === "replacement" && relation.sources.length > 1 && relation.targets.length > 1 && !relation.mappings.length) {
        warnings.push({ code: "unresolved-many-to-many", relation_id: relation.id, path });
      }
      if (relation.enabled && relation.type === "replacement" && relation.mode === "automatic" && relation.targets.length === 1) {
        const target = relation.targets[0].word_id;
        const scope = stableStringify({
          node_id: relation.execution_binding?.node_id ?? null,
          conditions: relation.conditions,
          rule: {
            regex: relation.execution_binding?.rule?.regex ?? null,
            type: relation.execution_binding?.rule?.type ?? null,
            match_target: relation.execution_binding?.rule?.match_target ?? null,
            match_options: relation.execution_binding?.rule?.match_options ?? null,
            sequence: relation.execution_binding?.rule?.sequence ?? null,
            character_map: relation.execution_binding?.rule?.character_map ?? null
          }
        });
        for (const source of relation.sources) {
          const sourceKey = `${scope}|${source}`;
          const existing = automaticSources.get(sourceKey);
          if (existing && existing !== target) {
            errors.push({ code: "automatic-conflict", relation_id: relation.id, source_id: source, path });
          } else {
            automaticSources.set(sourceKey, target);
          }
        }
      }
    }
    return { dictionary, errors, warnings, valid: errors.length === 0 };
  };

  const compileExecutableDictionary = (input, existingEntries = []) => {
    const validation = validateDictionary(input);
    const values = wordMap(validation.dictionary);
    const existingKeys = new Set((Array.isArray(existingEntries) ? existingEntries : []).flatMap((entry) => {
      const sources = entry?.regex === true ? [text(entry.from)] : splitCandidates(entry?.from_options ?? entry?.from);
      return sources.map((source) => `${text(entry?.node_id)}|${source}`);
    }));
    const rules = [];
    const diagnostics = [...validation.errors, ...validation.warnings];
    for (const relation of validation.dictionary.relations) {
      if (!relation.enabled || relation.type !== "replacement" || !["automatic", "default"].includes(relation.mode)) {
        continue;
      }
      const binding = relation.execution_binding;
      const sources = relation.sources.map((wordId) => values.get(wordId)).filter(Boolean);
      let targets = [];
      if (relation.mappings.length) {
        targets = relation.mappings.map((mapping) => ({ source: values.get(mapping.source_id), target: values.get(mapping.target_id) }));
      } else if (relation.targets.length === 1) {
        targets = sources.map((source) => ({ source, target: values.get(relation.targets[0].word_id) }));
      } else if (relation.mode === "default") {
        const target = relation.targets.find((candidate) => candidate.default);
        targets = target ? sources.map((source) => ({ source, target: values.get(target.word_id) })) : [];
      } else {
        continue;
      }
      for (const mapping of targets) {
        if (!mapping.source || !mapping.target) {
          continue;
        }
        const nodeId = text(binding?.node_id);
        const key = `${nodeId}|${mapping.source}`;
        if (existingKeys.has(key)) {
          diagnostics.push({ code: "compile-conflict", relation_id: relation.id, source: mapping.source, node_id: nodeId });
          continue;
        }
        rules.push({
          ...(binding?.rule ? clone(binding.rule) : {}),
          id: `compiled-${relation.id}-${hash(mapping.source)}`,
          from: mapping.source,
          from_options: [mapping.source],
          to: mapping.target,
          enabled: true,
          priority: relation.priority,
          structured_relation_id: relation.id,
          node_id: nodeId
        });
      }
    }
    return { rules, diagnostics, validation };
  };

  const synchronizeBindingsFromRoots = (input, roots) => {
    const dictionary = normalizeDictionary(input);
    const entriesById = new Map();
    walkNodes(roots, (node) => {
      for (const entry of Array.isArray(node.entries) ? node.entries : []) {
        if (text(entry?.id)) {
          entriesById.set(text(entry.id), { node, entry });
        }
      }
    });
    const registry = createWordRegistry(dictionary);
    const issues = [];
    const boundEntryIds = new Set();
    for (const relation of dictionary.relations) {
      const binding = relation.execution_binding;
      if (!binding?.entry_ids?.length || relation.metadata?.origin !== "legacy-tree") {
        continue;
      }
      const matches = binding.entry_ids.map((id) => entriesById.get(id)).filter(Boolean);
      binding.entry_ids.forEach((id) => boundEntryIds.add(id));
      if (matches.length !== binding.entry_ids.length) {
        issues.push({ code: "binding-missing-entry", relation_id: relation.id });
        continue;
      }
      const first = matches[0];
      if (matches.some((match) => match.node.id !== first.node.id || ruleFingerprint(match.entry) !== ruleFingerprint(first.entry))) {
        issues.push({ code: "binding-diverged", relation_id: relation.id });
        continue;
      }
      const sources = [...new Set(matches.flatMap((match) => {
        return match.entry.regex === true ? [text(match.entry.from)] : splitCandidates(match.entry.from_options ?? match.entry.from);
      }))];
      const rule = legacyRuleFromEntry(first.entry);
      const candidates = rule.regex ? [rule.to] : (rule.candidates?.length ? rule.candidates : splitCandidates(rule.to));
      relation.sources = sources.map(registry.ensureWord).filter(Boolean);
      relation.targets = candidates.map((candidate, index) => ({
        word_id: registry.ensureWord(candidate),
        default: candidates.length === 1 || index === 0,
        conditions: null,
        metadata: {}
      })).filter((target) => target.word_id);
      const hasUnresolvedCandidates = !rule.regex && candidates.length > 1;
      relation.type = hasUnresolvedCandidates ? "candidate" : "replacement";
      relation.mode = hasUnresolvedCandidates ? "unresolved" : "automatic";
      relation.enabled = rule.enabled;
      relation.priority = rule.priority;
      relation.conditions = rule.conditions;
      relation.execution_binding = {
        ...binding,
        node_id: text(first.node.id),
        rule
      };
    }
    const generated = createFromRoots(roots);
    for (const relation of generated.relations) {
      const entryIds = relation.execution_binding?.entry_ids ?? [];
      if (entryIds.some((id) => boundEntryIds.has(id)) || dictionary.relations.some((existing) => existing.id === relation.id)) {
        continue;
      }
      dictionary.relations.push(relation);
    }
    return { dictionary: normalizeDictionary(dictionary), issues };
  };

  const findWords = (input, query) => {
    const dictionary = normalizeDictionary(input);
    const needle = text(query).toLowerCase();
    return dictionary.words.filter((word) => !needle || word.value.toLowerCase().includes(needle));
  };

  const getRelationsByWord = (input, wordId) => {
    const dictionary = normalizeDictionary(input);
    return dictionary.relations.filter((relation) => {
      return relation.sources.includes(wordId) || relation.targets.some((target) => target.word_id === wordId);
    });
  };

  const addRelation = (input, relation) => {
    const dictionary = normalizeDictionary(input);
    dictionary.relations.push(normalizeRelation(relation, `relation-${hash(Date.now())}`));
    return normalizeDictionary(dictionary);
  };

  const updateRelation = (input, relationId, patch) => {
    const dictionary = normalizeDictionary(input);
    const index = dictionary.relations.findIndex((relation) => relation.id === relationId);
    if (index < 0) {
      return dictionary;
    }
    dictionary.relations[index] = normalizeRelation({ ...dictionary.relations[index], ...clone(patch), id: relationId }, relationId);
    return dictionary;
  };

  const removeRelation = (input, relationId) => {
    const dictionary = normalizeDictionary(input);
    dictionary.relations = dictionary.relations.filter((relation) => relation.id !== relationId);
    return dictionary;
  };

  return {
    FORMAT_VERSION,
    createEmptyDictionary,
    normalizeDictionary,
    createFromRoots,
    importLegacyTree: createFromRoots,
    validateDictionary,
    compileExecutableDictionary,
    exportExecutableRules: compileExecutableDictionary,
    synchronizeBindingsFromRoots,
    findWords,
    getWord: (input, wordId) => normalizeDictionary(input).words.find((word) => word.id === wordId) ?? null,
    getRelation: (input, relationId) => normalizeDictionary(input).relations.find((relation) => relation.id === relationId) ?? null,
    getRelationsByWord,
    addRelation,
    updateRelation,
    removeRelation,
    setRelationEnabled: (input, relationId, enabled) => updateRelation(input, relationId, { enabled: enabled === true })
  };
});

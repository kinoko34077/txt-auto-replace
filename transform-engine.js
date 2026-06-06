(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.TransformEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const splitCommaSeparatedValues = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => `${entry ?? ""}`.trim())
        .filter(Boolean);
    }

    if (typeof value !== "string") {
      return [];
    }

    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  };

  const splitReplacementCandidates = (value) => splitCommaSeparatedValues(value);
  const splitMatchCandidates = (value) => splitCommaSeparatedValues(value);

  const emitDebugEvent = (debugCollector, event) => {
    if (typeof debugCollector === "function" && event && typeof event === "object") {
      debugCollector({
        ...event,
        timestamp: Date.now()
      });
    }
  };

  const snapshotToken = (token) => {
    if (!token || typeof token !== "object") {
      return null;
    }

    return {
      surface_form: token.surface_form ?? "",
      basic_form: token.basic_form ?? "",
      pos: token.pos ?? "",
      pos_detail_1: token.pos_detail_1 ?? "",
      pos_detail_2: token.pos_detail_2 ?? "",
      pos_detail_3: token.pos_detail_3 ?? "",
      conjugated_type: token.conjugated_type ?? "",
      conjugated_form: token.conjugated_form ?? "",
      reading: token.reading ?? ""
    };
  };

  const MATCHER_VALUE_ALIASES = {
    pos: {
      "名": "名詞",
      "動": "動詞",
      "形": "形容詞",
      "助": "助詞",
      "助動": "助動詞",
      "副": "副詞",
      "連体": "連体詞",
      "接続": "接続詞",
      "記": "記号"
    },
    pos_detail_1: {
      "一般": "一般",
      "自立": "自立",
      "非自立": "非自立",
      "接尾": "接尾",
      "格助": "格助詞",
      "係助": "係助詞",
      "副可": "副詞可能",
      "サ変": "サ変接続"
    },
    conjugated_form: {
      "基本": "基本形",
      "連用": "連用形",
      "連体": "連体形",
      "未然": "未然形",
      "命令": "命令形",
      "仮定": "仮定形"
    },
    conjugated_type: {
      "一段": "一段",
      "五段": "五段・ワ行促音便",
      "サ変": "サ変・スル",
      "カ変": "カ変・クル",
      "形容詞": "形容詞・アウオ段"
    }
  };

  const canonicalizeMatcherToken = (field, token) => {
    const normalized = `${token ?? ""}`.trim();
    if (!normalized) {
      return "";
    }

    const aliases = MATCHER_VALUE_ALIASES[field];
    if (!aliases) {
      return normalized;
    }

    return aliases[normalized] ?? normalized;
  };

  const normalizeConditionValue = (field, value) => {
    if (Array.isArray(value)) {
      const values = value
        .map((entry) => canonicalizeMatcherToken(field, entry))
        .filter(Boolean);
      return values.length > 0 ? values : undefined;
    }

    if (typeof value === "string") {
      const values = splitCommaSeparatedValues(value)
        .map((entry) => canonicalizeMatcherToken(field, entry))
        .filter(Boolean);
      if (values.length === 0) {
        return undefined;
      }

      return values.length === 1 ? values[0] : values;
    }

    return value;
  };

  const normalizeCondition = (condition) => {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      return condition;
    }

    return {
      surface_form: normalizeConditionValue("surface_form", condition.surface_form ?? condition.surface),
      basic_form: normalizeConditionValue("basic_form", condition.basic_form ?? condition.basic),
      pos: normalizeConditionValue("pos", condition.pos),
      pos_detail_1: normalizeConditionValue("pos_detail_1", condition.pos_detail_1 ?? condition.pos1),
      pos_detail_2: normalizeConditionValue("pos_detail_2", condition.pos_detail_2 ?? condition.pos2),
      pos_detail_3: normalizeConditionValue("pos_detail_3", condition.pos_detail_3 ?? condition.pos3),
      conjugated_type: normalizeConditionValue("conjugated_type", condition.conjugated_type ?? condition.ctype),
      conjugated_form: normalizeConditionValue("conjugated_form", condition.conjugated_form ?? condition.cform),
      reading: normalizeConditionValue("reading", condition.reading),
      pronunciation: normalizeConditionValue("pronunciation", condition.pronunciation),
      word_type: normalizeConditionValue("word_type", condition.word_type)
    };
  };

  const normalizeConditionList = (conditionList) => {
    if (!conditionList) {
      return conditionList;
    }

    if (!Array.isArray(conditionList)) {
      return normalizeCondition(conditionList);
    }

    return conditionList.map(normalizeCondition);
  };

  const GODAN_VERB_ENDINGS = {
    "う": { a: "わ", i: "い", e: "え", o: "お", te: "って", ta: "った" },
    "く": { a: "か", i: "き", e: "け", o: "こ", te: "いて", ta: "いた" },
    "ぐ": { a: "が", i: "ぎ", e: "げ", o: "ご", te: "いで", ta: "いだ" },
    "す": { a: "さ", i: "し", e: "せ", o: "そ", te: "して", ta: "した" },
    "つ": { a: "た", i: "ち", e: "て", o: "と", te: "って", ta: "った" },
    "ぬ": { a: "な", i: "に", e: "ね", o: "の", te: "んで", ta: "んだ" },
    "ぶ": { a: "ば", i: "び", e: "べ", o: "ぼ", te: "んで", ta: "んだ" },
    "む": { a: "ま", i: "み", e: "め", o: "も", te: "んで", ta: "んだ" },
    "る": { a: "ら", i: "り", e: "れ", o: "ろ", te: "って", ta: "った" }
  };

  const getFinalCharacter = (value) => {
    const characters = Array.from(`${value ?? ""}`);
    return characters.length > 0 ? characters[characters.length - 1] : "";
  };

  const inferGodanEnding = (from, replacementBase) => {
    const fromEnding = getFinalCharacter(from);
    const replacementEnding = getFinalCharacter(replacementBase);
    if (!fromEnding || fromEnding !== replacementEnding) {
      return null;
    }

    return GODAN_VERB_ENDINGS[fromEnding] ?? null;
  };

  const pushUniqueVariant = (variants, from, to, kind = "plain") => {
    const normalizedFrom = `${from ?? ""}`.trim();
    const normalizedTo = `${to ?? ""}`.trim();
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
      return;
    }

    if (variants.some((variant) => variant.from === normalizedFrom && variant.to === normalizedTo)) {
      return;
    }

    variants.push({ from: normalizedFrom, to: normalizedTo, kind });
  };

  const normalizePhraseRuleRecord = (from, rawRule) => {
    const fromCandidates = splitMatchCandidates(from);

    if (typeof rawRule === "string") {
      const candidates = splitReplacementCandidates(rawRule);
      return {
        from: fromCandidates[0] ?? from,
        from_options: fromCandidates,
        to: candidates[0] ?? "",
        candidates,
        priority: 0,
        enabled: true,
        regex: false
      };
    }

    if (Array.isArray(rawRule)) {
      const candidates = splitReplacementCandidates(rawRule[0]);
      return {
        from: fromCandidates[0] ?? from,
        from_options: fromCandidates,
        to: candidates[0] ?? "",
        candidates,
        priority: Number.isFinite(rawRule[1]) ? rawRule[1] : Number(rawRule[1]) || 0,
        enabled: rawRule[2] !== false,
        regex: rawRule[3] === true
      };
    }

    if (rawRule && typeof rawRule === "object") {
      const candidates = splitReplacementCandidates(rawRule.candidates ?? rawRule.to);
      const ruleFromCandidates = splitMatchCandidates(rawRule.from ?? from ?? "");
      return {
        ...rawRule,
        from: ruleFromCandidates[0] ?? `${rawRule.from ?? from ?? ""}`,
        from_options: ruleFromCandidates,
        to: candidates[0] ?? `${rawRule.to ?? ""}`,
        candidates,
        priority: Number.isFinite(rawRule.priority) ? rawRule.priority : Number(rawRule.priority) || 0,
        enabled: rawRule.enabled !== false,
        regex: rawRule.regex === true || rawRule.is_regex === true
      };
    }

    return null;
  };

  const normalizePhraseRulesInput = (rules) => {
    if (Array.isArray(rules)) {
      return rules
        .map((rule) => {
          if (Array.isArray(rule)) {
            return normalizePhraseRuleRecord(rule[0], [rule[1], rule[2], rule[3]]);
          }

          return normalizePhraseRuleRecord(rule?.from ?? "", rule);
        })
        .filter((rule) => rule && rule.from && rule.to);
    }

    if (rules && typeof rules === "object") {
      return Object.entries(rules)
        .map(([from, rawRule]) => normalizePhraseRuleRecord(from, rawRule))
        .filter((rule) => rule && rule.from && rule.to);
    }

    return [];
  };

  const splitNodeEntries = (entries, fallbackPriority = 10) => {
    const replaceRules = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const sequenceLabel = Array.isArray(entry.sequence)
        ? entry.sequence
            .map((token) => `${token?.surface ?? token?.basic ?? "*"}`.trim())
            .filter(Boolean)
            .join(" ")
        : "";
      const from = `${entry.from ?? sequenceLabel ?? ""}`.trim();
      const to = `${entry.to ?? ""}`.trim();
      if (!from || !to || entry.enabled === false) {
        continue;
      }

      const fromOptions = splitMatchCandidates(entry.from ?? from);

      replaceRules.push({
        id: `${entry.id ?? ""}`.trim() || undefined,
        type: `${entry.type ?? "replace-rule"}`,
        from: fromOptions[0] ?? from,
        from_options: fromOptions,
        to,
        raw: { ...entry },
        candidates: splitReplacementCandidates(entry.candidates ?? to),
        regex: entry.regex === true || entry.is_regex === true,
        priority: Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || fallbackPriority,
        enabled: entry.enabled !== false,
        match_target: entry.match_target ?? entry.matchTarget ?? null,
        conditions: entry.conditions ?? null,
        sequence: entry.sequence ?? null,
        character_map: entry.character_map ?? null
      });
    }

    return replaceRules;
  };

  const normalizeDictionaryNode = (node, fallbackId = "group", fallbackLabel = "Group") => {
    const fallbackPriority = Number.isFinite(node?.character_map_priority)
      ? node.character_map_priority
      : Number(node?.character_map_priority) || 10;
    const directEntries = splitNodeEntries(node?.entries, fallbackPriority);
    const directRules = splitNodeEntries(node?.rules, fallbackPriority);
    const legacyEntries = [
      ...normalizePhraseRulesInput(node?.phrase_rules).map((rule) => ({
        ...rule,
        type: "replace-rule",
        regex: rule.regex === true
      })),
      ...normalizePhraseRulesInput(node?.replace_rules).map((rule) => ({
        ...rule,
        type: "replace-rule",
        regex: rule.regex === true
      })),
      ...(
        node?.character_map &&
        typeof node.character_map === "object" &&
        !Array.isArray(node.character_map)
      ? Object.entries(node.character_map)
        .filter(([from, to]) => Boolean(from) && Boolean(to) && from !== to)
        .map(([from, to]) => ({
          type: "replace-rule",
          from,
          to,
          candidates: [to],
          regex: false,
          priority: fallbackPriority,
          enabled: true
        }))
      : [])
    ];

    const childSource = Array.isArray(node?.children) && node.children.length > 0
      ? node.children
      : Array.isArray(node?.groups) && node.groups.length > 0
        ? node.groups
        : [];

    return {
      id: `${node?.id ?? fallbackId}`.trim() || fallbackId,
      label: `${node?.label ?? fallbackLabel}`.trim() || fallbackLabel,
      enabled: node?.enabled !== false,
      entries: directEntries.length > 0 ? directEntries : (directRules.length > 0 ? directRules : legacyEntries),
      children: childSource.map((child, index) => {
        return normalizeDictionaryNode(child, `${fallbackId}-${index + 1}`, `${fallbackLabel} ${index + 1}`);
      })
    };
  };

  const normalizeRule = (rule) => {
    const conditions = rule.conditions || {};
    const candidates = splitReplacementCandidates(rule.candidates ?? rule.to);
    const fromOptions = splitMatchCandidates(rule.from_options ?? rule.from);

    return {
      ...rule,
      from: fromOptions[0] ?? rule.from,
      from_options: fromOptions,
      to: candidates[0] ?? rule.to,
      candidates,
      match_target: rule.match_target ?? rule.matchTarget ?? null,
      character_map: rule.character_map && typeof rule.character_map === "object"
        ? { ...rule.character_map }
        : null,
      sequence: Array.isArray(rule.sequence)
        ? rule.sequence.map(normalizeCondition)
        : null,
      conditions: {
        current: normalizeConditionList(conditions.current),
        prev: normalizeConditionList(conditions.prev),
        next: normalizeConditionList(conditions.next)
      }
    };
  };

  const TOKEN_MATCH_RULE_TYPES = new Set([
    "verb",
    "adjective",
    "literal",
    "compound",
    "renyou"
  ]);

  const hasRuleConditionBranch = (branch) => {
    if (Array.isArray(branch)) {
      return branch.length > 0;
    }

    if (!branch || typeof branch !== "object") {
      return false;
    }

    return Object.values(branch).some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return value !== undefined && value !== null && `${value}`.trim() !== "";
    });
  };

  const ruleRequiresTokenMatching = (rule) => {
    if (!rule || typeof rule !== "object") {
      return false;
    }

    if (rule.match_target !== undefined && rule.match_target !== null && `${rule.match_target}`.trim() !== "") {
      return true;
    }

    if (Array.isArray(rule.sequence) && rule.sequence.length > 0) {
      return true;
    }

    if (
      hasRuleConditionBranch(rule.conditions?.current) ||
      hasRuleConditionBranch(rule.conditions?.prev) ||
      hasRuleConditionBranch(rule.conditions?.next)
    ) {
      return true;
    }

    const normalizedType = `${rule.type ?? ""}`.trim();
    return TOKEN_MATCH_RULE_TYPES.has(normalizedType);
  };

  const withBundleMetadata = (rule, bundle) => {
    return {
      ...normalizeRule(rule),
      bundle_id: bundle.id,
      bundle_label: bundle.label,
      bundle_order: bundle.order ?? 0
    };
  };

  const withGroupMetadata = (rule, group) => {
    return {
      ...rule,
      group_id: group.id,
      group_label: group.label
    };
  };

  const hashString = (value) => {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  };

  const chooseReplacement = (rule, matchedText) => {
    const candidates = Array.isArray(rule.candidates) && rule.candidates.length > 0
      ? rule.candidates
      : splitReplacementCandidates(rule.to);

    if (!candidates.length) {
      return rule.to;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    const seedSource = [
      globalThis?.location?.href ?? "runtime",
      rule.bundle_id ?? "",
      rule.from ?? matchedText,
      matchedText
    ].join("|");
    const selectedIndex = hashString(seedSource) % candidates.length;
    return candidates[selectedIndex];
  };

  const escapeRegex = (value) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const valueMatches = (actual, expected) => {
    if (expected === undefined || expected === null) {
      return true;
    }

    if (Array.isArray(expected)) {
      return expected.includes(actual);
    }

    return actual === expected;
  };

  const getRuleFromCandidates = (rule) => {
    const candidates = splitMatchCandidates(rule?.from_options ?? rule?.from);
    return candidates.length > 0 ? candidates : [`${rule?.from ?? ""}`.trim()].filter(Boolean);
  };

  const tokenMatchesCondition = (token, condition) => {
    if (!token || !condition) {
      return false;
    }

    if (typeof condition === "string") {
      return (
        token.surface_form === condition ||
        token.basic_form === condition ||
        token.pos === condition ||
        token.pos_detail_1 === condition ||
        token.pos_detail_2 === condition ||
        token.pos_detail_3 === condition ||
        token.conjugated_form === condition ||
        `${token.pos}${token.conjugated_form}` === condition ||
        `${token.pos}${token.pos_detail_1}` === condition
      );
    }

    return (
      valueMatches(token.surface_form, condition.surface_form) &&
      valueMatches(token.basic_form, condition.basic_form) &&
      valueMatches(token.pos, condition.pos) &&
      valueMatches(token.pos_detail_1, condition.pos_detail_1) &&
      valueMatches(token.pos_detail_2, condition.pos_detail_2) &&
      valueMatches(token.pos_detail_3, condition.pos_detail_3) &&
      valueMatches(token.conjugated_type, condition.conjugated_type) &&
      valueMatches(token.conjugated_form, condition.conjugated_form) &&
      valueMatches(token.reading, condition.reading) &&
      valueMatches(token.pronunciation, condition.pronunciation) &&
      valueMatches(token.word_type, condition.word_type)
    );
  };

  const anyConditionMatches = (token, conditionList) => {
    if (!Array.isArray(conditionList)) {
      return tokenMatchesCondition(token, conditionList);
    }

    return conditionList.some((condition) => tokenMatchesCondition(token, condition));
  };

  const listifyConditions = (conditions) => {
    if (!conditions) {
      return [];
    }

    return Array.isArray(conditions) ? conditions : [conditions];
  };

  const conditionValueIncludes = (value, expected) => {
    if (Array.isArray(value)) {
      return value.includes(expected);
    }
    return value === expected;
  };

  const ruleUsesBasicFormMatch = (rule) => {
    if (rule?.match_target === "basic_form" || rule?.type === "verb" || rule?.type === "adjective") {
      return true;
    }

    if (rule?.type === "compound" && inferGodanEnding(rule?.from, rule?.to)) {
      return true;
    }

    return listifyConditions(rule?.conditions?.current).some((condition) => {
      if (!condition || typeof condition !== "object") {
        return false;
      }

      const pos = condition.pos;
      const isVerbPos = Array.isArray(pos)
        ? pos.includes("動詞")
        : pos === "動詞";
      return (
        condition.basic_form !== undefined ||
        isVerbPos ||
        condition.conjugated_form !== undefined ||
        condition.conjugated_type !== undefined
      );
    });
  };

    const ruleRequiresStrictBasicFormMatch = (rule) => {
    if (rule?.match_target === "basic_form" || rule?.type === "verb" || rule?.type === "adjective") {
      return true;
    }

    return listifyConditions(rule?.conditions?.current).some((condition) => {
      if (!condition || typeof condition !== "object") {
        return false;
      }

      return condition.basic_form !== undefined;
    });
  };

  const expectsVerbToken = (rule) => {
    if (rule?.type === "verb") {
      return true;
    }

    return listifyConditions(rule?.conditions?.current).some((condition) => {
      if (!condition || typeof condition !== "object") {
        return false;
      }

      const pos = condition.pos;
      return Array.isArray(pos)
        ? pos.includes("動詞")
        : pos === "動詞";
    });
  };

  const expectsAdjectiveToken = (rule) => {
    if (rule?.type === "adjective") {
      return true;
    }

    return listifyConditions(rule?.conditions?.current).some((condition) => {
      if (!condition || typeof condition !== "object") {
        return false;
      }

      const pos = condition.pos;
      return Array.isArray(pos)
        ? pos.includes("形容詞")
        : pos === "形容詞";
    });
  };

    const tokenSatisfiesMatcher = (token, matcher) => {
    return tokenMatchesCondition(token, matcher);
  };

  const transformSurfaceWithCharacterMap = (surface, characterMap) => {
    if (!surface || !characterMap) {
      return surface;
    }

    let changed = false;
    const transformed = Array.from(surface, (character) => {
      const mappedCharacter = characterMap[character];
      if (mappedCharacter && mappedCharacter !== character) {
        changed = true;
        return mappedCharacter;
      }

      return character;
    }).join("");

    return changed ? transformed : surface;
  };

  const sequenceMatches = (tokens, index, rule) => {
    if (!Array.isArray(rule.sequence) || rule.sequence.length === 0) {
      return null;
    }

    for (let offset = 0; offset < rule.sequence.length; offset++) {
      const token = tokens[index + offset];
      const matcher = rule.sequence[offset];

      if (!token || !tokenSatisfiesMatcher(token, matcher)) {
        return null;
      }
    }

    return {
      start: index,
      length: rule.sequence.length
    };
  };

  const singleTokenMatches = (tokens, index, rule) => {
    const token = tokens[index];
    if (!token) {
      return false;
    }

    const fromCandidates = getRuleFromCandidates(rule);
    if (expectsVerbToken(rule) && token.pos !== "動詞") {
      return false;
    }
    if (expectsAdjectiveToken(rule) && token.pos !== "形容詞") {
      return false;
    }

    if (ruleRequiresStrictBasicFormMatch(rule)) {
      return fromCandidates.includes(token.basic_form);
    }

    if (fromCandidates.includes(token.surface_form)) {
      return true;
    }

    if (ruleUsesBasicFormMatch(rule) && fromCandidates.includes(token.basic_form)) {
      return true;
    }

    return false;
  };

    const getSharedSuffix = (left, right) => {
    const leftChars = Array.from(left ?? "");
    const rightChars = Array.from(right ?? "");
    let index = 0;

    while (
      index < leftChars.length &&
      index < rightChars.length &&
      leftChars[leftChars.length - 1 - index] === rightChars[rightChars.length - 1 - index]
    ) {
      index++;
    }

    return index > 0 ? leftChars.slice(leftChars.length - index).join("") : "";
  };

  const isAdjectiveRule = (rule) => {
    if (rule?.type === "adjective") {
      return true;
    }

    return listifyConditions(rule?.conditions?.current).some((condition) => {
      if (!condition || typeof condition !== "object") {
        return false;
      }
      const pos = condition.pos;
      return Array.isArray(pos)
        ? pos.includes("形容詞")
        : pos === "形容詞";
    });
  };

    const buildAdjectiveSurfaceFallbackVariants = (rule, replacementBase) => {
    const fromCandidates = getRuleFromCandidates(rule);
    const variants = [];

    for (const fromCandidate of fromCandidates) {
      if (!fromCandidate || !replacementBase || !fromCandidate.endsWith("い") || !replacementBase.endsWith("い")) {
        continue;
      }

      const fromStem = fromCandidate.slice(0, -1);
      const toStem = replacementBase.slice(0, -1);
      if (!fromStem || !toStem) {
        continue;
      }

      pushUniqueVariant(variants, fromCandidate, replacementBase, "base");
      pushUniqueVariant(variants, `${fromStem}く`, `${toStem}く`, "ku");
      pushUniqueVariant(variants, `${fromStem}かっ`, `${toStem}かっ`, "katta");
      pushUniqueVariant(variants, `${fromStem}けれ`, `${toStem}けれ`, "kere");
      pushUniqueVariant(variants, `${fromStem}かれ`, `${toStem}かれ`, "kare");
      pushUniqueVariant(variants, `${fromStem}さ`, `${toStem}さ`, "sa");
    }

    return variants.sort((left, right) => {
      return right.from.length - left.from.length;
    });
  };

  const isEligibleForAdjectiveSurfaceFallback = (rule, replacementBase) => {
    if (!rule || rule.enabled === false || rule.regex === true) {
      return false;
    }

    if (!isAdjectiveRule(rule) || !ruleUsesBasicFormMatch(rule)) {
      return false;
    }

    if (!rule.from || !replacementBase || rule.from === replacementBase) {
      return false;
    }

    if (Array.isArray(rule.sequence) && rule.sequence.length > 0) {
      return false;
    }

    if (rule.conditions?.prev || rule.conditions?.next) {
      return false;
    }

    return buildAdjectiveSurfaceFallbackVariants(rule, replacementBase).length > 0;
  };

    const applyBasicFormReplacement = (token, rule, replacementBase, matchedFrom = rule.from) => {
    if (!token || !ruleUsesBasicFormMatch(rule) || !matchedFrom || !replacementBase) {
      return replacementBase;
    }

    if (token.basic_form !== matchedFrom) {
      return replacementBase;
    }

    if (isAdjectiveRule(rule)) {
      const adjectiveVariants = buildAdjectiveSurfaceFallbackVariants(
        { ...rule, from: matchedFrom, from_options: [matchedFrom] },
        replacementBase
      );
      const matchedVariant = adjectiveVariants.find((variant) => variant.from === token.surface_form);
      return matchedVariant ? matchedVariant.to : token.surface_form;
    }

    const sharedSuffix = getSharedSuffix(matchedFrom, replacementBase);
    if (!sharedSuffix) {
      return replacementBase;
    }

    const fromStem = matchedFrom.slice(0, matchedFrom.length - sharedSuffix.length);
    const toStem = replacementBase.slice(0, replacementBase.length - sharedSuffix.length);
    if (!fromStem) {
      return replacementBase;
    }

    if (!token.surface_form.startsWith(fromStem)) {
      return replacementBase;
    }

    return `${toStem}${token.surface_form.slice(fromStem.length)}`;
  };

  const resolveTokenReplacement = (token, rule, matchedText) => {
    const replacement = chooseReplacement(rule, matchedText);
    const matchedFrom = ruleUsesBasicFormMatch(rule)
      ? token?.basic_form
      : token?.surface_form;
    return applyBasicFormReplacement(token, rule, replacement, matchedFrom);
  };

  const surroundingConditionsMatch = (tokens, index, length, rule) => {
    const currentTokens = tokens.slice(index, index + length);
    const currentToken = currentTokens[0];
    const prevToken = tokens[index - 1];
    const nextToken = tokens[index + length];
    const conditions = rule.conditions || {};
    const { current, prev, next } = conditions;

    if (current && !anyConditionMatches(currentToken, current)) {
      return false;
    }

    if (prev && !anyConditionMatches(prevToken, prev)) {
      return false;
    }

    if (next && !anyConditionMatches(nextToken, next)) {
      return false;
    }

    return true;
  };

  const ruleMatches = (tokens, index, rule) => {
    if (rule.character_map) {
      const token = tokens[index];
      if (!token) {
        return null;
      }

      const transformedSurface = transformSurfaceWithCharacterMap(token.surface_form, rule.character_map);
      if (transformedSurface === token.surface_form) {
        return null;
      }

      if (!surroundingConditionsMatch(tokens, index, 1, rule)) {
        return null;
      }

      return {
        start: index,
        length: 1,
        replacement: transformedSurface
      };
    }

    const sequenceMatch = sequenceMatches(tokens, index, rule);
    if (sequenceMatch) {
      if (!surroundingConditionsMatch(tokens, sequenceMatch.start, sequenceMatch.length, rule)) {
        return null;
      }

      return sequenceMatch;
    }

    if (!singleTokenMatches(tokens, index, rule)) {
      return null;
    }

    if (!surroundingConditionsMatch(tokens, index, 1, rule)) {
      return null;
    }

    return {
      start: index,
      length: 1
    };
  };

  const applyDictionaryRules = (text, dictionaryRules, debugCollector, stageId) => {
    let result = text;

    for (const rule of dictionaryRules) {
      if (!rule || rule.enabled === false) {
        continue;
      }

      if (ruleRequiresTokenMatching(rule)) {
        continue;
      }

      if (rule.regex === true) {
        try {
          const regex = new RegExp(rule.from, "gu");
          result = result.replace(regex, (matchedText) => {
            const replacement = chooseReplacement(rule, matchedText);
            emitDebugEvent(debugCollector, {
              phase: "dictionary-match",
              stageId,
              ruleId: rule.id ?? null,
              matchedText,
              replacement,
              regex: true,
              from: rule.from
            });
            return replacement;
          });
        } catch (error) {
          continue;
        }
        continue;
      }

      if (!rule.from) {
        continue;
      }

      const fromCandidates = getRuleFromCandidates(rule);
      for (const fromCandidate of fromCandidates) {
        if (!fromCandidate) {
          continue;
        }

        const replacement = chooseReplacement(
          { ...rule, from: fromCandidate, from_options: [fromCandidate] },
          fromCandidate
        );
        result = result.replace(new RegExp(escapeRegex(fromCandidate), "gu"), (matchedText) => {
          emitDebugEvent(debugCollector, {
            phase: "dictionary-match",
            stageId,
            ruleId: rule.id ?? null,
            matchedText,
            replacement,
            regex: false,
            from: fromCandidate
          });
          return replacement;
        });
      }
    }

    return result;
  };

  const applyTransformationsToTokens = (tokens, rules, debugCollector, stageId) => {
    const outputTokens = tokens.map((token) => ({ ...token }));

    for (let index = 0; index < outputTokens.length; index++) {
      for (const rule of rules) {
        const match = ruleMatches(outputTokens, index, rule);
        if (!match) {
          continue;
        }

        const matchedTokens = outputTokens
          .slice(match.start, match.start + match.length)
          .map((matchedToken) => matchedToken.surface_form);

        const matchedText = matchedTokens.join("");
        const replacement = match.replacement ?? resolveTokenReplacement(outputTokens[match.start], rule, matchedText);
        emitDebugEvent(debugCollector, {
          phase: "token-match",
          stageId,
          ruleId: rule.id ?? null,
          matchedText,
          replacement,
          matchType: match.length > 1 ? "sequence" : "single",
          tokens: outputTokens
            .slice(match.start, match.start + match.length)
            .map(snapshotToken)
        });
        outputTokens[match.start].surface_form = replacement;

        for (let offset = 1; offset < match.length; offset++) {
          outputTokens[match.start + offset].surface_form = "";
        }

        index = match.start + match.length - 1;
        break;
      }
    }

    return outputTokens;
  };

  const joinTokenSurfaces = (tokens) => {
    return (Array.isArray(tokens) ? tokens : []).map((token) => token.surface_form).join("");
  };

  const applyTransformations = (tokens, rules, debugCollector, stageId) => {
    return joinTokenSurfaces(applyTransformationsToTokens(tokens, rules, debugCollector, stageId));
  };

  const isEligibleForVerbSurfaceFallback = (rule, replacementBase) => {
    if (!rule || rule.enabled === false || rule.regex === true) {
      return false;
    }

    if (!rule.from || !replacementBase || rule.from === replacementBase) {
      return false;
    }

    if (Array.isArray(rule.sequence) && rule.sequence.length > 0) {
      return false;
    }

    if (rule.conditions?.prev || rule.conditions?.next) {
      return false;
    }

    if (!ruleUsesBasicFormMatch(rule)) {
      return false;
    }

    return Boolean(inferGodanEnding(rule.from, replacementBase));
  };

  const buildVerbSurfaceFallbackVariants = (rule, replacementBase) => {
    if (!isEligibleForVerbSurfaceFallback(rule, replacementBase)) {
      return [];
    }

    const endingInfo = inferGodanEnding(rule.from, replacementBase);
    if (!endingInfo) {
      return [];
    }

    const fromStem = rule.from.slice(0, -1);
    const toStem = replacementBase.slice(0, -1);
    if (!fromStem || !toStem) {
      return [];
    }

    const variants = [];
    pushUniqueVariant(variants, rule.from, replacementBase, "base");
    pushUniqueVariant(variants, `${fromStem}${endingInfo.a}`, `${toStem}${endingInfo.a}`, "a");
    pushUniqueVariant(variants, `${fromStem}${endingInfo.i}`, `${toStem}${endingInfo.i}`, "i");
    pushUniqueVariant(variants, `${fromStem}${endingInfo.e}`, `${toStem}${endingInfo.e}`, "e");
    pushUniqueVariant(variants, `${fromStem}${endingInfo.o}`, `${toStem}${endingInfo.o}`, "o");
    pushUniqueVariant(variants, `${fromStem}${endingInfo.te}`, `${toStem}${endingInfo.te}`, "te");
    pushUniqueVariant(variants, `${fromStem}${endingInfo.ta}`, `${toStem}${endingInfo.ta}`, "ta");

    return variants.sort((left, right) => {
      return right.from.length - left.from.length;
    });
  };

  const applyVerbSurfaceFallbackToTokens = (tokens, tokenRules, debugCollector, stageId) => {
    const outputTokens = tokens.map((token) => ({ ...token }));

    for (const rule of tokenRules) {
      const replacementBase = chooseReplacement(rule, rule.from);
      const variants = buildVerbSurfaceFallbackVariants(rule, replacementBase);
      if (variants.length === 0) {
        continue;
      }

      for (let index = 0; index < outputTokens.length; index += 1) {
        const token = outputTokens[index];
        if (!token?.surface_form) {
          continue;
        }

        for (const variant of variants) {
          if (!variant?.from || token.surface_form === variant.to) {
            continue;
          }

          const isExactNounFallback =
            token.surface_form === variant.from &&
            token.pos === "名詞";
          const isMergedTokenFallback =
            token.surface_form.includes(variant.from) &&
            typeof token.basic_form === "string" &&
            token.basic_form.includes(rule.from);

          if (!isExactNounFallback && !isMergedTokenFallback) {
            continue;
          }

          const replacement = token.surface_form.replace(variant.from, variant.to);
          if (replacement === token.surface_form) {
            continue;
          }

          emitDebugEvent(debugCollector, {
            phase: "verb-fallback",
            stageId,
            ruleId: rule.id ?? null,
            matchedText: token.surface_form,
            replacement,
            variantKind: variant.kind,
            tokens: [snapshotToken(token)]
          });
          token.surface_form = replacement;
          break;
        }
      }
    }

    return outputTokens;
  };

  const applyVerbFallbackTransformations = (text, tokenRules, debugCollector, stageId) => {
    let result = text;
    const safeAFollowPattern = "(?=(?:ない|なか|なけ|なく|ず|ぬ|せ|さ|れ|まい|れる|せる|せず|せぬ))";

    for (const rule of tokenRules) {
      const replacementBase = chooseReplacement(rule, rule.from);
      const variants = buildVerbSurfaceFallbackVariants(rule, replacementBase);
      for (const variant of variants) {
        if (variant.kind === "a") {
          result = result.replace(
            new RegExp(`${escapeRegex(variant.from)}${safeAFollowPattern}`, "gu"),
            (matchedText) => {
              emitDebugEvent(debugCollector, {
                phase: "verb-fallback",
                stageId,
                ruleId: rule.id ?? null,
                matchedText,
                replacement: variant.to,
                variantKind: variant.kind
              });
              return variant.to;
            }
          );
          continue;
        }

        result = result.replace(new RegExp(escapeRegex(variant.from), "gu"), (matchedText) => {
          emitDebugEvent(debugCollector, {
            phase: "verb-fallback",
            stageId,
            ruleId: rule.id ?? null,
            matchedText,
            replacement: variant.to,
            variantKind: variant.kind
          });
          return variant.to;
        });
      }
    }

    return result;
  };

  const applyAdjectiveFallbackTransformations = (text, tokenRules, debugCollector, stageId) => {
    let result = text;

    for (const rule of tokenRules) {
      const replacementBase = chooseReplacement(rule, rule.from);
      if (!isEligibleForAdjectiveSurfaceFallback(rule, replacementBase)) {
        continue;
      }

      const variants = buildAdjectiveSurfaceFallbackVariants(rule, replacementBase);
      const hasCurrentConditions = Boolean(rule.conditions?.current);
      for (const variant of variants) {
        if (hasCurrentConditions && variant.kind !== "sa") {
          continue;
        }
        result = result.replace(new RegExp(escapeRegex(variant.from), "gu"), (matchedText) => {
          emitDebugEvent(debugCollector, {
            phase: "adjective-fallback",
            stageId,
            ruleId: rule.id ?? null,
            matchedText,
            replacement: variant.to,
            variantKind: variant.kind
          });
          return variant.to;
        });
      }
    }

    return result;
  };

  const applyAdjectiveSurfaceFallbackToTokens = (tokens, tokenRules, debugCollector, stageId) => {
    const outputTokens = tokens.map((token) => ({ ...token }));

    for (const rule of tokenRules) {
      const replacementBase = chooseReplacement(rule, rule.from);
      if (!isEligibleForAdjectiveSurfaceFallback(rule, replacementBase)) {
        continue;
      }

      const variants = buildAdjectiveSurfaceFallbackVariants(rule, replacementBase);
      const hasCurrentConditions = Boolean(rule.conditions?.current);
      for (const variant of variants) {
        if (hasCurrentConditions && variant.kind !== "sa") {
          continue;
        }

        for (let index = 0; index < outputTokens.length - 1; index += 1) {
          const currentToken = outputTokens[index];
          const nextToken = outputTokens[index + 1];
          if (!currentToken?.surface_form || !nextToken?.surface_form) {
            continue;
          }

          const combinedSurface = `${currentToken.surface_form}${nextToken.surface_form}`;
          if (combinedSurface !== variant.from) {
            continue;
          }

          const canApply =
            currentToken.pos === "形容詞" ||
            currentToken.basic_form === rule.from ||
            combinedSurface === variant.from;
          if (!canApply) {
            continue;
          }

          emitDebugEvent(debugCollector, {
            phase: "adjective-fallback",
            stageId,
            ruleId: rule.id ?? null,
            matchedText: combinedSurface,
            replacement: variant.to,
            variantKind: variant.kind,
            tokens: [snapshotToken(currentToken), snapshotToken(nextToken)]
          });
          currentToken.surface_form = variant.to;
          nextToken.surface_form = "";
          index += 1;
          break;
        }
      }
    }

    return outputTokens;
  };

    const tokenizeAndApplyTokenRules = (text, tokenRules, tokenizer, debugCollector, stageId) => {
    if (!text || !text.trim()) {
      return text;
    }

    if (!Array.isArray(tokenRules) || tokenRules.length === 0) {
      return text;
    }

    if (!tokenizer) {
      return text;
    }

    const tokens = tokenizer.tokenize(text);
    emitDebugEvent(debugCollector, {
      phase: "tokenize",
      stageId,
      text,
      tokens: tokens.map(snapshotToken)
    });
    const transformedTokens = applyTransformationsToTokens(tokens, tokenRules, debugCollector, stageId);
    const adjectiveFallbackTokens = applyAdjectiveSurfaceFallbackToTokens(
      transformedTokens,
      tokenRules,
      debugCollector,
      stageId
    );
    return joinTokenSurfaces(
      applyVerbSurfaceFallbackToTokens(
        adjectiveFallbackTokens,
        tokenRules,
        debugCollector,
        stageId
      )
    );
  };

  const transformTextWithStages = (text, stages, tokenizer, options = {}) => {
    if (!text || !text.trim()) {
      return text;
    }

    const debugCollector = typeof options === "function"
      ? options
      : options?.debugCollector;
    let transformedText = text;

    for (const stage of Array.isArray(stages) ? stages : []) {
      if (!stage || !Array.isArray(stage.rules) || stage.rules.length === 0) {
        continue;
      }

      const beforeStage = transformedText;

      if (stage.kind === "dictionary-rules") {
        transformedText = applyDictionaryRules(transformedText, stage.rules, debugCollector, stage.id);
        if (beforeStage !== transformedText) {
          emitDebugEvent(debugCollector, {
            phase: "stage-result",
            stageId: stage.id,
            stageKind: stage.kind,
            before: beforeStage,
            after: transformedText
          });
        }
        continue;
      }

      if (stage.kind === "token-rules") {
        transformedText = tokenizeAndApplyTokenRules(transformedText, stage.rules, tokenizer, debugCollector, stage.id);
        if (beforeStage !== transformedText) {
          emitDebugEvent(debugCollector, {
            phase: "stage-result",
            stageId: stage.id,
            stageKind: stage.kind,
            before: beforeStage,
            after: transformedText
          });
        }
      }
    }

    return transformedText;
  };

  const normalizeBundle = (bundle) => {
    return {
      id: bundle.id,
      label: bundle.label ?? bundle.id,
      kind: bundle.kind ?? null,
      path: bundle.path ?? null,
      order: bundle.order ?? 0,
      enabled: bundle.enabled !== false
    };
  };

  const buildVirtualBundleDefinition = (bundle) => {
    return {
      id: bundle.id,
      label: bundle.label,
      kind: bundle.kind ?? "dictionary-rules",
      enabled: bundle.enabled !== false,
      entries: Array.isArray(bundle.entries) ? bundle.entries : [],
      children: Array.isArray(bundle.children) ? bundle.children : []
    };
  };

  const resolveBundleKind = (bundle, definition) => {
    return definition?.kind ?? bundle?.kind ?? "dictionary-rules";
  };

  const sourceHasTokenFeatures = (source) => {
    if (Array.isArray(source?.rules)) {
      return true;
    }

    if (Array.isArray(source?.entries) && source.entries.some((entry) => {
      return ruleRequiresTokenMatching(entry);
    })) {
      return true;
    }

    if (Array.isArray(source?.children) && source.children.some((child) => sourceHasTokenFeatures(child))) {
      return true;
    }

    return false;
  };

  const inferStoredBundleKind = (source) => {
    if (typeof source?.kind === "string" && source.kind.trim()) {
      return source.kind;
    }

    if (sourceHasTokenFeatures(source)) {
      return "token-rules";
    }

    return "dictionary-rules";
  };

  const normalizeStoredBundleOverride = (override) => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return null;
    }

    const inferredKind = inferStoredBundleKind(override);
    const normalizedRoot = normalizeDictionaryNode({
      ...override,
      id: override.id ?? "bundle",
      label: override.label ?? override.id ?? "Bundle"
    }, "bundle", "Bundle");
    normalizedRoot.entries = normalizedRoot.entries.filter((rule) => {
      return Boolean(rule.from) && Boolean(rule.to) && rule.from !== rule.to;
    });

    return {
      id: normalizedRoot.id,
      label: normalizedRoot.label,
      kind: inferredKind,
      order: Number.isFinite(override.order) ? override.order : Number(override.order) || null,
      enabled: typeof override.enabled === "boolean" ? override.enabled : null,
      entries: normalizedRoot.entries,
      children: normalizedRoot.children
    };
  };

  const normalizeBundleOverridesPayload = (storedValue) => {
    const storedRoots = Array.isArray(storedValue?.roots) ? storedValue.roots : null;
    if (storedRoots) {
      return Object.fromEntries(
        storedRoots
          .filter((root) => root?.id)
          .map((root) => [root.id, normalizeStoredBundleOverride(root)])
          .filter(([, override]) => override)
      );
    }

    const storedBundles = storedValue?.bundles;
    if (!storedBundles || typeof storedBundles !== "object" || Array.isArray(storedBundles)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(storedBundles)
        .filter(([bundleId]) => bundleId)
        .map(([bundleId, override]) => [bundleId, normalizeStoredBundleOverride(override)])
        .filter(([, override]) => override)
    );
  };

  const applyBundleOverrideToManifest = (bundle, override) => {
    if (!override) {
      return bundle;
    }

    return {
      ...bundle,
      label: override.label ?? bundle.label,
      kind: override.kind ?? bundle.kind,
      order: override.order ?? bundle.order,
      enabled: override.enabled ?? bundle.enabled
    };
  };

  const mergeBundleDefinition = (definition, override) => {
    if (!override) {
      return definition;
    }

    const flattenNodesToRules = (node) => {
      const rules = [];
      if (Array.isArray(node.entries)) {
        for (const entry of node.entries) {
          if (!entry || !entry.from || !entry.to) {
            continue;
          }
          const baseRule = entry.raw && typeof entry.raw === "object"
            ? { ...entry.raw }
            : {};
          rules.push({
            ...baseRule,
            id: entry.id ?? baseRule.id,
            from: entry.from,
            from_options: Array.isArray(entry.from_options) ? [...entry.from_options] : splitMatchCandidates(entry.from),
            to: entry.to,
            priority: entry.priority,
            enabled: entry.enabled !== false,
            regex: entry.regex === true,
            match_target: entry.match_target ?? baseRule.match_target ?? null,
            conditions: entry.conditions ?? baseRule.conditions ?? null,
            sequence: entry.sequence ?? baseRule.sequence ?? null,
            type: entry.type ?? baseRule.type
          });
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          rules.push(...flattenNodesToRules(child));
        }
      }
      return rules;
    };

    const targetKind = override.kind ?? definition.kind;
    if (targetKind === "token-rules") {
      const hasOverrideTree = Array.isArray(override.entries) || Array.isArray(override.children);
      return {
        ...definition,
        kind: "token-rules",
        label: override.label ?? definition.label,
        enabled: override.enabled ?? definition.enabled,
        rules: hasOverrideTree
          ? flattenNodesToRules(override)
          : (Array.isArray(definition.rules) ? definition.rules : [])
      };
    }

    return {
      ...definition,
      kind: "dictionary-rules",
      label: override.label ?? definition.label,
      enabled: override.enabled ?? definition.enabled,
      entries: Array.isArray(override.entries) ? override.entries : (definition.entries ?? []),
      children: Array.isArray(override.children) ? override.children : (definition.children ?? [])
    };
  };

  const extractBundleRules = (bundle, definition) => {
    if (!definition) {
      throw new Error(`空のバンドル定義です: ${bundle.id}`);
    }

    if (definition.kind === "token-rules") {
      const rules = Array.isArray(definition.rules) ? definition.rules : [];

      return rules
        .filter((rule) => rule && rule.enabled !== false)
        .map((rule) => withBundleMetadata(rule, bundle))
        .sort((left, right) => {
          return (right.priority || 0) - (left.priority || 0);
        });
    }

    if (definition.kind === "dictionary-rules") {
      const rules = [];
      const rootNode = normalizeDictionaryNode({
        id: definition.id ?? bundle.id,
        label: definition.label ?? bundle.label,
        enabled: definition.enabled !== false,
        entries: definition.entries,
        children: definition.children,
        groups: definition.groups,
        phrase_rules: definition.phrase_rules,
        replace_rules: definition.replace_rules,
        character_map_priority: definition.character_map_priority,
        character_map: definition.character_map
      }, bundle.id, bundle.label ?? bundle.id);

      const collectNodeRules = (node) => {
        if (node.enabled === false) {
          return;
        }

        const nodeRules = node.entries
          .filter((rule) => rule && rule.enabled !== false)
          .map((rule) => withGroupMetadata(withBundleMetadata(rule, bundle), node));
        rules.push(...nodeRules);

        for (const child of node.children) {
          collectNodeRules(child);
        }
      };

      collectNodeRules(rootNode);

      return rules.sort((left, right) => {
        return (right.priority || 0) - (left.priority || 0);
      });
    }

    throw new Error(`未対応のバンドル種別です: ${bundle.id}`);
  };

  const loadStagesFromDefinitions = (bundleManifest, bundleFiles, overrides = {}) => {
    const manifestBundles = (bundleManifest?.bundles || []).map(normalizeBundle);
    const manifestBundleIds = new Set(manifestBundles.map((bundle) => bundle.id));
    const virtualBundles = Object.values(overrides)
      .filter((override) => override?.id && !manifestBundleIds.has(override.id))
      .map((override) => normalizeBundle({
        id: override.id,
        label: override.label ?? override.id,
        kind: override.kind ?? "dictionary-rules",
        path: null,
        order: override.order ?? 0,
        enabled: override.enabled !== false
      }));
    const bundles = [...manifestBundles, ...virtualBundles]
      .map((bundle) => applyBundleOverrideToManifest(bundle, overrides[bundle.id]))
      .filter((bundle) => bundle.enabled)
      .sort((left, right) => {
        return (left.order ?? 0) - (right.order ?? 0);
      });

    const stages = [];
    let stringRuleCount = 0;
    let tokenRuleCount = 0;

    for (const bundle of bundles) {
      const baseDefinition = bundle.path
        ? bundleFiles?.[bundle.id]
        : buildVirtualBundleDefinition(overrides[bundle.id]);
      if (!baseDefinition) {
        throw new Error(`バンドル定義が見つかりません: ${bundle.id}`);
      }

      const mergedDefinition = mergeBundleDefinition(baseDefinition, overrides[bundle.id]);
      const definition = {
        ...mergedDefinition,
        kind: resolveBundleKind(bundle, mergedDefinition)
      };
      const bundleRules = extractBundleRules(bundle, definition);
      const dictionaryRules = definition.kind === "dictionary-rules"
        ? bundleRules.filter((rule) => !ruleRequiresTokenMatching(rule))
        : [];
      const tokenRules = definition.kind === "token-rules"
        ? bundleRules
        : bundleRules.filter((rule) => ruleRequiresTokenMatching(rule));

      if (dictionaryRules.length > 0) {
        stages.push({
          id: bundle.id,
          label: bundle.label,
          kind: "dictionary-rules",
          order: bundle.order ?? 0,
          rules: dictionaryRules
        });
        stringRuleCount += dictionaryRules.length;
      }

      if (tokenRules.length > 0) {
        stages.push({
          id: bundle.id,
          label: bundle.label,
          kind: "token-rules",
          order: bundle.order ?? 0,
          rules: tokenRules
        });
        tokenRuleCount += tokenRules.length;
      }
    }

    return {
      bundles,
      stages,
      stringRuleCount,
      tokenRuleCount
    };
  };

  return {
    applyDictionaryRules,
    applyAdjectiveFallbackTransformations,
    applyVerbFallbackTransformations,
    loadStagesFromDefinitions,
    normalizeBundleOverridesPayload,
    splitCommaSeparatedValues,
    splitMatchCandidates,
    splitReplacementCandidates,
    tokenizeAndApplyTokenRules,
    transformTextWithStages
  };
});

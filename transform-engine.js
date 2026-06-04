(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.TransformEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const splitReplacementCandidates = (value) => {
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

  const normalizeCondition = (condition) => {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      return condition;
    }

    return {
      surface_form: condition.surface_form ?? condition.surface,
      basic_form: condition.basic_form ?? condition.basic,
      pos: condition.pos,
      pos_detail_1: condition.pos_detail_1 ?? condition.pos1,
      pos_detail_2: condition.pos_detail_2 ?? condition.pos2,
      pos_detail_3: condition.pos_detail_3 ?? condition.pos3,
      conjugated_type: condition.conjugated_type ?? condition.ctype,
      conjugated_form: condition.conjugated_form ?? condition.cform,
      reading: condition.reading,
      pronunciation: condition.pronunciation,
      word_type: condition.word_type
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

  const pushUniqueVariant = (variants, from, to) => {
    const normalizedFrom = `${from ?? ""}`.trim();
    const normalizedTo = `${to ?? ""}`.trim();
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
      return;
    }

    if (variants.some((variant) => variant.from === normalizedFrom && variant.to === normalizedTo)) {
      return;
    }

    variants.push({ from: normalizedFrom, to: normalizedTo });
  };

  const normalizePhraseRuleRecord = (from, rawRule) => {
    if (typeof rawRule === "string") {
      const candidates = splitReplacementCandidates(rawRule);
      return {
        from,
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
        from,
        to: candidates[0] ?? "",
        candidates,
        priority: Number.isFinite(rawRule[1]) ? rawRule[1] : Number(rawRule[1]) || 0,
        enabled: rawRule[2] !== false,
        regex: rawRule[3] === true
      };
    }

    if (rawRule && typeof rawRule === "object") {
      const candidates = splitReplacementCandidates(rawRule.candidates ?? rawRule.to);
      return {
        ...rawRule,
        from: `${rawRule.from ?? from ?? ""}`,
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

      replaceRules.push({
        id: `${entry.id ?? ""}`.trim() || undefined,
        type: `${entry.type ?? "replace-rule"}`,
        from,
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

    return {
      ...rule,
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

  const ruleUsesBasicFormMatch = (rule) => {
    if (rule?.match_target === "basic_form" || rule?.type === "verb") {
      return true;
    }

    if (rule?.type === "compound" && inferGodanEnding(rule?.from, rule?.to)) {
      return true;
    }

    return listifyConditions(rule?.conditions?.current).some((condition) => {
      if (!condition || typeof condition !== "object") {
        return false;
      }

      return (
        condition.basic_form !== undefined ||
        condition.pos === "動詞" ||
        condition.conjugated_form !== undefined ||
        condition.conjugated_type !== undefined
      );
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

    if (token.surface_form === rule.from) {
      return true;
    }

    if (ruleUsesBasicFormMatch(rule) && token.basic_form === rule.from) {
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

  const applyBasicFormReplacement = (token, rule, replacementBase) => {
    if (!token || !ruleUsesBasicFormMatch(rule) || !rule.from || !replacementBase) {
      return replacementBase;
    }

    if (token.basic_form !== rule.from) {
      return replacementBase;
    }

    const sharedSuffix = getSharedSuffix(rule.from, replacementBase);
    if (!sharedSuffix) {
      return replacementBase;
    }

    const fromStem = rule.from.slice(0, rule.from.length - sharedSuffix.length);
    const toStem = replacementBase.slice(0, replacementBase.length - sharedSuffix.length);
    if (!fromStem) {
      return replacementBase;
    }

    if (!token.surface_form.startsWith(fromStem)) {
      return replacementBase;
    }

    return `${toStem}${token.surface_form.slice(fromStem.length)}`;
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
    pushUniqueVariant(variants, rule.from, replacementBase);
    pushUniqueVariant(variants, `${fromStem}${endingInfo.a}`, `${toStem}${endingInfo.a}`);
    pushUniqueVariant(variants, `${fromStem}${endingInfo.i}`, `${toStem}${endingInfo.i}`);
    pushUniqueVariant(variants, `${fromStem}${endingInfo.e}`, `${toStem}${endingInfo.e}`);
    pushUniqueVariant(variants, `${fromStem}${endingInfo.o}`, `${toStem}${endingInfo.o}`);
    pushUniqueVariant(variants, `${fromStem}${endingInfo.te}`, `${toStem}${endingInfo.te}`);
    pushUniqueVariant(variants, `${fromStem}${endingInfo.ta}`, `${toStem}${endingInfo.ta}`);

    return variants.sort((left, right) => {
      return right.from.length - left.from.length;
    });
  };

  const applyVerbFallbackTransformations = (text, tokenRules) => {
    let result = text;

    for (const rule of tokenRules) {
      const replacementBase = chooseReplacement(rule, rule.from);
      const variants = buildVerbSurfaceFallbackVariants(rule, replacementBase);
      for (const variant of variants) {
        result = result.replace(new RegExp(escapeRegex(variant.from), "gu"), variant.to);
      }
    }

    return result;
  };

  const resolveTokenReplacement = (token, rule, matchedText) => {
    const replacement = chooseReplacement(rule, matchedText);
    return applyBasicFormReplacement(token, rule, replacement);
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

  const applyDictionaryRules = (text, dictionaryRules) => {
    let result = text;

    for (const rule of dictionaryRules) {
      if (!rule || rule.enabled === false) {
        continue;
      }

      if (rule.regex === true) {
        try {
          const regex = new RegExp(rule.from, "gu");
          result = result.replace(regex, (matchedText) => chooseReplacement(rule, matchedText));
        } catch (error) {
          continue;
        }
        continue;
      }

      if (!rule.from) {
        continue;
      }

      const replacement = chooseReplacement(rule, rule.from);
      result = result.replace(new RegExp(escapeRegex(rule.from), "gu"), replacement);
    }

    return result;
  };

  const applyTransformations = (tokens, rules) => {
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
        outputTokens[match.start].surface_form = match.replacement ?? resolveTokenReplacement(outputTokens[match.start], rule, matchedText);

        for (let offset = 1; offset < match.length; offset++) {
          outputTokens[match.start + offset].surface_form = "";
        }

        index = match.start + match.length - 1;
        break;
      }
    }

    return outputTokens.map((token) => token.surface_form).join("");
  };

  const tokenizeAndApplyTokenRules = (text, tokenRules, tokenizer) => {
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
    const transformed = applyTransformations(tokens, tokenRules);
    return applyVerbFallbackTransformations(transformed, tokenRules);
  };

  const transformTextWithStages = (text, stages, tokenizer) => {
    if (!text || !text.trim()) {
      return text;
    }

    let transformedText = text;

    for (const stage of Array.isArray(stages) ? stages : []) {
      if (!stage || !Array.isArray(stage.rules) || stage.rules.length === 0) {
        continue;
      }

      if (stage.kind === "dictionary-rules") {
        transformedText = applyDictionaryRules(transformedText, stage.rules);
        continue;
      }

      if (stage.kind === "token-rules") {
        transformedText = tokenizeAndApplyTokenRules(transformedText, stage.rules, tokenizer);
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

  const inferStoredBundleKind = (source) => {
    if (typeof source?.kind === "string" && source.kind.trim()) {
      return source.kind;
    }

    if (Array.isArray(source?.rules)) {
      return "token-rules";
    }

    if (Array.isArray(source?.entries) && source.entries.some((entry) => {
      return entry && typeof entry === "object" && (
        entry.match_target !== undefined ||
        entry.conditions !== undefined ||
        entry.sequence !== undefined ||
        entry.type === "verb"
      );
    })) {
      return "token-rules";
    }

    if (Array.isArray(source?.children) && source.children.some((child) => inferStoredBundleKind(child) === "token-rules")) {
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

    if (definition.kind !== "dictionary-rules") {
      if (definition.kind === "token-rules" && (Array.isArray(override.entries) || Array.isArray(override.children))) {
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

        return {
          ...definition,
          label: override.label ?? definition.label,
          enabled: override.enabled ?? definition.enabled,
          rules: flattenNodesToRules(override)
        };
      }
      return definition;
    }

    return {
      ...definition,
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

      stages.push({
        id: bundle.id,
        label: bundle.label,
        kind: definition.kind,
        order: bundle.order ?? 0,
        rules: bundleRules
      });

      if (definition.kind === "dictionary-rules") {
        stringRuleCount += bundleRules.length;
      } else if (definition.kind === "token-rules") {
        tokenRuleCount += bundleRules.length;
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
    applyVerbFallbackTransformations,
    loadStagesFromDefinitions,
    normalizeBundleOverridesPayload,
    tokenizeAndApplyTokenRules,
    transformTextWithStages
  };
});

(function (root, factory) {
  const shared = typeof module === "object" && module.exports
    ? require("./transform-shared.js")
    : root.TransformShared;
  const api = factory(shared);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.TransformEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (TransformShared) {
  "use strict";

  if (!TransformShared) {
    throw new Error("TransformShared is not loaded.");
  }
  const splitCommaSeparatedValues = TransformShared.splitCommaSeparatedValues;
  const splitReplacementCandidates = TransformShared.splitReplacementCandidates;
  const normalizeReplacementCandidates = TransformShared.normalizeReplacementCandidates;
  const splitMatchCandidates = TransformShared.splitMatchCandidates;
  const splitPositiveNegativeCandidates = TransformShared.splitPositiveNegativeCandidates;
  const normalizeMatcherCandidateLiteral = TransformShared.normalizeMatcherCandidateLiteral;
  const normalizePhraseRuleRecord = TransformShared.normalizePhraseRuleRecord;
  const normalizePhraseRulesInput = TransformShared.normalizePhraseRulesInput;
  const splitNodeEntries = TransformShared.splitNodeEntries;
  const normalizeDictionaryNode = TransformShared.normalizeDictionaryNode;
  const hasWildcard = TransformShared.hasWildcard;
  const compileWildcardPattern = TransformShared.compileWildcardPattern;
  const matchWildcardPattern = TransformShared.matchWildcardPattern;
  const applyWildcardReplacement = TransformShared.applyWildcardReplacement;
  const expandRegexReplacementTemplate = TransformShared.expandRegexReplacementTemplate;
  const normalizeKanaForMatch = TransformShared.normalizeKanaForMatch;
  const DEFAULT_RUBY_MARKERS = TransformShared.DEFAULT_RUBY_MARKERS;
  const normalizeNarouRubyText = TransformShared.normalizeNarouRubyText;
  const parseRubySegments = TransformShared.parseRubySegments;
  const hasRubySegments = TransformShared.hasRubySegments;
  const hasTrailingKatakanaLongVowel = TransformShared.hasTrailingKatakanaLongVowel;
  const isKatakanaChar = TransformShared.isKatakanaChar;
  const containsKanji = TransformShared.containsKanji;
  const splitTrailingKana = TransformShared.splitTrailingKana;
  const hasKanjiWithTrailingKana = TransformShared.hasKanjiWithTrailingKana;
  const splitKanjiKanaSegments = TransformShared.splitKanjiKanaSegments;
  const isVerbToken = TransformShared.isVerbToken;
  const isSahenVerbToken = TransformShared.isSahenVerbToken;
  const isIchidanVerbToken = TransformShared.isIchidanVerbToken;
  const isGodanVerbToken = TransformShared.isGodanVerbToken;
  const isRenyouGeneralVerbToken = TransformShared.isRenyouGeneralVerbToken;
  const isRenyouTaTeVerbToken = TransformShared.isRenyouTaTeVerbToken;
  const getStage4MinimalVerbSuffix = TransformShared.getStage4MinimalVerbSuffix;

  const KATAKANA_LONG_VOWEL_BUNDLE_ID = "katakana-long-vowel-abbreviation";
  const dictionaryStageCompileCache = new WeakMap();
  const tokenStageCompileCache = new WeakMap();
  const crossStageConflictCache = new WeakMap();
  const runtimePlanCache = new WeakMap();
  let nextRuntimePlanVersion = 1;
  const DEFAULT_TEXT_CACHE_ENTRIES = 5000;
  const DEFAULT_TOKEN_CACHE_ENTRIES = 2000;
  const DEFAULT_TEXT_CACHE_MAX_LENGTH = 8192;
  const DEFAULT_TOKEN_CACHE_MAX_LENGTH = 4096;
  const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;

  const getNow = () => {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  };

  const createLruCache = (maxEntries) => {
    const limit = Number.isFinite(Number(maxEntries))
      ? Math.max(1, Math.floor(Number(maxEntries)))
      : 0;
    const entries = new Map();

    return {
      maxEntries: limit,
      clear() {
        entries.clear();
      },
      get(key) {
        if (limit <= 0 || !entries.has(key)) {
          return undefined;
        }
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      set(key, value) {
        if (limit <= 0) {
          return value;
        }
        if (entries.has(key)) {
          entries.delete(key);
        }
        entries.set(key, value);
        while (entries.size > limit) {
          const oldestKey = entries.keys().next().value;
          entries.delete(oldestKey);
        }
        return value;
      }
    };
  };

  const containsJapaneseText = (value) => {
    return JAPANESE_TEXT_PATTERN.test(`${value ?? ""}`);
  };

  const appendUnique = (list, value) => {
    if (!value || list.includes(value)) {
      return;
    }
    list.push(value);
  };

  const incrementMetric = (metrics, field, amount = 1) => {
    if (!metrics || !field) {
      return;
    }
    metrics[field] = (Number(metrics[field]) || 0) + amount;
  };

  const addStageTiming = (metrics, stageId, elapsedMs) => {
    if (!metrics || !stageId || !Number.isFinite(elapsedMs)) {
      return;
    }
    if (!metrics.stageTimings || typeof metrics.stageTimings !== "object") {
      metrics.stageTimings = {};
    }
    metrics.stageTimings[stageId] = (Number(metrics.stageTimings[stageId]) || 0) + elapsedMs;
  };

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

    if (normalized.startsWith("-") && !normalized.startsWith("\\-")) {
      const body = normalized.slice(1).trim();
      return body ? `-${aliases[body] ?? body}` : "";
    }
    if (normalized.startsWith("\\-")) {
      const body = normalized.slice(1);
      return aliases[body] ?? body;
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
      word_type: normalizeConditionValue("word_type", condition.word_type),
      sequence: Array.isArray(condition.sequence) ? condition.sequence.map(normalizeCondition) : undefined
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

  const normalizeRule = (rule) => {
    const conditions = rule.conditions || {};
    const isRegexRule = rule.regex === true || rule.is_regex === true;
    const replacementSource = rule.to ?? rule.candidates;
    const candidates = normalizeReplacementCandidates(replacementSource, isRegexRule, rule.to);
    const fromOptions = isRegexRule
      ? [`${rule.from ?? ""}`.trim()].filter(Boolean)
      : splitMatchCandidates(rule.from_options ?? rule.from);

    return {
      ...rule,
      from: fromOptions[0] ?? rule.from,
      from_options: fromOptions,
      to: candidates[0] ?? rule.to,
      candidates,
      match_options: rule.match_options && typeof rule.match_options === "object"
        ? { ...rule.match_options }
        : null,
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

  const chooseReplacementTemplate = (rule, matchedText) => {
    const candidates = normalizeReplacementCandidates(
      rule.to ?? rule.candidates,
      rule?.regex === true,
      rule.to
    );

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

  const normalizeReplacementRubyMarkup = (value) => {
    const sourceText = `${value ?? ""}`;
    if (!sourceText.includes(DEFAULT_RUBY_MARKERS.open) || !sourceText.includes(DEFAULT_RUBY_MARKERS.close)) {
      return sourceText;
    }

    if (sourceText.includes("｜") || sourceText.includes("|")) {
      return sourceText;
    }

    return `｜${sourceText}`;
  };

  const chooseReplacement = (rule, matchedText, wildcardCaptures = []) => {
    return normalizeReplacementRubyMarkup(applyWildcardReplacement(
      chooseReplacementTemplate(rule, matchedText),
      wildcardCaptures
    ));
  };

  const appendSourceRubyAnnotation = (rule, replacement, sourceText) => {
    if (rule?.match_options?.ruby_from_source !== true) {
      return normalizeReplacementRubyMarkup(replacement);
    }

    const baseText = `${replacement ?? ""}`;
    const rubySource = `${sourceText ?? ""}`;
    if (!baseText || !rubySource) {
      return baseText;
    }

    if (baseText.includes(DEFAULT_RUBY_MARKERS.open) || baseText.includes(DEFAULT_RUBY_MARKERS.close)) {
      return normalizeReplacementRubyMarkup(baseText);
    }

    return normalizeReplacementRubyMarkup(
      `${baseText}${DEFAULT_RUBY_MARKERS.open}${rubySource}${DEFAULT_RUBY_MARKERS.close}`
    );
  };

  const escapeRegex = (value) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const valueMatches = (actual, expected, options = {}) => {
    if (expected === undefined || expected === null) {
      return true;
    }

    if (Array.isArray(expected)) {
      const positive = [];
      const negative = [];
      for (const entry of expected) {
        const text = `${entry ?? ""}`;
        if (text.startsWith("-") && !text.startsWith("\\-")) {
          const normalized = normalizeMatcherCandidateLiteral(text.slice(1).trim());
          if (normalized) {
            negative.push(normalized);
          }
        } else {
          const normalized = normalizeMatcherCandidateLiteral(text);
          if (normalized) {
            positive.push(normalized);
          }
        }
      }
      const negativeMatched = negative.some((entry) => valueMatches(actual, entry, options));
      if (negativeMatched) {
        return false;
      }
      return positive.length === 0
        ? true
        : positive.some((entry) => valueMatches(actual, entry, options));
    }

    if (typeof actual === "string" && typeof expected === "string") {
      if (expected.startsWith("-") && !expected.startsWith("\\-")) {
        const negativeExpected = normalizeMatcherCandidateLiteral(expected.slice(1).trim());
        return negativeExpected ? !valueMatches(actual, negativeExpected, options) : true;
      }
      const normalizedExpected = normalizeMatcherCandidateLiteral(expected);
      const kanaInsensitive = options.kanaInsensitive === true;
      if (hasWildcard(normalizedExpected)) {
        return Boolean(matchWildcardPattern(actual, normalizedExpected, {
          kanaInsensitive,
          preserveCaptures: true
        }));
      }
      return kanaInsensitive
        ? normalizeKanaForMatch(actual) === normalizeKanaForMatch(normalizedExpected)
        : actual === normalizedExpected;
    }

    return actual === expected;
  };

  const ruleUsesKanaInsensitiveMatch = (rule) => {
    return rule?.regex !== true && rule?.match_options?.kana_insensitive === true;
  };

  const matchAnyCandidate = (actual, candidates, options = {}) => {
    const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
    const positive = [];
    const negative = [];
    for (const candidate of normalizedCandidates) {
      const text = `${candidate ?? ""}`;
      if (text.startsWith("-") && !text.startsWith("\\-")) {
        const normalized = normalizeMatcherCandidateLiteral(text.slice(1).trim());
        if (normalized) {
          negative.push(normalized);
        }
      } else {
        const normalized = normalizeMatcherCandidateLiteral(text);
        if (normalized) {
          positive.push(normalized);
        }
      }
    }

    if (negative.length > 0 && matchAnyCandidate(actual, negative, { ...options, ignoreNegative: true })) {
      return null;
    }

    if (positive.length === 0 && options.ignoreNegative !== true) {
      return null;
    }

    for (const candidate of positive) {
      if (typeof actual !== "string" || typeof candidate !== "string") {
        if (actual === candidate) {
          return {
            matched: true,
            matchedFrom: candidate,
            wildcardCaptures: []
          };
        }
        continue;
      }

      if (hasWildcard(candidate)) {
        const wildcardMatch = matchWildcardPattern(actual, candidate, {
          kanaInsensitive: options.kanaInsensitive === true,
          preserveCaptures: true
        });
        if (wildcardMatch) {
          return {
            matched: true,
            matchedFrom: candidate,
            wildcardCaptures: wildcardMatch.captures ?? []
          };
        }
        continue;
      }

      const matched = options.kanaInsensitive === true
        ? normalizeKanaForMatch(actual) === normalizeKanaForMatch(candidate)
        : actual === candidate;
      if (matched) {
        return {
          matched: true,
          matchedFrom: candidate,
          wildcardCaptures: []
        };
      }
    }

    return null;
  };

  const getRuleFromCandidates = (rule) => {
    const candidates = splitMatchCandidates(rule?.from_options ?? rule?.from);
    return candidates.length > 0 ? candidates : [`${rule?.from ?? ""}`.trim()].filter(Boolean);
  };

  const getPositiveRuleFromCandidates = (rule) => {
    return getRuleFromCandidates(rule).filter((candidate) => {
      const text = `${candidate ?? ""}`;
      return text && (!text.startsWith("-") || text.startsWith("\\-"));
    });
  };

  const compareRuleOrder = (left, right) => {
    return (Number(right?.priority) || 0) - (Number(left?.priority) || 0) ||
      (Number(left?.__compiledOrder) || 0) - (Number(right?.__compiledOrder) || 0);
  };

  const tokenMatchesCondition = (token, condition) => {
    if (!token || !condition) {
      return false;
    }

    if (typeof condition === "string") {
      return (
        valueMatches(token.surface_form, condition) ||
        valueMatches(token.basic_form, condition) ||
        valueMatches(token.pos, condition) ||
        valueMatches(token.pos_detail_1, condition) ||
        valueMatches(token.pos_detail_2, condition) ||
        valueMatches(token.pos_detail_3, condition) ||
        valueMatches(token.conjugated_form, condition) ||
        valueMatches(`${token.pos}${token.conjugated_form}`, condition) ||
        valueMatches(`${token.pos}${token.pos_detail_1}`, condition)
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

  const sequenceMatcherMatchesAt = (tokens, start, sequence) => {
    if (!Array.isArray(sequence) || sequence.length === 0 || start < 0) {
      return false;
    }

    for (let offset = 0; offset < sequence.length; offset++) {
      const token = tokens[start + offset];
      const matcher = sequence[offset];
      if (!token || !tokenSatisfiesMatcher(token, matcher)) {
        return false;
      }
    }
    return true;
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

  const singleTokenMatchInfo = (tokens, index, rule) => {
    const token = tokens[index];
    if (!token) {
      return null;
    }

    const fromCandidates = getRuleFromCandidates(rule);
    if (expectsVerbToken(rule) && token.pos !== "動詞") {
      return null;
    }
    if (expectsAdjectiveToken(rule) && token.pos !== "形容詞") {
      return null;
    }

    if (ruleRequiresStrictBasicFormMatch(rule)) {
      return matchAnyCandidate(token.basic_form, fromCandidates, {
        kanaInsensitive: ruleUsesKanaInsensitiveMatch(rule)
      });
    }

    const surfaceMatch = matchAnyCandidate(token.surface_form, fromCandidates, {
      kanaInsensitive: ruleUsesKanaInsensitiveMatch(rule)
    });
    if (surfaceMatch) {
      return {
        ...surfaceMatch,
        matchedTarget: "surface_form"
      };
    }

    if (ruleUsesBasicFormMatch(rule)) {
      const basicMatch = matchAnyCandidate(token.basic_form, fromCandidates, {
        kanaInsensitive: ruleUsesKanaInsensitiveMatch(rule)
      });
      if (basicMatch) {
        return {
          ...basicMatch,
          matchedTarget: "basic_form"
        };
      }
    }

    return null;
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

  const resolveTokenReplacement = (token, rule, matchedText, wildcardCaptures = [], matchedFromOverride = null) => {
    const replacement = chooseReplacement(rule, matchedText, wildcardCaptures);
    const matchedFrom = ruleUsesBasicFormMatch(rule)
      ? (matchedFromOverride ?? token?.basic_form)
      : (matchedFromOverride ?? token?.surface_form);
    const replacementBase = applyBasicFormReplacement(token, rule, replacement, matchedFrom);
    return appendSourceRubyAnnotation(rule, replacementBase, matchedText);
  };

  const surroundingConditionsMatch = (tokens, index, length, rule) => {
    const currentTokens = tokens.slice(index, index + length);
    const currentToken = currentTokens[0];
    const prevToken = tokens[index - 1];
    const nextToken = tokens[index + length];
    const conditions = rule.conditions || {};
    const { current, prev, next } = conditions;

    const branchMatches = (conditionList, anchorToken, sequenceStart, expectedSequenceLength = null) => {
      if (!conditionList) {
        return true;
      }
      const list = Array.isArray(conditionList) ? conditionList : [conditionList];
      return list.some((condition) => {
        if (!tokenMatchesCondition(anchorToken, condition)) {
          return false;
        }
        if (!condition || typeof condition !== "object" || !Array.isArray(condition.sequence) || condition.sequence.length === 0) {
          return true;
        }
        if (expectedSequenceLength !== null && condition.sequence.length !== expectedSequenceLength) {
          return false;
        }
        const start = typeof sequenceStart === "function" ? sequenceStart(condition) : sequenceStart;
        return sequenceMatcherMatchesAt(tokens, start, condition.sequence);
      });
    };

    if (current && !branchMatches(current, currentToken, index, length)) {
      return false;
    }

    if (prev && !branchMatches(prev, prevToken, (condition) => {
      return index - (Array.isArray(condition?.sequence) && condition.sequence.length > 0 ? condition.sequence.length : 1);
    })) {
      return false;
    }

    if (next && !branchMatches(next, nextToken, index + length)) {
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

    const singleTokenMatch = singleTokenMatchInfo(tokens, index, rule);
    if (!singleTokenMatch) {
      return null;
    }

    if (!surroundingConditionsMatch(tokens, index, 1, rule)) {
      return null;
    }

    return {
      start: index,
      length: 1,
      matchedFrom: singleTokenMatch.matchedFrom ?? null,
      wildcardCaptures: Array.isArray(singleTokenMatch.wildcardCaptures) ? singleTokenMatch.wildcardCaptures : []
    };
  };

  const makeCandidateRule = (rule, candidate) => {
    return {
      ...rule,
      from: candidate,
      from_options: [candidate]
    };
  };

  const addCandidateRecord = (map, key, record) => {
    if (!key) {
      return;
    }
    const records = map.get(key);
    if (records) {
      records.push(record);
      return;
    }
    map.set(key, [record]);
  };

  const compareDictionaryRecords = (left, right) => {
    return right.priority - left.priority ||
      right.length - left.length ||
      left.order - right.order;
  };

  const compileSlowDictionaryRule = (item) => {
    const rule = item?.rule ?? item;
    if (!rule || typeof rule !== "object") {
      return {
        ...item,
        rule
      };
    }

    if (rule.regex === true) {
      try {
        return {
          ...item,
          rule,
          compiledRegex: new RegExp(rule.from, "gu")
        };
      } catch (error) {
        return {
          ...item,
          rule,
          compiledRegex: null
        };
      }
    }

    const compiledPatterns = [];
    for (const fromCandidate of getPositiveRuleFromCandidates(rule)) {
      if (!fromCandidate) {
        continue;
      }
      const normalizedPattern = `${fromCandidate}`;
      if (!hasWildcard(normalizedPattern)) {
        compiledPatterns.push({
          fromCandidate: normalizedPattern,
          literal: true
        });
        continue;
      }
      compiledPatterns.push({
        fromCandidate: normalizedPattern,
        literal: false,
        compiledWildcard: compileWildcardPattern(
          ruleUsesKanaInsensitiveMatch(rule)
            ? normalizeKanaForMatch(normalizedPattern)
            : normalizedPattern,
          {
            anchored: false,
            flags: "gdu"
          }
        )
      });
    }

    return {
      ...item,
      rule,
      compiledPatterns
    };
  };

  const compileDictionaryStage = (rules) => {
    const safeRules = Array.isArray(rules) ? rules : [];
    const cached = dictionaryStageCompileCache.get(safeRules);
    if (cached) {
      return cached;
    }

    const compiled = {
      exactBuckets: new Map(),
      kanaExactBuckets: new Map(),
      slowRules: []
    };
    let order = 0;

    for (const rule of safeRules) {
      if (!rule || rule.enabled === false || ruleRequiresTokenMatching(rule)) {
        order += 1;
        continue;
      }

      if (rule.regex === true || !rule.from) {
        compiled.slowRules.push({ rule, order });
        order += 1;
        continue;
      }

      const kanaInsensitive = ruleUsesKanaInsensitiveMatch(rule);
      const fromCandidates = getPositiveRuleFromCandidates(rule);
      let hasIndexedCandidate = false;

      for (const fromCandidate of fromCandidates) {
        if (!fromCandidate) {
          continue;
        }

        if (fromCandidate.includes("\\") || hasWildcard(fromCandidate)) {
          compiled.slowRules.push({
            rule: makeCandidateRule(rule, fromCandidate),
            order: order + compiled.slowRules.length / 1000000
          });
          continue;
        }

        const candidateRule = makeCandidateRule(rule, fromCandidate);
        const key = kanaInsensitive
          ? normalizeKanaForMatch(fromCandidate)
          : fromCandidate;
        const record = {
          key,
          length: fromCandidate.length,
          priority: Number(rule.priority) || 0,
          order,
          rule: candidateRule,
          kanaInsensitive
        };
        addCandidateRecord(
          kanaInsensitive ? compiled.kanaExactBuckets : compiled.exactBuckets,
          key[0],
          record
        );
        hasIndexedCandidate = true;
        order += 1;
      }

      if (!hasIndexedCandidate && fromCandidates.length === 0) {
        compiled.slowRules.push({ rule, order });
        order += 1;
      }
    }

    for (const records of compiled.exactBuckets.values()) {
      records.sort(compareDictionaryRecords);
    }
    for (const records of compiled.kanaExactBuckets.values()) {
      records.sort(compareDictionaryRecords);
    }
    compiled.slowRules.sort((left, right) => {
      return compareRuleOrder(
        { ...left.rule, __compiledOrder: left.order },
        { ...right.rule, __compiledOrder: right.order }
      );
    });
    compiled.slowRules = compiled.slowRules.map(compileSlowDictionaryRule);

    dictionaryStageCompileCache.set(safeRules, compiled);
    return compiled;
  };

  const findBestDictionaryRecordAt = (text, normalizedText, index, compiled) => {
    let best = null;
    const rawRecords = compiled.exactBuckets.get(text[index]) ?? [];
    for (const record of rawRecords) {
      if (text.startsWith(record.key, index) && (!best || compareDictionaryRecords(record, best) < 0)) {
        best = record;
      }
    }

    const kanaRecords = compiled.kanaExactBuckets.get(normalizedText[index]) ?? [];
    for (const record of kanaRecords) {
      if (normalizedText.startsWith(record.key, index) && (!best || compareDictionaryRecords(record, best) < 0)) {
        best = record;
      }
    }

    return best;
  };

  const applyCompiledDictionaryExactRules = (text, compiled, debugCollector, stageId, metrics = null) => {
    if (!compiled || (compiled.exactBuckets.size === 0 && compiled.kanaExactBuckets.size === 0)) {
      return text;
    }

    const sourceText = `${text ?? ""}`;
    const normalizedText = compiled.kanaExactBuckets.size > 0
      ? normalizeKanaForMatch(sourceText)
      : sourceText;
    let output = "";
    let cursor = 0;

    while (cursor < sourceText.length) {
      const record = findBestDictionaryRecordAt(sourceText, normalizedText, cursor, compiled);
      if (!record) {
        output += sourceText[cursor];
        cursor += 1;
        continue;
      }

      const matchedText = sourceText.slice(cursor, cursor + record.length);
      const replacement = appendSourceRubyAnnotation(
        record.rule,
        chooseReplacement(record.rule, matchedText),
        matchedText
      );
      emitDebugEvent(debugCollector, {
        phase: "dictionary-match",
        stageId,
        ruleId: record.rule.id ?? null,
        matchedText,
        replacement,
        regex: false,
        from: record.rule.from
      });
      incrementMetric(metrics, "dictionaryMatches");
      output += replacement;
      cursor += record.length;
    }

    return output;
  };

  const replaceWildcardPatternWithResolver = (text, pattern, replacementTemplate, options = {}, resolveReplacement = null) => {
    const sourceText = `${text ?? ""}`;
    const sourcePattern = `${pattern ?? ""}`;
    const decodeLiteralPattern = (value) => {
      return `${value ?? ""}`.replace(/\\([\[\],*\\-])/g, "$1");
    };
    const replacementFor = typeof resolveReplacement === "function"
      ? resolveReplacement
      : (replacement, _matchedText) => replacement;
    const normalizedText = options.kanaInsensitive
      ? normalizeKanaForMatch(sourceText)
      : sourceText;
    const normalizedPattern = options.kanaInsensitive
      ? normalizeKanaForMatch(sourcePattern)
      : sourcePattern;

    if (!hasWildcard(sourcePattern)) {
      const literalPattern = decodeLiteralPattern(normalizedPattern);
      let output = "";
      let cursor = 0;
      let matchIndex = normalizedText.indexOf(literalPattern);
      while (matchIndex >= 0) {
        const matchedText = sourceText.slice(matchIndex, matchIndex + literalPattern.length);
        const replacement = replacementFor(
          applyWildcardReplacement(replacementTemplate, []),
          matchedText
        );
        output += sourceText.slice(cursor, matchIndex);
        output += replacement;
        cursor = matchIndex + literalPattern.length;
        matchIndex = normalizedText.indexOf(literalPattern, cursor);
      }
      return output + sourceText.slice(cursor);
    }

    const compiled = options?.compiledWildcard ?? compileWildcardPattern(normalizedPattern, { anchored: false, flags: "gdu" });
    let output = "";
    let cursor = 0;
    for (const match of normalizedText.matchAll(compiled.regex)) {
      const range = match.indices?.[0];
      if (!range || range[0] < cursor) {
        continue;
      }
      const captures = match.indices.slice(1, 1 + compiled.captureCount).map((captureRange) => {
        if (!captureRange) {
          return "";
        }
        return sourceText.slice(captureRange[0], captureRange[1]);
      });
      const matchedText = sourceText.slice(range[0], range[1]);
      const replacement = replacementFor(
        applyWildcardReplacement(replacementTemplate, captures),
        matchedText
      );
      output += sourceText.slice(cursor, range[0]);
      output += replacement;
      cursor = range[1];
      if (range[0] === range[1]) {
        cursor += 1;
      }
    }
    return output + sourceText.slice(cursor);
  };

  const applySlowDictionaryRules = (text, slowRules, debugCollector, stageId, metrics = null) => {
    let result = text;

    for (const item of Array.isArray(slowRules) ? slowRules : []) {
      const rule = item?.rule ?? item;
      if (!rule || rule.enabled === false || ruleRequiresTokenMatching(rule)) {
        continue;
      }

      if (rule.regex === true) {
        const regex = item?.compiledRegex;
        if (!regex) {
          continue;
        }
        try {
          result = result.replace(regex, (...args) => {
            const matchedText = args[0];
            const hasGroups = args.length > 0 && args[args.length - 1] && typeof args[args.length - 1] === "object";
            const groups = hasGroups ? args[args.length - 1] : null;
            const sourceText = hasGroups ? args[args.length - 2] : args[args.length - 1];
            const offset = hasGroups ? args[args.length - 3] : args[args.length - 2];
            const captures = args.slice(1, hasGroups ? -3 : -2);
            const replacementTemplate = chooseReplacementTemplate(rule, matchedText);
            const replacement = appendSourceRubyAnnotation(
              rule,
              expandRegexReplacementTemplate(replacementTemplate, matchedText, captures, groups, sourceText, offset),
              matchedText
            );
            emitDebugEvent(debugCollector, {
              phase: "dictionary-match",
              stageId,
              ruleId: rule.id ?? null,
              matchedText,
              replacement,
              regex: true,
              from: rule.from
            });
            incrementMetric(metrics, "regexMatches");
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

      const fromCandidates = getPositiveRuleFromCandidates(rule);
      const compiledPatterns = Array.isArray(item?.compiledPatterns)
        ? item.compiledPatterns
        : fromCandidates.map((fromCandidate) => ({
          fromCandidate
        }));
      for (const pattern of compiledPatterns) {
        const fromCandidate = pattern?.fromCandidate ?? "";
        if (!fromCandidate) {
          continue;
        }

        const replacementTemplate = chooseReplacementTemplate(
          makeCandidateRule(rule, fromCandidate),
          fromCandidate
        );
        result = replaceWildcardPatternWithResolver(
          result,
          fromCandidate,
          replacementTemplate,
          {
            kanaInsensitive: ruleUsesKanaInsensitiveMatch(rule),
            compiledWildcard: pattern?.compiledWildcard ?? null
          },
          (replacement, matchedText) => {
            incrementMetric(metrics, hasWildcard(fromCandidate) ? "wildcardMatches" : "dictionaryMatches");
            return appendSourceRubyAnnotation(rule, replacement, matchedText);
          }
        );
      }
    }

    return result;
  };

  const applyDictionaryRules = (text, dictionaryRules, debugCollector, stageId) => {
    const compiled = compileDictionaryStage(dictionaryRules);
    const exactResult = applyCompiledDictionaryExactRules(text, compiled, debugCollector, stageId);
    return applySlowDictionaryRules(exactResult, compiled.slowRules, debugCollector, stageId);
  };

  const canPreserveNarouRubyAnnotations = (text) => {
    if (typeof text !== "string" || !text) {
      return false;
    }

    return text.includes(DEFAULT_RUBY_MARKERS.open) && text.includes(DEFAULT_RUBY_MARKERS.close);
  };

  const rebuildRubyAnnotatedText = (segments) => {
    return segments.map((segment) => {
      if (!segment) {
        return "";
      }
      if (segment.type === "ruby") {
        const base = `${segment.base ?? ""}`;
        const ruby = `${segment.ruby ?? ""}`;
        return `｜${base}${DEFAULT_RUBY_MARKERS.open}${ruby}${DEFAULT_RUBY_MARKERS.close}`;
      }
      return `${segment.text ?? ""}`;
    }).join("");
  };

  const applyStageTransformRaw = (text, stage, tokenizer, debugCollector) => {
    if (stage.kind === "dictionary-rules") {
      return applyDictionaryRules(text, stage.rules, debugCollector, stage.id);
    }

    if (stage.kind === "token-rules") {
      if (stage.runtime_mode === "verb-okurigana-stage4") {
        return applyVerbOkuriganaStage4(text, tokenizer, debugCollector, stage.id);
      }
      if (stage.runtime_mode === "katakana-long-vowel-abbreviation") {
        return applyKatakanaLongVowelAbbreviation(text, stage.rules, debugCollector, stage.id, stage.settings);
      }
      return tokenizeAndApplyTokenRules(
        text,
        stage.rules,
        tokenizer,
        debugCollector,
        stage.id
      );
    }

    return text;
  };

  const applyStageTransformPreservingRuby = (text, stage, tokenizer, debugCollector) => {
    if (!canPreserveNarouRubyAnnotations(text)) {
      return applyStageTransformRaw(text, stage, tokenizer, debugCollector);
    }

    const normalizedText = normalizeNarouRubyText(text, {
      allowLooseImplicitBase: true
    });
    const segments = parseRubySegments(normalizedText, DEFAULT_RUBY_MARKERS, {
      allowLooseImplicitBase: false
    });
    if (!hasRubySegments(segments)) {
      return applyStageTransformRaw(text, stage, tokenizer, debugCollector);
    }

    const transformedSegments = segments.map((segment) => {
      if (!segment) {
        return segment;
      }
      if (segment.type === "ruby") {
        const transformedBase = applyStageTransformRaw(`${segment.base ?? ""}`, stage, tokenizer, debugCollector);
        return {
          ...segment,
          base: transformedBase || segment.base
        };
      }
      return {
        ...segment,
        text: applyStageTransformRaw(`${segment.text ?? ""}`, stage, tokenizer, debugCollector)
      };
    });

    return rebuildRubyAnnotatedText(transformedSegments);
  };

  const applyCompiledStageTransformPreservingRuby = (text, stage, tokenizer, plan, debugCollector, metrics) => {
    if (!canPreserveNarouRubyAnnotations(text)) {
      return applyCompiledStageTransform(text, stage, tokenizer, plan, debugCollector, metrics);
    }

    const normalizedText = normalizeNarouRubyText(text, {
      allowLooseImplicitBase: true
    });
    const segments = parseRubySegments(normalizedText, DEFAULT_RUBY_MARKERS, {
      allowLooseImplicitBase: false
    });
    if (!hasRubySegments(segments)) {
      return applyCompiledStageTransform(text, stage, tokenizer, plan, debugCollector, metrics);
    }

    return rebuildRubyAnnotatedText(segments.map((segment) => {
      if (!segment) {
        return segment;
      }
      if (segment.type === "ruby") {
        return {
          ...segment,
          base: applyCompiledStageTransform(`${segment.base ?? ""}`, stage, tokenizer, plan, debugCollector, metrics) || segment.base
        };
      }
      return {
        ...segment,
        text: applyCompiledStageTransform(`${segment.text ?? ""}`, stage, tokenizer, plan, debugCollector, metrics)
      };
    }));
  };

  const addRuleToMap = (map, key, rule) => {
    if (!key) {
      return;
    }
    const rules = map.get(key);
    if (rules) {
      rules.push(rule);
      return;
    }
    map.set(key, [rule]);
  };

  const canIndexTokenRule = (rule) => {
    if (!rule || rule.enabled === false || rule.regex === true || rule.character_map) {
      return false;
    }

    if (Array.isArray(rule.sequence) && rule.sequence.length > 0) {
      return false;
    }

    if (ruleUsesKanaInsensitiveMatch(rule)) {
      return false;
    }

    return getRuleFromCandidates(rule).some((candidate) => {
      return candidate && !candidate.includes("\\") && !hasWildcard(candidate);
    });
  };

  const getPositiveLiteralConditionValues = (value) => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((entry) => `${entry ?? ""}`.trim())
      .filter((entry) => {
        return entry &&
          !entry.startsWith("-") &&
          !entry.includes("\\") &&
          !hasWildcard(entry);
      });
  };

  const indexSequenceRule = (compiled, rule) => {
    const firstMatcher = Array.isArray(rule?.sequence) ? rule.sequence[0] : null;
    if (!firstMatcher) {
      return false;
    }

    if (typeof firstMatcher === "string") {
      const values = getPositiveLiteralConditionValues(firstMatcher);
      for (const value of values) {
        addRuleToMap(compiled.sequenceSurfaceMap, value, rule);
        addRuleToMap(compiled.sequenceBasicMap, value, rule);
      }
      return values.length > 0;
    }

    if (typeof firstMatcher !== "object") {
      return false;
    }

    const surfaceValues = getPositiveLiteralConditionValues(firstMatcher.surface_form);
    const basicValues = getPositiveLiteralConditionValues(firstMatcher.basic_form);
    for (const value of surfaceValues) {
      addRuleToMap(compiled.sequenceSurfaceMap, value, rule);
    }
    for (const value of basicValues) {
      addRuleToMap(compiled.sequenceBasicMap, value, rule);
    }
    return surfaceValues.length > 0 || basicValues.length > 0;
  };

  const extractSequenceTriggerCandidate = (sequence) => {
    const first = Array.isArray(sequence) ? sequence[0] : null;
    if (!first) {
      return "";
    }
    if (typeof first === "string") {
      return first;
    }
    if (typeof first === "object") {
      return `${first.surface_form ?? first.surface ?? first.from ?? first.basic_form ?? first.basic ?? ""}`.trim();
    }
    return "";
  };

  const buildTokenTriggerMetadata = (rules, runtimeMode = null) => {
    const triggerTerms = [];
    const triggerChars = [];
    let hasUnknownTrigger = false;
    let hasJapaneseTrigger = false;
    let hasNonJapaneseTrigger = false;
    const requiresJapanese = runtimeMode === "verb-okurigana-stage4";

    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!rule || rule.enabled === false) {
        continue;
      }

      const sequenceTrigger = Array.isArray(rule.sequence) && rule.sequence.length > 0
        ? extractSequenceTriggerCandidate(rule.sequence)
        : "";
      const candidates = sequenceTrigger
        ? [sequenceTrigger]
        : getPositiveRuleFromCandidates(rule);
      if (candidates.length === 0) {
        hasUnknownTrigger = true;
      }

      for (const candidate of candidates) {
        const term = `${candidate ?? ""}`.trim();
        if (!term) {
          continue;
        }
        if (rule.regex === true || term.includes("\\") || hasWildcard(term)) {
          hasUnknownTrigger = true;
          continue;
        }

        appendUnique(triggerTerms, term);
        const termHasJapanese = containsJapaneseText(term);
        if (termHasJapanese) {
          hasJapaneseTrigger = true;
        } else {
          hasNonJapaneseTrigger = true;
        }

        for (const char of Array.from(term)) {
          appendUnique(triggerChars, char);
        }
      }
    }

    return {
      requiresJapanese,
      hasUnknownTrigger,
      hasJapaneseTrigger,
      hasNonJapaneseTrigger,
      terms: triggerTerms,
      chars: triggerChars
    };
  };

  const textMatchesTokenTriggers = (text, metadata) => {
    const sourceText = `${text ?? ""}`;
    if (!sourceText.trim()) {
      return false;
    }

    const safeMetadata = metadata && typeof metadata === "object"
      ? metadata
      : {
        requiresJapanese: false,
        hasUnknownTrigger: true,
        hasJapaneseTrigger: false,
        hasNonJapaneseTrigger: false,
        terms: [],
        chars: []
      };
    const hasJapaneseText = containsJapaneseText(sourceText);

    if (safeMetadata.requiresJapanese && !hasJapaneseText) {
      return false;
    }

    if (Array.isArray(safeMetadata.chars) && safeMetadata.chars.length > 0) {
      const hasTriggerChar = safeMetadata.chars.some((char) => char && sourceText.includes(char));
      if (!hasTriggerChar) {
        return false;
      }
    } else if (safeMetadata.hasJapaneseTrigger && !safeMetadata.hasNonJapaneseTrigger && !hasJapaneseText) {
      return false;
    }

    if (
      Array.isArray(safeMetadata.terms) &&
      safeMetadata.terms.length > 0 &&
      !safeMetadata.hasJapaneseTrigger
    ) {
      const hasTriggerTerm = safeMetadata.terms.some((term) => term && sourceText.includes(term));
      if (!hasTriggerTerm && !safeMetadata.hasUnknownTrigger) {
        return false;
      }
    }

    if (safeMetadata.hasUnknownTrigger) {
      return safeMetadata.requiresJapanese ? hasJapaneseText : true;
    }

    return true;
  };

  const compileTokenStage = (rules) => {
    const safeRules = Array.isArray(rules) ? rules : [];
    const cached = tokenStageCompileCache.get(safeRules);
    if (cached) {
      return cached;
    }

    const compiled = {
      surfaceMap: new Map(),
      basicMap: new Map(),
      sequenceSurfaceMap: new Map(),
      sequenceBasicMap: new Map(),
      broadRules: []
    };

    safeRules.forEach((rule, index) => {
      if (!rule || rule.enabled === false) {
        return;
      }

      const compiledRule = {
        ...rule,
        __compiledOrder: index
      };

      if (Array.isArray(compiledRule.sequence) && compiledRule.sequence.length > 0) {
        if (!indexSequenceRule(compiled, compiledRule)) {
          compiled.broadRules.push(compiledRule);
        }
        return;
      }

      if (!canIndexTokenRule(compiledRule)) {
        compiled.broadRules.push(compiledRule);
        return;
      }

      const fromCandidates = getPositiveRuleFromCandidates(compiledRule)
        .filter((candidate) => candidate && !candidate.includes("\\") && !hasWildcard(candidate));
      if (fromCandidates.length === 0) {
        compiled.broadRules.push(compiledRule);
        return;
      }
      if (ruleRequiresStrictBasicFormMatch(compiledRule)) {
        for (const candidate of fromCandidates) {
          addRuleToMap(compiled.basicMap, candidate, compiledRule);
        }
        return;
      }

      for (const candidate of fromCandidates) {
        addRuleToMap(compiled.surfaceMap, candidate, compiledRule);
        if (ruleUsesBasicFormMatch(compiledRule)) {
          addRuleToMap(compiled.basicMap, candidate, compiledRule);
        }
      }
    });

    const sortRules = (list) => list.sort(compareRuleOrder);
    for (const rulesForKey of compiled.surfaceMap.values()) {
      sortRules(rulesForKey);
    }
    for (const rulesForKey of compiled.basicMap.values()) {
      sortRules(rulesForKey);
    }
    for (const rulesForKey of compiled.sequenceSurfaceMap.values()) {
      sortRules(rulesForKey);
    }
    for (const rulesForKey of compiled.sequenceBasicMap.values()) {
      sortRules(rulesForKey);
    }
    sortRules(compiled.broadRules);

    tokenStageCompileCache.set(safeRules, compiled);
    return compiled;
  };

  const getCandidateTokenRules = (compiled, token) => {
    const seen = new Set();
    const candidates = [];
    const pushRules = (rules) => {
      for (const rule of rules ?? []) {
        if (!seen.has(rule)) {
          seen.add(rule);
          candidates.push(rule);
        }
      }
    };

    pushRules(compiled.surfaceMap.get(token?.surface_form));
    pushRules(compiled.basicMap.get(token?.basic_form));
    pushRules(compiled.sequenceSurfaceMap.get(token?.surface_form));
    pushRules(compiled.sequenceBasicMap.get(token?.basic_form));
    pushRules(compiled.broadRules);
    return candidates.sort(compareRuleOrder);
  };

  const applyTransformationsToTokens = (tokens, rules, debugCollector, stageId) => {
    const outputTokens = tokens.map((token) => ({ ...token }));
    const compiled = compileTokenStage(rules);

    for (let index = 0; index < outputTokens.length; index++) {
      const candidateRules = getCandidateTokenRules(compiled, outputTokens[index]);
      for (const rule of candidateRules) {
        const match = ruleMatches(outputTokens, index, rule);
        if (!match) {
          continue;
        }

        const matchedTokens = outputTokens
          .slice(match.start, match.start + match.length)
          .map((matchedToken) => matchedToken.surface_form);

        const matchedText = matchedTokens.join("");
        const replacement = match.replacement ?? resolveTokenReplacement(
          outputTokens[match.start],
          rule,
          matchedText,
          match.wildcardCaptures ?? [],
          match.matchedFrom ?? null
        );
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

  const applyTokenRulesToTokens = (text, tokens, tokenRules, debugCollector, stageId) => {
    const safeTokens = Array.isArray(tokens) ? tokens : [];
    emitDebugEvent(debugCollector, {
      phase: "tokenize",
      stageId,
      text,
      tokens: safeTokens.map(snapshotToken)
    });
    const transformedTokens = applyTransformationsToTokens(safeTokens, tokenRules, debugCollector, stageId);
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

    return applyTokenRulesToTokens(text, tokenizer.tokenize(text), tokenRules, debugCollector, stageId);
  };

  const isMasuAuxiliaryToken = (token) => {
    if (!token || typeof token !== "object") {
      return false;
    }

    return token.surface_form === "ます" || token.basic_form === "ます";
  };

  const isIndependentVerbToken = (token) => {
    return isVerbToken(token) && token.pos_detail_1 === "自立";
  };

  const hasNonVerbKanjiPrefix = (tokens, index) => {
    const previousToken = tokens[index - 1];
    if (!previousToken || isVerbToken(previousToken)) {
      return false;
    }

    return containsKanji(previousToken.surface_form ?? "");
  };

  const isStage4NominalToken = (token) => {
    if (!token || token.pos !== "名詞") {
      return false;
    }

    if (token.pos_detail_1 && !["一般", "サ変接続"].includes(token.pos_detail_1)) {
      return false;
    }

    return hasKanjiWithTrailingKana(token.surface_form ?? "");
  };

  const replaceTrailingKanaWithSuffix = (segment, suffix) => {
    const splitSegment = splitTrailingKana(segment);
    return `${splitSegment.stem}${suffix ?? ""}`;
  };

  const startsWithStage4RemovableStemKana = (okurigana) => {
    const firstKana = Array.from(`${okurigana ?? ""}`)[0] ?? "";
    return firstKana === "ま" || firstKana === "わ" || firstKana === "が" || firstKana === "な";
  };

  const dropStage4LeadingRemovableStemKana = (okurigana) => {
    const chars = Array.from(`${okurigana ?? ""}`);
    if (chars.length <= 1 || !startsWithStage4RemovableStemKana(okurigana)) {
      return null;
    }
    return chars.slice(1).join("");
  };

  const replaceStage4GodanTrailingKana = (segment, suffix) => {
    const splitSegment = splitTrailingKana(segment);
    if (!splitSegment.stem || !splitSegment.okurigana) {
      return null;
    }

    if (!startsWithStage4RemovableStemKana(splitSegment.okurigana)) {
      return null;
    }

    return `${splitSegment.stem}${suffix ?? ""}`;
  };

  const replaceStage4RemovableStemKana = (segment) => {
    const splitSegment = splitTrailingKana(segment);
    if (!splitSegment.stem || !containsKanji(splitSegment.stem) || !splitSegment.okurigana) {
      return null;
    }

    const remainingOkurigana = dropStage4LeadingRemovableStemKana(splitSegment.okurigana);
    if (remainingOkurigana === null) {
      return null;
    }

    return `${splitSegment.stem}${remainingOkurigana}`;
  };

  const compressStage4FinalRenyouSegment = (segment) => {
    const stemKanaRemoved = replaceStage4RemovableStemKana(segment);
    if (stemKanaRemoved !== null) {
      return stemKanaRemoved;
    }

    const splitSegment = splitTrailingKana(segment);
    if (!splitSegment.stem || !containsKanji(splitSegment.stem) || !splitSegment.okurigana) {
      return null;
    }

    return Array.from(splitSegment.okurigana).length === 1
      ? splitSegment.stem
      : null;
  };

  const compressStage4SingleRenyouNominal = (token) => {
    if (!token?.surface_form || !token?.basic_form) {
      return null;
    }

    const removableStemKanaReplacement = removeStage4RemovableStemKana(token);
    if (removableStemKanaReplacement !== null) {
      return removableStemKanaReplacement;
    }

    const splitSurface = splitTrailingKana(token.surface_form);
    if (!splitSurface.stem || !containsKanji(splitSurface.stem) || !splitSurface.okurigana) {
      return null;
    }

    return Array.from(splitSurface.okurigana).length === 1 && splitSurface.okurigana === "り"
      ? splitSurface.stem
      : null;
  };

  const compressStage4PrefixSegment = (segment) => {
    const splitSegment = splitTrailingKana(segment);
    if (!splitSegment.stem || !containsKanji(splitSegment.stem)) {
      return segment;
    }
    return splitSegment.stem;
  };

  const removeStage4RemovableStemKana = (token) => {
    if (!token?.surface_form || !token?.basic_form) {
      return null;
    }

    const surfaceSplit = splitTrailingKana(token.surface_form);
    const basicSplit = splitTrailingKana(token.basic_form);
    if (!surfaceSplit.stem || surfaceSplit.stem !== basicSplit.stem || !surfaceSplit.okurigana || !basicSplit.okurigana) {
      return null;
    }

    if (!startsWithStage4RemovableStemKana(surfaceSplit.okurigana) ||
        !startsWithStage4RemovableStemKana(basicSplit.okurigana)) {
      return null;
    }

    const nextOkurigana = Array.from(surfaceSplit.okurigana).slice(1).join("");
    if (!nextOkurigana) {
      return null;
    }

    return `${surfaceSplit.stem}${nextOkurigana}`;
  };

  const isStage4JiteException = (token, nextToken = null) => {
    const surface = `${token?.surface_form ?? ""}`;
    return surface.endsWith("じて") ||
      (surface.endsWith("じ") && `${nextToken?.surface_form ?? ""}` === "て");
  };

  const compressCompoundTokenSurface = (token, nextToken) => {
    const segments = splitKanjiKanaSegments(token.surface_form ?? "");
    if (segments.length <= 1) {
      return null;
    }

    const prefix = segments
      .slice(0, -1)
      .map((segment) => compressStage4PrefixSegment(segment))
      .join("");
    const finalSegment = segments[segments.length - 1];
    const nextIsMasu = isMasuAuxiliaryToken(nextToken);

    if (token.pos === "名詞") {
      const compressedFinal = compressStage4FinalRenyouSegment(finalSegment);
      return compressedFinal ? `${prefix}${compressedFinal}` : null;
    }

    if (isRenyouGeneralVerbToken(token) && !nextIsMasu) {
      const compressedFinal = compressStage4FinalRenyouSegment(finalSegment);
      return compressedFinal ? `${prefix}${compressedFinal}` : null;
    }

    if (isIchidanVerbToken(token)) {
      return `${prefix}${finalSegment}`;
    }

    if (isGodanVerbToken(token)) {
      const suffix = getStage4MinimalVerbSuffix(token, { compressRenyou: false });
      if (suffix === null || suffix === undefined) {
        return null;
      }

      const compressedFinal = replaceStage4GodanTrailingKana(finalSegment, suffix);
      return compressedFinal ? `${prefix}${compressedFinal}` : null;
    }

    return null;
  };

  const buildStage4Replacement = (tokens, index) => {
    const token = tokens[index];
    if (!token?.surface_form) {
      return null;
    }

    const nextToken = tokens[index + 1];
    if (isStage4JiteException(token, nextToken)) {
      return null;
    }

    if (isStage4NominalToken(token)) {
      const nominalCompoundReplacement = compressCompoundTokenSurface(token, nextToken);
      if (nominalCompoundReplacement && nominalCompoundReplacement !== token.surface_form) {
        return nominalCompoundReplacement;
      }
      const nominalRenyouReplacement = compressStage4SingleRenyouNominal(token);
      if (nominalRenyouReplacement && nominalRenyouReplacement !== token.surface_form) {
        return nominalRenyouReplacement;
      }
      return null;
    }

    if (!isVerbToken(token)) {
      return null;
    }

    if (!isIndependentVerbToken(token)) {
      return null;
    }

    const compoundReplacement = compressCompoundTokenSurface(token, nextToken);
    if (compoundReplacement && compoundReplacement !== token.surface_form) {
      return compoundReplacement;
    }

    const hasNextVerb = isVerbToken(nextToken);
    const isStandaloneRenyou = isRenyouGeneralVerbToken(token) && !hasNextVerb && !isMasuAuxiliaryToken(nextToken);

    if (isSahenVerbToken(token)) {
      if (!hasNonVerbKanjiPrefix(tokens, index)) {
        return null;
      }

      const sahenSuffix = getStage4MinimalVerbSuffix(token);
      if (!sahenSuffix) {
        return null;
      }
      if (sahenSuffix === "\u3059" && nextToken) {
        return null;
      }

      return replaceTrailingKanaWithSuffix(token.surface_form, sahenSuffix);
    }

    if (!hasKanjiWithTrailingKana(token.surface_form)) {
      return null;
    }

    const splitSurface = splitTrailingKana(token.surface_form);
    if (!splitSurface.okurigana) {
      return null;
    }

    const removableStemKanaReplacement = removeStage4RemovableStemKana(token);
    if (removableStemKanaReplacement && removableStemKanaReplacement !== token.surface_form) {
      return removableStemKanaReplacement;
    }

    if (isRenyouTaTeVerbToken(token)) {
      return null;
    }

    if (hasNextVerb) {
      if (!isRenyouGeneralVerbToken(token)) {
        return null;
      }

      return replaceTrailingKanaWithSuffix(token.surface_form, "");
    }

    if (isStandaloneRenyou) {
      return replaceTrailingKanaWithSuffix(token.surface_form, "");
    }

    if (isIchidanVerbToken(token)) {
      return null;
    }

    if (isGodanVerbToken(token)) {
      const suffix = getStage4MinimalVerbSuffix(token, { compressRenyou: false });
      if (suffix === null || suffix === undefined) {
        return null;
      }

      return replaceStage4GodanTrailingKana(token.surface_form, suffix);
    }

    return null;
  };

  const applyVerbOkuriganaStage4ToTokens = (text, tokens, debugCollector, stageId) => {
    const outputTokens = (Array.isArray(tokens) ? tokens : []).map((token) => ({ ...token }));
    emitDebugEvent(debugCollector, {
      phase: "tokenize",
      stageId,
      text,
      tokens: outputTokens.map(snapshotToken)
    });

    for (let index = 0; index < outputTokens.length; index += 1) {
      const token = outputTokens[index];
      if (!token?.surface_form) {
        continue;
      }

      const replacement = buildStage4Replacement(outputTokens, index);
      if (!replacement || replacement === token.surface_form) {
        continue;
      }

      emitDebugEvent(debugCollector, {
        phase: "stage4-verb",
        stageId,
        matchedText: token.surface_form,
        replacement,
        tokens: [snapshotToken(token)],
        prev: snapshotToken(outputTokens[index - 1]),
        next: snapshotToken(outputTokens[index + 1])
      });
      token.surface_form = replacement;
    }

    return joinTokenSurfaces(outputTokens);
  };

  const applyVerbOkuriganaStage4 = (text, tokenizer, debugCollector, stageId) => {
    if (!text || !text.trim() || !tokenizer) {
      return text;
    }

    return applyVerbOkuriganaStage4ToTokens(text, tokenizer.tokenize(text), debugCollector, stageId);
  };

  const KATAKANA_COMPOUND_START_CHARS = new Set(Array.from(
    "アイウエオ"
  ));

  const getKatakanaLongVowelMinLength = (settings) => {
    const value = Number(settings?.min_length ?? settings?.minLength ?? 1);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  };

  const isKatakanaCompoundBoundaryAfterLongVowel = (nextChar) => {
    return Boolean(nextChar && KATAKANA_COMPOUND_START_CHARS.has(nextChar));
  };

  const applyKatakanaLongVowelAbbreviationToRun = (run, exclusions, minLength, debugCollector, stageId) => {
    const chars = Array.from(`${run ?? ""}`);
    const output = [];
    let segmentStart = 0;

    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      if (char !== "ー") {
        output.push(char);
        continue;
      }

      const nextChar = chars[index + 1] ?? "";
      const isRunFinal = index === chars.length - 1;
      const isInternalBoundary = !isRunFinal && isKatakanaCompoundBoundaryAfterLongVowel(nextChar);
      const segment = chars.slice(segmentStart, index + 1).join("");
      if (
        (isRunFinal || isInternalBoundary) &&
        Array.from(segment).length >= minLength &&
        hasTrailingKatakanaLongVowel(segment) &&
        !exclusions.has(segment)
      ) {
        const replacement = segment.slice(0, -1);
        emitDebugEvent(debugCollector, {
          phase: "katakana-long-vowel",
          stageId,
          matchedText: segment,
          replacement
        });
        segmentStart = index + 1;
        continue;
      }

      output.push(char);
    }

    return output.join("");
  };

  const applyKatakanaLongVowelAbbreviation = (text, rules = [], debugCollector, stageId, settings = null) => {
    if (!text || !text.trim()) {
      return text;
    }

    const exclusions = new Set();
    for (const rule of Array.isArray(rules) ? rules : []) {
      for (const candidate of getRuleFromCandidates(rule)) {
        if (candidate) {
          exclusions.add(candidate);
        }
      }
    }
    const minLength = getKatakanaLongVowelMinLength(settings);

    return `${text}`.replace(/[\u30a1-\u30fa\u30fc]+/gu, (matchedText) => {
      return applyKatakanaLongVowelAbbreviationToRun(matchedText, exclusions, minLength, debugCollector, stageId);
    });
  };

  const isCrossStageExactConflictCandidate = (rule, candidate) => {
    if (!rule || rule.enabled === false || rule.regex === true || rule.character_map) {
      return false;
    }
    if (!candidate || candidate.includes("\\") || hasWildcard(candidate)) {
      return false;
    }
    if (Array.isArray(rule.sequence) && rule.sequence.length > 0) {
      return false;
    }
    const conditions = rule.conditions ?? {};
    return !conditions.prev && !conditions.current && !conditions.next;
  };

  const compareCrossStageConflictRecords = (left, right) => {
    return (Number(left.rule.priority) || 0) - (Number(right.rule.priority) || 0) ||
      (Number(left.stage.order) || 0) - (Number(right.stage.order) || 0) ||
      left.stageIndex - right.stageIndex ||
      left.ruleIndex - right.ruleIndex;
  };

  const resolveCrossStageExactRuleConflicts = (stages) => {
    const safeStages = Array.isArray(stages) ? stages : [];
    const cached = crossStageConflictCache.get(safeStages);
    if (cached) {
      return cached;
    }

    const recordsByCandidate = new Map();
    safeStages.forEach((stage, stageIndex) => {
      (Array.isArray(stage?.rules) ? stage.rules : []).forEach((rule, ruleIndex) => {
        for (const candidate of new Set(getPositiveRuleFromCandidates(rule))) {
          if (!isCrossStageExactConflictCandidate(rule, candidate)) {
            continue;
          }
          const records = recordsByCandidate.get(candidate) ?? [];
          records.push({ stage, stageIndex, rule, ruleIndex, candidate });
          recordsByCandidate.set(candidate, records);
        }
      });
    });

    const winners = new Map();
    for (const [candidate, records] of recordsByCandidate) {
      if (new Set(records.map((record) => record.stageIndex)).size < 2) {
        continue;
      }
      winners.set(candidate, records.reduce((best, current) => {
        return compareCrossStageConflictRecords(current, best) > 0 ? current : best;
      }));
    }
    if (winners.size === 0) {
      crossStageConflictCache.set(safeStages, safeStages);
      return safeStages;
    }

    const resolved = safeStages.map((stage, stageIndex) => {
      const rules = (Array.isArray(stage?.rules) ? stage.rules : []).map((rule, ruleIndex) => {
        const candidates = getPositiveRuleFromCandidates(rule);
        if (candidates.length === 0) {
          return rule;
        }
        const retained = candidates.filter((candidate) => {
          const winner = winners.get(candidate);
          return !winner || (winner.stageIndex === stageIndex && winner.ruleIndex === ruleIndex);
        });
        if (retained.length === candidates.length) {
          return rule;
        }
        if (retained.length === 0) {
          return { ...rule, enabled: false, from_options: [] };
        }
        return {
          ...rule,
          from: retained[0],
          from_options: retained
        };
      });
      return { ...stage, rules };
    });
    crossStageConflictCache.set(safeStages, resolved);
    return resolved;
  };

  const stageRequiresTokenizer = (stage) => {
    return stage?.kind === "token-rules" &&
      stage.runtime_mode !== "katakana-long-vowel-abbreviation" &&
      (
        (Array.isArray(stage.rules) && stage.rules.length > 0) ||
        (typeof stage.runtime_mode === "string" && stage.runtime_mode.trim() !== "")
      );
  };

  const compileRuntimePlan = (stages, options = {}) => {
    const compileStartedAt = getNow();
    const safeStages = Array.isArray(stages) ? stages : [];
    const revision = Number(options?.revision) || 0;
    const cacheable = options?.disableCache !== true;
    const maxTextCacheEntries = options?.maxTextCacheEntries ?? DEFAULT_TEXT_CACHE_ENTRIES;
    const maxTokenCacheEntries = options?.maxTokenCacheEntries ?? DEFAULT_TOKEN_CACHE_ENTRIES;
    const maxTextCacheLength = Number.isFinite(Number(options?.maxTextCacheLength))
      ? Math.max(0, Math.floor(Number(options.maxTextCacheLength)))
      : DEFAULT_TEXT_CACHE_MAX_LENGTH;
    const maxTokenCacheLength = Number.isFinite(Number(options?.maxTokenCacheLength))
      ? Math.max(0, Math.floor(Number(options.maxTokenCacheLength)))
      : DEFAULT_TOKEN_CACHE_MAX_LENGTH;
    const cacheKey = [
      revision,
      maxTextCacheEntries,
      maxTokenCacheEntries,
      maxTextCacheLength,
      maxTokenCacheLength,
      options?.planVersion ?? ""
    ].join(":");
    if (cacheable) {
      const cached = runtimePlanCache.get(safeStages);
      if (cached && cached.cacheKey === cacheKey) {
        return cached;
      }
    }

    const resolvedStages = resolveCrossStageExactRuleConflicts(safeStages);
    const planVersion = options?.planVersion ?? `runtime-plan-${nextRuntimePlanVersion++}`;
    const plan = {
      revision,
      planVersion,
      cacheKey,
      compileMs: 0,
      maxTextCacheLength,
      maxTokenCacheLength,
      stages: resolvedStages.map((stage) => {
        const requiresTokenizer = stageRequiresTokenizer(stage);
        return {
          ...stage,
          requiresTokenizer,
          compiledDictionary: stage.kind === "dictionary-rules"
            ? compileDictionaryStage(stage.rules)
            : null,
          compiledToken: stage.kind === "token-rules" && Array.isArray(stage.rules) && stage.rules.length > 0
            ? compileTokenStage(stage.rules)
            : null,
          triggerMetadata: stage.kind === "token-rules"
            ? buildTokenTriggerMetadata(stage.rules, stage.runtime_mode)
            : null
        };
      }),
      textTransformCache: createLruCache(maxTextCacheEntries),
      tokenizeCache: createLruCache(maxTokenCacheEntries)
    };
    plan.compileMs = getNow() - compileStartedAt;

    if (cacheable) {
      runtimePlanCache.set(safeStages, plan);
    }

    return plan;
  };

  const getTokenizeCacheKey = (text) => {
    return `${text ?? ""}`;
  };

  const getCachedTokens = (text, tokenizer, plan, metrics) => {
    if (!tokenizer) {
      return null;
    }

    const key = getTokenizeCacheKey(text);
    const cacheable = key.length <= (Number(plan?.maxTokenCacheLength) || 0);
    const cachedTokens = cacheable ? plan?.tokenizeCache?.get(key) : undefined;
    if (cachedTokens) {
      incrementMetric(metrics, "tokenCacheHits");
      return cachedTokens.map((token) => ({ ...token }));
    }

    incrementMetric(metrics, "tokenCacheMisses");
    incrementMetric(metrics, "tokenizeCalls");
    const tokens = tokenizer.tokenize(text);
    if (cacheable) {
      plan?.tokenizeCache?.set(key, tokens.map((token) => ({ ...token })));
    } else {
      incrementMetric(metrics, "tokenCacheBypasses");
    }
    return tokens;
  };

  const applyCompiledStageTransform = (text, stage, tokenizer, plan, debugCollector, metrics) => {
    if (stage.kind === "dictionary-rules") {
      const compiled = stage.compiledDictionary ?? compileDictionaryStage(stage.rules);
      const exactResult = applyCompiledDictionaryExactRules(text, compiled, debugCollector, stage.id, metrics);
      return applySlowDictionaryRules(exactResult, compiled.slowRules, debugCollector, stage.id, metrics);
    }

    if (stage.kind !== "token-rules") {
      return text;
    }

    if (stage.runtime_mode === "katakana-long-vowel-abbreviation") {
      return applyKatakanaLongVowelAbbreviation(text, stage.rules, debugCollector, stage.id, stage.settings);
    }

    if (!stage.requiresTokenizer) {
      return text;
    }

    if (!tokenizer) {
      return text;
    }

    if (!textMatchesTokenTriggers(text, stage.triggerMetadata)) {
      incrementMetric(metrics, "tokenizeSkipped");
      return text;
    }

    const tokens = getCachedTokens(text, tokenizer, plan, metrics);
    if (!tokens) {
      return text;
    }

    if (stage.runtime_mode === "verb-okurigana-stage4") {
      return applyVerbOkuriganaStage4ToTokens(text, tokens, debugCollector, stage.id);
    }

    return applyTokenRulesToTokens(text, tokens, stage.rules, debugCollector, stage.id);
  };

  const transformTextWithPlan = (text, plan, tokenizer, options = {}) => {
    if (!text || !text.trim()) {
      return text;
    }

    const debugCollector = typeof options === "function"
      ? options
      : options?.debugCollector;
    const metrics = typeof options === "object" && options
      ? options.metrics ?? null
      : null;
    const safePlan = plan && typeof plan === "object"
      ? plan
      : compileRuntimePlan(Array.isArray(plan?.stages) ? plan.stages : []);
    const processingStartedAt = getNow();
    if (metrics && !Number.isFinite(Number(metrics.compileMs))) {
      metrics.compileMs = Number(safePlan.compileMs) || 0;
    }
    const textCacheKey = `${safePlan.planVersion}::${text}`;
    const textCacheable = `${text ?? ""}`.length <= (Number(safePlan.maxTextCacheLength) || 0);
    const cachedResult = textCacheable
      ? safePlan.textTransformCache?.get(textCacheKey)
      : undefined;
    if (cachedResult !== undefined) {
      incrementMetric(metrics, "textCacheHits");
      incrementMetric(metrics, "processingMsTotal", getNow() - processingStartedAt);
      return cachedResult;
    }

    incrementMetric(metrics, "textCacheMisses");
    if (!textCacheable) {
      incrementMetric(metrics, "textCacheBypasses");
    }
    let transformedText = text;

    for (const stage of safePlan.stages) {
      if (!stage) {
        continue;
      }

      const hasTokenRules = Array.isArray(stage.rules) && stage.rules.length > 0;
      const hasRuntimeMode = typeof stage.runtime_mode === "string" && stage.runtime_mode.trim() !== "";
      if (!hasTokenRules && !hasRuntimeMode) {
        continue;
      }

      const beforeStage = transformedText;
      const startedAt = getNow();
      transformedText = canPreserveNarouRubyAnnotations(transformedText)
        ? applyCompiledStageTransformPreservingRuby(
          transformedText,
          stage,
          tokenizer,
          safePlan,
          debugCollector,
          metrics
        )
        : applyCompiledStageTransform(
          transformedText,
          stage,
          tokenizer,
          safePlan,
          debugCollector,
          metrics
        );
      addStageTiming(metrics, stage.id, getNow() - startedAt);
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

    if (textCacheable) {
      safePlan.textTransformCache?.set(textCacheKey, transformedText);
    }
    incrementMetric(metrics, "processingMsTotal", getNow() - processingStartedAt);
    return transformedText;
  };

  const transformTextWithStages = (text, stages, tokenizer, options = {}) => {
    const plan = compileRuntimePlan(stages, options);
    return transformTextWithPlan(text, plan, tokenizer, options);
  };

  const normalizeBundle = (bundle) => {
    return {
      id: bundle.id,
      label: bundle.label ?? bundle.id,
      kind: bundle.kind ?? null,
      path: bundle.path ?? null,
      runtime_mode: bundle.runtime_mode ?? null,
      order: bundle.order ?? 0,
      enabled: bundle.enabled !== false
    };
  };

  const buildVirtualBundleDefinition = (bundle) => {
    return {
      id: bundle.id,
      label: bundle.label,
      kind: bundle.kind ?? "dictionary-rules",
      runtime_mode: bundle.runtime_mode ?? null,
      enabled: bundle.enabled !== false,
      settings: bundle.settings && typeof bundle.settings === "object" && !Array.isArray(bundle.settings)
        ? { ...bundle.settings }
        : null,
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
      if (!rule.from || !rule.to) {
        return false;
      }
      return override.id === KATAKANA_LONG_VOWEL_BUNDLE_ID || rule.from !== rule.to;
    });

    return {
      id: normalizedRoot.id,
      label: normalizedRoot.label,
      kind: inferredKind,
      order: Number.isFinite(override.order) ? override.order : Number(override.order) || null,
      enabled: typeof override.enabled === "boolean" ? override.enabled : null,
      settings: normalizedRoot.settings && typeof normalizedRoot.settings === "object"
        ? { ...normalizedRoot.settings }
        : null,
      entries: normalizedRoot.entries,
      children: normalizedRoot.children
    };
  };

  const normalizeBundleOverridesPayload = (storedValue) => {
    const storedRoots = Array.isArray(storedValue?.roots) ? storedValue.roots : null;
    if (storedRoots) {
      const normalized = Object.fromEntries(
        storedRoots
          .filter((root) => root?.id)
          .map((root) => [root.id, normalizeStoredBundleOverride(root)])
          .filter(([, override]) => override)
      );
      Object.defineProperty(normalized, "__hasStoredRootsPayload", {
        value: true,
        enumerable: false
      });
      return normalized;
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
      runtime_mode: override.runtime_mode ?? bundle.runtime_mode,
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
      if (!node || node.enabled === false) {
        return rules;
      }
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
            from_options: entry.regex === true
              ? [`${entry.from ?? ""}`.trim()].filter(Boolean)
              : (Array.isArray(entry.from_options) ? [...entry.from_options] : splitMatchCandidates(entry.from)),
            to: entry.to,
            priority: entry.priority,
            enabled: entry.enabled !== false,
            regex: entry.regex === true,
            match_target: entry.match_target ?? baseRule.match_target ?? null,
            match_options: entry.match_options ?? baseRule.match_options ?? null,
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
      return {
        ...definition,
        kind: "token-rules",
        runtime_mode: override.runtime_mode ?? definition.runtime_mode,
        label: override.label ?? definition.label,
        enabled: override.enabled ?? definition.enabled,
        settings: override.settings ?? definition.settings ?? null,
        rules: flattenNodesToRules(override)
      };
    }

    return {
      ...definition,
      kind: "dictionary-rules",
      runtime_mode: override.runtime_mode ?? definition.runtime_mode,
      label: override.label ?? definition.label,
      enabled: override.enabled ?? definition.enabled,
      settings: override.settings ?? definition.settings ?? null,
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
    const storedRootsAreAuthoritative = overrides?.__hasStoredRootsPayload === true;
    const manifestRuntimeBundles = storedRootsAreAuthoritative
      ? manifestBundles.filter((bundle) => Object.prototype.hasOwnProperty.call(overrides, bundle.id))
      : manifestBundles;
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
    const bundles = [...manifestRuntimeBundles, ...virtualBundles]
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
      const runtimeMode = typeof definition.runtime_mode === "string" && definition.runtime_mode.trim()
        ? definition.runtime_mode.trim()
        : null;
      const dictionaryRules = definition.kind === "dictionary-rules"
        ? bundleRules.filter((rule) => !ruleRequiresTokenMatching(rule))
        : bundleRules.filter((rule) => rule?.regex === true);
      const tokenRules = definition.kind === "token-rules"
        ? bundleRules.filter((rule) => rule?.regex !== true)
        : bundleRules.filter((rule) => ruleRequiresTokenMatching(rule));

      if (dictionaryRules.length > 0) {
        stages.push({
          id: bundle.id,
          label: bundle.label,
          kind: "dictionary-rules",
          order: bundle.order ?? 0,
          runtime_mode: runtimeMode,
          settings: definition.settings ?? null,
          rules: dictionaryRules
        });
        stringRuleCount += dictionaryRules.length;
      }

      if (tokenRules.length > 0 || (definition.kind === "token-rules" && runtimeMode)) {
        stages.push({
          id: bundle.id,
          label: bundle.label,
          kind: "token-rules",
          order: bundle.order ?? 0,
          runtime_mode: runtimeMode,
          settings: definition.settings ?? null,
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
    compileRuntimePlan,
    loadStagesFromDefinitions,
    normalizeBundleOverridesPayload,
    resolveCrossStageExactRuleConflicts,
    splitCommaSeparatedValues,
    splitMatchCandidates,
    splitReplacementCandidates,
    tokenizeAndApplyTokenRules,
    transformTextWithPlan,
    transformTextWithStages
  };
});

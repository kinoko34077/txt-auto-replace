// content.js
// Manifest で lib/json5.min.js → lib/kuromoji.js → content.js の順に読み込む前提。
// そのため、このファイルでは import / script 注入 / top-level await を使わない。

(() => {
  "use strict";

  const DEBUG = false;
  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const BUNDLE_OVERRIDE_STORAGE_KEY = "bundleOverrideSettingsV1";
  const DICT_PATH = "dict/";
  const DEFAULT_POPUP_BUNDLE_ID = "popup-quick-replacements";
  const DEBUG_TARGETS_ATTRIBUTE = "data-jpn-transform-debug-targets";
  const DEBUG_LAST_ATTRIBUTE = "data-jpn-transform-last-debug";
  const DEBUG_HISTORY_ATTRIBUTE = "data-jpn-transform-debug-history";
  const DEBUG_RUNTIME_ATTRIBUTE = "data-jpn-transform-runtime-snapshot";
  const VISIBLE_ROOT_MARGIN_PX = 320;
  const VISIBLE_FLUSH_BUDGET_MS = 8;
  const BACKGROUND_FLUSH_BUDGET_MS = 16;
  const DEBUG_HISTORY_LIMIT = 20;
  const MESSAGE_TYPES = {
    APPLY_SETTINGS_UPDATE: "APPLY_SETTINGS_UPDATE",
    GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
    GET_TAB_RUNTIME_STATE: "GET_TAB_RUNTIME_STATE",
    GET_RUNTIME_DEBUG_SNAPSHOT: "GET_RUNTIME_DEBUG_SNAPSHOT"
  };
  const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
    skipEditableInputs: false,
    globalEnabled: true
  });
  const DEFAULT_DISABLED_SITES = Object.freeze({
    domains: []
  });
  const TransformEngine = globalThis.TransformEngine;
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "NOSCRIPT",
    "CODE",
    "PRE"
  ]);
  const INLINE_RUN_TAGS = new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BDO",
    "CITE",
    "DATA",
    "DEL",
    "DFN",
    "EM",
    "I",
    "INS",
    "KBD",
    "LABEL",
    "MARK",
    "Q",
    "RB",
    "RP",
    "RT",
    "RTC",
    "RUBY",
    "S",
    "SAMP",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
    "VAR",
    "WBR"
  ]);
  const DECORATION_BOUNDARY_TAGS = new Set([
    "A",
    "B",
    "EM",
    "I",
    "MARK",
    "S",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "U"
  ]);

  const originalTextByRunAnchor = new WeakMap();
  const processedTextByRunAnchor = new WeakMap();
  const processedRevisionByRunAnchor = new WeakMap();
  const pendingRootQueue = new Map();
  const composingEditableHosts = new WeakSet();
  const json5ResourcePromiseCache = new Map();

  let visibleFlushHandle = null;
  let visibleFlushHandleType = null;
  let backgroundFlushHandle = null;
  let backgroundFlushHandleType = null;
  let scrollRefreshScheduled = false;
  let activeTransformStages = [];
  let activeDictionaryOnlyStages = [];
  let activeTokenRules = [];
  let activeStringRules = [];
  let activeTokenizer = null;
  let activeRuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  let activeDisabledSites = { ...DEFAULT_DISABLED_SITES };
  let activePopupBundleId = DEFAULT_POPUP_BUNDLE_ID;
  let activeTabDisabled = false;
  let lastTransformDebug = null;
  let activeLoadedBundles = [];
  let activeManifestBundleIds = [];
  let cachedOrderedRuleResourcesPromise = null;
  let tokenizerPromise = null;
  let tokenizerWarmupRevision = 0;
  let runtimeRevision = 0;

  if (!TransformEngine) {
    throw new Error("TransformEngine が未読込です。manifest.json の content_scripts の順序を確認してください。");
  }

  const log = (...args) => {
    if (DEBUG) {
      console.log("省略変換器:", ...args);
    }
  };

  const readNodeValueSafely = (node) => {
    try {
      return typeof node?.nodeValue === "string" ? node.nodeValue : "";
    } catch (error) {
      return "";
    }
  };

  const publishTransformDebug = (payload) => {
    if (!hasDebugTargets()) {
      lastTransformDebug = null;
      globalThis.__jpnTransformLastDebug = null;
      globalThis.__jpnTransformDebugHistory = [];
      clearPublishedDebugState();
      return;
    }

    lastTransformDebug = payload;
    globalThis.__jpnTransformLastDebug = payload;
    const history = Array.isArray(globalThis.__jpnTransformDebugHistory)
      ? globalThis.__jpnTransformDebugHistory
      : [];
    history.push(payload);
    if (history.length > DEBUG_HISTORY_LIMIT) {
      history.splice(0, history.length - DEBUG_HISTORY_LIMIT);
    }
    globalThis.__jpnTransformDebugHistory = history;

    try {
      const root = document.documentElement;
      if (!root) {
        return;
      }

      root.setAttribute(DEBUG_LAST_ATTRIBUTE, JSON.stringify(payload));
      root.setAttribute(DEBUG_HISTORY_ATTRIBUTE, JSON.stringify(history));
    } catch (error) {
      console.error("transform debug publish failed", error);
    }

    publishRuntimeDebugSnapshot();
  };

  const cloneDebugValue = (value) => {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  };

  const normalizeDebugTargetList = (targets) => {
    if (!Array.isArray(targets)) {
      return [];
    }

    return [...new Set(
      targets
        .map((target) => `${target ?? ""}`.trim())
        .filter(Boolean)
    )];
  };

  const getDebugTargetsFromDocument = () => {
    try {
      const raw = document.documentElement?.getAttribute(DEBUG_TARGETS_ATTRIBUTE) ?? "";
      return raw
        .split(",")
        .map((target) => target.trim())
        .filter(Boolean);
    } catch (error) {
      return [];
    }
  };

  const hasDebugTargets = () => {
    return getDebugTargetsFromDocument().length > 0;
  };

  const clearPublishedDebugState = () => {
    try {
      const root = document.documentElement;
      if (!root) {
        return;
      }

      root.removeAttribute(DEBUG_LAST_ATTRIBUTE);
      root.removeAttribute(DEBUG_HISTORY_ATTRIBUTE);
      root.removeAttribute(DEBUG_RUNTIME_ATTRIBUTE);
    } catch (error) {
      console.error("runtime debug clear failed", error);
    }
  };

  const collectMatchingRuntimeRules = (targets) => {
    const targetSet = new Set(normalizeDebugTargetList(targets));
    if (targetSet.size === 0) {
      return [];
    }

    const matches = [];
    for (const stage of activeTransformStages) {
      const stageRules = Array.isArray(stage?.rules) ? stage.rules : [];
      for (const rule of stageRules) {
        if (!targetSet.has(`${rule?.from ?? ""}`.trim())) {
          continue;
        }

        const clonedRule = cloneDebugValue(rule);
        if (clonedRule && typeof clonedRule === "object") {
          delete clonedRule.raw;
        }
        matches.push({
          stageId: stage.id,
          stageLabel: stage.label,
          stageKind: stage.kind,
          stageOrder: stage.order ?? 0,
          rule: clonedRule
        });
      }
    }

    return matches;
  };

  const buildRuntimeDebugSnapshot = (targets) => {
    const manifestIdSet = new Set(activeManifestBundleIds);
    const loadedBundles = Array.isArray(activeLoadedBundles) ? activeLoadedBundles : [];
    const virtualBundleIds = loadedBundles
      .filter((bundle) => bundle?.id && !manifestIdSet.has(bundle.id))
      .map((bundle) => bundle.id);

    return {
      generatedAt: new Date().toISOString(),
      runtimeEnabled: isRuntimeEnabled(),
      popupBundleId: activePopupBundleId,
      tabDisabled: activeTabDisabled === true,
      runtimeSettings: cloneDebugValue(activeRuntimeSettings),
      disabledSites: cloneDebugValue(activeDisabledSites),
      manifestBundleIds: [...activeManifestBundleIds],
      loadedBundles: cloneDebugValue(activeLoadedBundles),
      virtualBundleIds,
      stages: activeTransformStages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        kind: stage.kind,
        order: stage.order ?? 0,
        ruleCount: Array.isArray(stage.rules) ? stage.rules.length : 0
      })),
      matchingRules: collectMatchingRuntimeRules(targets),
      lastTransformDebug: cloneDebugValue(lastTransformDebug)
    };
  };

  const publishRuntimeDebugSnapshot = (targets = getDebugTargetsFromDocument(), options = {}) => {
    const normalizedTargets = normalizeDebugTargetList(targets);
    const { force = false } = options;
    if (!force && normalizedTargets.length === 0) {
      clearPublishedDebugState();
      return null;
    }

    try {
      const root = document.documentElement;
      if (!root) {
        return null;
      }

      const snapshot = buildRuntimeDebugSnapshot(normalizedTargets);
      globalThis.__jpnTransformRuntimeSnapshot = snapshot;
      root.setAttribute(DEBUG_RUNTIME_ATTRIBUTE, JSON.stringify(snapshot));
      return snapshot;
    } catch (error) {
      console.error("runtime debug publish failed", error);
      return null;
    }
  };

  const describeNodeSafely = (node) => {
    try {
      return {
        nodeType: node?.nodeType,
        nodeName: node?.nodeName,
        parentTagName: node?.parentElement?.tagName ?? null,
        nodeValue: readNodeValueSafely(node)
      };
    } catch (error) {
      return {
        nodeType: null,
        nodeName: null,
        parentTagName: null,
        nodeValue: ""
      };
    }
  };

  const normalizeRuntimeSettings = (value) => {
    return {
      skipEditableInputs: value?.skipEditableInputs === true,
      globalEnabled: value?.globalEnabled !== false
    };
  };

  const normalizeDisabledSites = (value) => {
    const domains = Array.isArray(value?.domains)
      ? value.domains
          .map((domain) => `${domain ?? ""}`.trim().toLowerCase())
          .filter(Boolean)
      : [];

    return {
      domains: [...new Set(domains)]
    };
  };

  const getCurrentSelectionText = () => {
    try {
      return `${globalThis.getSelection?.()?.toString?.() ?? ""}`.trim();
    } catch (error) {
      return "";
    }
  };

  const isCurrentSiteDisabled = () => {
    const hostname = `${location.hostname ?? ""}`.trim().toLowerCase();
    if (!hostname) {
      return false;
    }

    return activeDisabledSites.domains.includes(hostname);
  };

  const isRuntimeEnabled = () => {
    return (
      activeRuntimeSettings.globalEnabled !== false &&
      !activeTabDisabled &&
      !isCurrentSiteDisabled()
    );
  };

  const sendRuntimeMessage = async (message) => {
    if (!chrome?.runtime?.sendMessage) {
      return null;
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(response ?? null);
      });
    });
  };

  const getEditableHost = (target) => {
    const element = target?.nodeType === Node.TEXT_NODE
      ? target.parentElement
      : target?.nodeType === Node.ELEMENT_NODE
        ? target
        : null;
    if (!element) {
      return null;
    }

    if (typeof element.closest === "function") {
      const closestEditable = element.closest("textarea, input, [contenteditable], [role='textbox']");
      if (closestEditable) {
        return closestEditable;
      }
    }

    return element.isContentEditable ? element : null;
  };

  const isEditableHostFocused = (host) => {
    if (!host) {
      return false;
    }

    const activeElement = document.activeElement;
    if (!activeElement) {
      return false;
    }

    return host === activeElement || (typeof host.contains === "function" && host.contains(activeElement));
  };

  const isEditableHostActive = (host) => {
    return isEditableHostFocused(host) || composingEditableHosts.has(host);
  };

  const shouldSkipEditableHost = (host) => {
    if (!host) {
      return false;
    }

    if (activeRuntimeSettings.skipEditableInputs) {
      return true;
    }

    return isEditableHostActive(host);
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
      location.href,
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
      return token.surface_form === rule.from ? replacementBase : replacementBase;
    }

    const fromStem = rule.from.slice(0, rule.from.length - sharedSuffix.length);
    const toStem = replacementBase.slice(0, replacementBase.length - sharedSuffix.length);
    if (!fromStem) {
      return replacementBase;
    }

    if (!token.surface_form.startsWith(fromStem)) {
      return token.surface_form === rule.from ? replacementBase : replacementBase;
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

  const applyVerbFallbackTransformations = (text, rules) => {
    let result = text;

    for (const rule of rules) {
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

    const { current, prev, next } = rule.conditions;

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

  const applyStringTransformations = (text, rules) => {
    let result = text;

    for (const rule of rules) {
      if (!rule || rule.enabled === false) {
        continue;
      }

      if (rule.regex === true) {
        try {
          const regex = new RegExp(rule.from, "gu");
          result = result.replace(regex, (matchedText) => chooseReplacement(rule, matchedText));
        } catch (error) {
          log("regex 置換失敗", { rule, error: error.message });
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

  const tokenLabel = (token) => {
    if (!token) {
      return null;
    }

    return {
      surface_form: token.surface_form,
      basic_form: token.basic_form,
      pos: token.pos,
      pos_detail_1: token.pos_detail_1,
      conjugated_form: token.conjugated_form,
      word_type: token.word_type
    };
  };

  const applyTransformations = (tokens, rules) => {
    const outputTokens = tokens.map((token) => ({ ...token }));

    for (let index = 0; index < outputTokens.length; index++) {
      const token = outputTokens[index];

      if (DEBUG && token.surface_form === "こと") {
        log("こと検出", {
          index,
          prev: tokenLabel(outputTokens[index - 1]),
          current: tokenLabel(token),
          next: tokenLabel(outputTokens[index + 1]),
          matchedRules: rules.filter((rule) => rule.from === "こと")
        });
      }

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

        if (DEBUG) {
          log("変換", {
            from: matchedText,
            matchedTokens,
            to: outputTokens[match.start].surface_form,
            rule,
            bundle: {
              id: rule.bundle_id,
              label: rule.bundle_label,
              order: rule.bundle_order
            },
            prev: tokenLabel(outputTokens[match.start - 1]),
            current: tokenLabel(outputTokens[match.start]),
            next: tokenLabel(outputTokens[match.start + match.length])
          });
        }

        index = match.start + match.length - 1;
        break;
      }
    }

    return outputTokens.map((token) => token.surface_form).join("");
  };

  const isSkippableTextNode = (node) => {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return true;
    }

    const parent = node.parentElement;
    if (!parent) {
      return true;
    }

    if (SKIP_TAGS.has(parent.tagName)) {
      return true;
    }

    const editableHost = getEditableHost(node);
    if (shouldSkipEditableHost(editableHost)) {
      return true;
    }

    const nodeValue = readNodeValueSafely(node);
    if (!nodeValue || !nodeValue.trim()) {
      return true;
    }

    return false;
  };

  const isRunBoundaryElement = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    if (SKIP_TAGS.has(element.tagName)) {
      return true;
    }

    if (
      DECORATION_BOUNDARY_TAGS.has(element.tagName) ||
      element.hasAttribute("style") ||
      element.hasAttribute("class")
    ) {
      return true;
    }

    if (INLINE_RUN_TAGS.has(element.tagName)) {
      return false;
    }

    const display = window.getComputedStyle(element).display;
    if (display === "contents") {
      return false;
    }

    return !display.startsWith("inline");
  };

  const collectProcessableTextRuns = (root) => {
    if (!root) {
      return [];
    }

    if (root.nodeType === Node.TEXT_NODE) {
      return isSkippableTextNode(root) ? [] : [[root]];
    }

    const runs = [];
    let currentRun = [];

    const flushRun = () => {
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    };

    const walk = (node, isRoot = false) => {
      if (!node) {
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        if (!isSkippableTextNode(node)) {
          currentRun.push(node);
        }
        return;
      }

      if (node.nodeType === Node.DOCUMENT_NODE) {
        walk(node.body, true);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(node.tagName)) {
        return;
      }

      const boundary = node.nodeType === Node.ELEMENT_NODE && !isRoot && isRunBoundaryElement(node);
      if (boundary) {
        flushRun();
      }

      for (const child of node.childNodes) {
        walk(child);
      }

      if (boundary) {
        flushRun();
      }
    };

    walk(root, true);
    flushRun();
    return runs;
  };

  const getRootAnchorElement = (root) => {
    if (!root) {
      return null;
    }

    if (root.nodeType === Node.TEXT_NODE) {
      return root.parentElement;
    }

    return root.nodeType === Node.ELEMENT_NODE ? root : null;
  };

  const isRootNearViewport = (root) => {
    const anchor = getRootAnchorElement(root);
    if (!anchor || typeof anchor.getBoundingClientRect !== "function") {
      return true;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;

    return (
      rect.bottom >= -VISIBLE_ROOT_MARGIN_PX &&
      rect.top <= viewportHeight + VISIBLE_ROOT_MARGIN_PX &&
      rect.right >= -VISIBLE_ROOT_MARGIN_PX &&
      rect.left <= viewportWidth + VISIBLE_ROOT_MARGIN_PX
    );
  };

  const collectProcessableRoots = (root) => {
    if (!root) {
      return [];
    }

    const roots = new Map();
    const boundaryCache = new WeakMap();

    const isBoundaryCached = (element) => {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      if (!boundaryCache.has(element)) {
        boundaryCache.set(element, isRunBoundaryElement(element));
      }

      return boundaryCache.get(element) === true;
    };

    const addRoot = (candidate) => {
      if (!candidate || !candidate.isConnected) {
        return;
      }

      roots.set(candidate, candidate);
    };

    const resolveRootForTextNode = (textNode) => {
      if (isSkippableTextNode(textNode)) {
        return null;
      }

      let current = textNode.parentElement;
      let fallback = textNode;
      while (current && current !== root && current !== document.body) {
        fallback = current;
        if (isBoundaryCached(current)) {
          return current;
        }
        current = current.parentElement;
      }

      if (root.nodeType === Node.ELEMENT_NODE && root !== document.body) {
        return root;
      }

      return fallback;
    };

    const walk = (node, isTopLevel = false) => {
      if (!node) {
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        addRoot(resolveRootForTextNode(node));
        return;
      }

      if (node.nodeType === Node.DOCUMENT_NODE) {
        walk(node.body, true);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        if (SKIP_TAGS.has(node.tagName)) {
          return;
        }

        const editableHost = getEditableHost(node);
        if (shouldSkipEditableHost(editableHost)) {
          return;
        }

        if (!isTopLevel && isBoundaryCached(node)) {
          addRoot(node);
          return;
        }
      }

      for (const child of node.childNodes) {
        walk(child);
      }
    };

    if (root.nodeType === Node.TEXT_NODE) {
      addRoot(resolveRootForTextNode(root));
      return [...roots.values()];
    }

    walk(root, true);
    return [...roots.values()];
  };

  const collectDocumentProcessingRoots = () => {
    const body = document.body;
    if (!body) {
      return [];
    }

    const roots = new Map();
    let hasDirectText = false;

    for (const child of body.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!isSkippableTextNode(child)) {
          hasDirectText = true;
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      if (SKIP_TAGS.has(child.tagName)) {
        continue;
      }

      const editableHost = getEditableHost(child);
      if (shouldSkipEditableHost(editableHost)) {
        continue;
      }
    }

    for (const root of collectProcessableRoots(body)) {
      roots.set(root, root);
    }
    if (hasDirectText) {
      roots.set(body, body);
    }

    return roots.size > 0 ? [...roots.values()] : [body];
  };

  const buildTokenizer = () => {
    return new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji が未読込です。manifest.json の content_scripts の順序を確認してください。"));
        return;
      }

      kuromoji.builder({
        dicPath: chrome.runtime.getURL(DICT_PATH)
      }).build((error, tokenizer) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(tokenizer);
      });
    });
  };

  const getTokenizer = async () => {
    if (!tokenizerPromise) {
      tokenizerPromise = buildTokenizer().catch((error) => {
        tokenizerPromise = null;
        throw error;
      });
    }

    return tokenizerPromise;
  };

  const loadJson5Resource = async (path) => {
    if (typeof JSON5 === "undefined") {
      throw new Error("JSON5 が未読込です。manifest.json の content_scripts の順序を確認してください。");
    }

    const url = chrome.runtime.getURL(path) + `?t=${Date.now()}`;
    const text = await fetch(url, { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error(`${path} 読込失敗: ${response.status}`);
      }

      return response.text();
    });

    log("JSON5 読込", { path, url });
    return JSON5.parse(text);
  };

  const loadCachedJson5Resource = async (path) => {
    if (!json5ResourcePromiseCache.has(path)) {
      const resourcePromise = fetch(chrome.runtime.getURL(path)).then(async (response) => {
        if (!response.ok) {
          throw new Error(`${path} 読込失敗: ${response.status}`);
        }

        const text = await response.text();
        log("JSON5 読込", { path, url: response.url });
        return JSON5.parse(text);
      }).catch((error) => {
        json5ResourcePromiseCache.delete(path);
        throw error;
      });

      json5ResourcePromiseCache.set(path, resourcePromise);
    }

    return json5ResourcePromiseCache.get(path);
  };

  const loadBundleOverrides = async () => {
    if (!chrome?.storage?.local) {
      return {};
    }

    const storedValue = await new Promise((resolve, reject) => {
      chrome.storage.local.get([BUNDLE_OVERRIDE_STORAGE_KEY], (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(result?.[BUNDLE_OVERRIDE_STORAGE_KEY] ?? null);
      });
    });

    return TransformEngine.normalizeBundleOverridesPayload(storedValue);
  };

  const loadStoredSettingsPayload = async () => {
    if (!chrome?.storage?.local) {
      return {};
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get([BUNDLE_OVERRIDE_STORAGE_KEY], (result) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          reject(runtimeError);
          return;
        }

        resolve(result?.[BUNDLE_OVERRIDE_STORAGE_KEY] ?? {});
      });
    });
  };

  const loadRuntimeConfiguration = async () => {
    const storedValue = await loadStoredSettingsPayload();

    return {
      runtimeSettings: normalizeRuntimeSettings(storedValue?.runtime_settings),
      disabledSites: normalizeDisabledSites(storedValue?.disabled_sites),
      popupBundleId: `${storedValue?.popup_bundle_id ?? DEFAULT_POPUP_BUNDLE_ID}`.trim() || DEFAULT_POPUP_BUNDLE_ID
    };
  };

  const loadTabRuntimeState = async () => {
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.GET_TAB_RUNTIME_STATE
      });
      return {
        tabDisabled: response?.tabDisabled === true
      };
    } catch (error) {
      return {
        tabDisabled: false
      };
    }
  };

  const transformText = (text) => {
    return transformTextWithStages(text);
  };

  const loadOrderedRuleResources = async () => {
    if (!cachedOrderedRuleResourcesPromise) {
      cachedOrderedRuleResourcesPromise = (async () => {
        const bundleManifest = await loadCachedJson5Resource(TRANSFORM_BUNDLES_PATH);
        const bundleFiles = {};
        const manifestBundleIds = Array.isArray(bundleManifest?.bundles)
          ? bundleManifest.bundles
              .filter((bundle) => bundle?.id)
              .map((bundle) => bundle.id)
          : [];

        await Promise.all((bundleManifest.bundles || []).map(async (bundle) => {
          if (!bundle?.id || !bundle?.path) {
            return;
          }

          bundleFiles[bundle.id] = await loadCachedJson5Resource(bundle.path);
        }));

        return {
          bundleManifest,
          bundleFiles,
          manifestBundleIds
        };
      })().catch((error) => {
        cachedOrderedRuleResourcesPromise = null;
        throw error;
      });
    }

    return cachedOrderedRuleResourcesPromise;
  };

  const loadOrderedRules = async () => {
    const { bundleManifest, bundleFiles, manifestBundleIds } = await loadOrderedRuleResources();
    const bundleOverrides = await loadBundleOverrides();

    const loaded = TransformEngine.loadStagesFromDefinitions(bundleManifest, bundleFiles, bundleOverrides);
    log("隱ｭ霎ｼ ordered bundles", loaded.bundles);
    log("隱ｭ霎ｼ transform stages", loaded.stages);
    return {
      ...loaded,
      manifestBundleIds
    };
  };

  const transformTextWithStages = (text) => {
    const effectiveStages = getEffectiveTransformStages();
    if (!DEBUG && !hasDebugTargets()) {
      return TransformEngine.transformTextWithStages(text, effectiveStages, activeTokenizer);
    }

    const events = [];
    const transformed = TransformEngine.transformTextWithStages(
      text,
      effectiveStages,
      activeTokenizer,
      (event) => events.push(event)
    );
    publishTransformDebug({
      timestamp: new Date().toISOString(),
      sourceText: text,
      transformedText: transformed,
      events,
      stages: effectiveStages.map((stage) => ({
        id: stage.id,
        kind: stage.kind,
        ruleCount: Array.isArray(stage.rules) ? stage.rules.length : 0
      }))
    });
    return transformed;
  };

  const redistributeTransformedText = (textNodes, originalParts, transformed) => {
    let cursor = 0;

    for (let index = 0; index < textNodes.length; index += 1) {
      const originalLength = originalParts[index].length;
      const nextLength = index === textNodes.length - 1
        ? Math.max(transformed.length - cursor, 0)
        : Math.min(originalLength, Math.max(transformed.length - cursor, 0));
      const nextValue = transformed.slice(cursor, cursor + nextLength);
      textNodes[index].nodeValue = nextValue;
      cursor += nextLength;
    }
  };

  const restoreTextRun = (textRun) => {
    if (!Array.isArray(textRun) || textRun.length === 0) {
      return false;
    }

    const textNodes = textRun.filter((node) => node?.isConnected);
    if (textNodes.length === 0) {
      return false;
    }

    const runAnchor = textNodes[0];
    const original = originalTextByRunAnchor.get(runAnchor);
    if (typeof original !== "string") {
      return false;
    }

    const currentParts = textNodes.map((node) => readNodeValueSafely(node));
    const current = currentParts.join("");
    if (current === original) {
      processedTextByRunAnchor.delete(runAnchor);
      processedRevisionByRunAnchor.delete(runAnchor);
      return false;
    }

    redistributeTransformedText(textNodes, currentParts, original);
    processedTextByRunAnchor.delete(runAnchor);
    processedRevisionByRunAnchor.delete(runAnchor);
    return true;
  };

  const restoreDocumentRuns = (root) => {
    for (const run of collectProcessableTextRuns(root)) {
      restoreTextRun(run);
    }
  };

  const processTextRun = (textRun) => {
    if (!Array.isArray(textRun) || textRun.length === 0) {
      return false;
    }

    const textNodes = textRun.filter((node) => {
      return node?.isConnected && !isSkippableTextNode(node);
    });
    if (textNodes.length === 0) {
      return false;
    }

    const currentParts = textNodes.map((node) => readNodeValueSafely(node));
    const current = currentParts.join("");
    if (!current || !current.trim()) {
      return false;
    }

    const runAnchor = textNodes[0];
    const lastProcessed = processedTextByRunAnchor.get(runAnchor);
    if (processedRevisionByRunAnchor.get(runAnchor) === runtimeRevision && current === lastProcessed) {
      return false;
    }
    const storedOriginal = originalTextByRunAnchor.get(runAnchor);
    const sourceText = lastProcessed !== undefined && current === lastProcessed && typeof storedOriginal === "string"
      ? storedOriginal
      : current;
    originalTextByRunAnchor.set(runAnchor, sourceText);

    const transformed = transformTextWithStages(sourceText);
    processedTextByRunAnchor.set(runAnchor, transformed);
    processedRevisionByRunAnchor.set(runAnchor, runtimeRevision);

    if (transformed === current) {
      return false;
    }

    redistributeTransformedText(textNodes, currentParts, transformed);

    if (DEBUG) {
      log("textRun 更新", {
        original: sourceText,
        transformed,
        nodeCount: textNodes.length,
        debugEvents: Array.isArray(lastTransformDebug?.events) ? lastTransformDebug.events : []
      });
    }

    return true;
  };

  const hasAnyActiveRules = () => {
    return activeTransformStages.some((stage) => {
      return (Array.isArray(stage.rules) && stage.rules.length > 0) ||
        (typeof stage.runtime_mode === "string" && stage.runtime_mode.trim() !== "");
    });
  };

  const runtimeRequiresTokenizer = () => {
    return activeTransformStages.some((stage) => {
      return stage.kind === "token-rules" &&
        stage.runtime_mode !== "katakana-long-vowel-abbreviation" &&
        (
          (Array.isArray(stage.rules) && stage.rules.length > 0) ||
          (typeof stage.runtime_mode === "string" && stage.runtime_mode.trim() !== "")
        );
    });
  };

  const getEffectiveTransformStages = () => {
    if (activeTokenizer || !runtimeRequiresTokenizer()) {
      return activeTransformStages;
    }

    return activeDictionaryOnlyStages;
  };

  const cancelVisibleRootFlush = () => {
    if (visibleFlushHandle === null) {
      return;
    }

    if (visibleFlushHandleType === "raf" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(visibleFlushHandle);
    } else {
      window.clearTimeout(visibleFlushHandle);
    }

    visibleFlushHandle = null;
    visibleFlushHandleType = null;
  };

  const cancelBackgroundRootFlush = () => {
    if (backgroundFlushHandle === null) {
      return;
    }

    if (backgroundFlushHandleType === "idle" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(backgroundFlushHandle);
    } else {
      window.clearTimeout(backgroundFlushHandle);
    }

    backgroundFlushHandle = null;
    backgroundFlushHandleType = null;
  };

  const cancelRootFlushes = () => {
    cancelVisibleRootFlush();
    cancelBackgroundRootFlush();
  };

  const reclassifyPendingRoots = () => {
    for (const [root, entry] of pendingRootQueue) {
      entry.priority = isRootNearViewport(root) ? 0 : 1;
    }
  };

  const hasPendingRoots = (priority = null) => {
    if (priority === null) {
      return pendingRootQueue.size > 0;
    }

    for (const entry of pendingRootQueue.values()) {
      if (entry.priority === priority) {
        return true;
      }
    }

    return false;
  };

  const hasDirectProcessableText = (root) => {
    if (!root || !root.childNodes) {
      return false;
    }
    for (const child of root.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && !isSkippableTextNode(child)) {
        return true;
      }
    }
    return false;
  };

  const processTextRoot = (root, options = {}) => {
    const restoreFirst = options.restoreFirst === true;
    let changedCount = 0;
    const processedNodes = new Set();

    for (const queuedRun of collectProcessableTextRuns(root)) {
      const textRun = queuedRun.filter((node) => {
        return node?.isConnected && !isSkippableTextNode(node);
      });
      if (textRun.length === 0) {
        continue;
      }

      if (textRun.some((node) => processedNodes.has(node))) {
        continue;
      }

      if (restoreFirst) {
        restoreTextRun(textRun);
      }

      if (processTextRun(textRun)) {
        changedCount++;
      }

      for (const node of textRun) {
        processedNodes.add(node);
      }
    }

    return changedCount;
  };

  const processQueuedRootBatch = ({ includeBackground = false, budgetMs = VISIBLE_FLUSH_BUDGET_MS } = {}) => {
    if (!isRuntimeEnabled()) {
      pendingRootQueue.clear();
      cancelRootFlushes();
      return;
    }

    if (!hasAnyActiveRules() || pendingRootQueue.size === 0) {
      pendingRootQueue.clear();
      return;
    }

    reclassifyPendingRoots();

    const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
    let changedCount = 0;

    for (const [root, entry] of pendingRootQueue) {
      if (!includeBackground && entry.priority > 0) {
        continue;
      }

      pendingRootQueue.delete(root);
      const subRoots = root?.nodeType === Node.ELEMENT_NODE && !hasDirectProcessableText(root)
        ? collectProcessableRoots(root)
        : [];
      if (subRoots.length > 1) {
        queueProcessableRoots(subRoots, {
          priority: entry.priority > 0 ? "background" : "visible",
          restoreFirst: entry.restoreFirst === true
        });
        continue;
      }

      changedCount += processTextRoot(root, { restoreFirst: entry.restoreFirst === true });

      if (performance.now() >= deadline) {
        break;
      }
    }

    if (changedCount > 0) {
      log("更新 root 数", changedCount);
    }

    if (hasPendingRoots(0)) {
      scheduleVisibleRootFlush();
    } else if (hasPendingRoots()) {
      scheduleBackgroundRootFlush();
    }
  };

  function scheduleVisibleRootFlush() {
    if (visibleFlushHandle !== null || !hasPendingRoots(0)) {
      return;
    }

    const runFlush = () => {
      visibleFlushHandle = null;
      visibleFlushHandleType = null;
      processQueuedRootBatch({ includeBackground: false, budgetMs: VISIBLE_FLUSH_BUDGET_MS });
    };

    if (typeof window.requestAnimationFrame === "function") {
      visibleFlushHandleType = "raf";
      visibleFlushHandle = window.requestAnimationFrame(runFlush);
      return;
    }

    visibleFlushHandleType = "timeout";
    visibleFlushHandle = window.setTimeout(runFlush, 0);
  }

  function scheduleBackgroundRootFlush() {
    if (backgroundFlushHandle !== null || hasPendingRoots(0) || !hasPendingRoots()) {
      return;
    }

    const runFlush = () => {
      backgroundFlushHandle = null;
      backgroundFlushHandleType = null;
      processQueuedRootBatch({ includeBackground: true, budgetMs: BACKGROUND_FLUSH_BUDGET_MS });
    };

    if (typeof window.requestIdleCallback === "function") {
      backgroundFlushHandleType = "idle";
      backgroundFlushHandle = window.requestIdleCallback(runFlush, { timeout: 250 });
      return;
    }

    backgroundFlushHandleType = "timeout";
    backgroundFlushHandle = window.setTimeout(runFlush, 32);
  }

  const queueProcessableRoots = (roots, options = {}) => {
    const { immediate = false, priority = "auto", restoreFirst = false } = options;

    if (!isRuntimeEnabled()) {
      return;
    }

    for (const root of roots) {
      if (!root || !root.isConnected) {
        continue;
      }

      const nextPriority = priority === "visible"
        ? 0
        : priority === "background"
          ? 1
          : isRootNearViewport(root)
            ? 0
            : 1;
      const existing = pendingRootQueue.get(root);
      if (!existing || nextPriority < existing.priority) {
        pendingRootQueue.set(root, { priority: nextPriority, restoreFirst: restoreFirst === true });
      } else if (restoreFirst === true) {
        existing.restoreFirst = true;
      }
    }

    if (immediate) {
      cancelRootFlushes();
      processQueuedRootBatch({ includeBackground: true, budgetMs: Infinity });
      return;
    }

    if (hasPendingRoots(0)) {
      scheduleVisibleRootFlush();
    } else if (hasPendingRoots()) {
      scheduleBackgroundRootFlush();
    }
  };

  const queueEditableHostRuns = (host, options = {}) => {
    if (!host || !host.isConnected || activeRuntimeSettings.skipEditableInputs || !isRuntimeEnabled()) {
      return;
    }

    const roots = collectProcessableRoots(host);
    if (roots.length > 0) {
      queueProcessableRoots(roots, { ...options, priority: "visible" });
    }
  };

  const bindEditableLifecycle = () => {
    document.addEventListener("compositionstart", (event) => {
      const host = getEditableHost(event.target);
      if (!host) {
        return;
      }

      composingEditableHosts.add(host);
    }, true);

    document.addEventListener("compositionend", (event) => {
      const host = getEditableHost(event.target);
      if (!host) {
        return;
      }

      composingEditableHosts.delete(host);
      window.setTimeout(() => {
        queueEditableHostRuns(host, { immediate: true });
      }, 0);
    }, true);

    document.addEventListener("focusout", (event) => {
      const host = getEditableHost(event.target);
      if (!host) {
        return;
      }

      window.setTimeout(() => {
        if (!host.isConnected || isEditableHostFocused(host) || composingEditableHosts.has(host)) {
          return;
        }

        queueEditableHostRuns(host, { immediate: true });
      }, 0);
    }, true);
  };

  const observeDynamicContent = () => {
    const observer = new MutationObserver((mutations) => {
      if (!isRuntimeEnabled()) {
        return;
      }

      const queuedRoots = [];

      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          queuedRoots.push(...collectProcessableRoots(mutation.target));
          continue;
        }

        for (const addedNode of mutation.addedNodes) {
          queuedRoots.push(...collectProcessableRoots(addedNode));
        }
      }

      if (queuedRoots.length > 0) {
        queueProcessableRoots(queuedRoots);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    log("MutationObserver 開始");
  };

  const bindViewportRefresh = () => {
    const requestRefresh = () => {
      if (scrollRefreshScheduled || !isRuntimeEnabled()) {
        return;
      }

      scrollRefreshScheduled = true;
      const runRefresh = () => {
        scrollRefreshScheduled = false;
        reclassifyPendingRoots();
        if (hasPendingRoots(0)) {
          scheduleVisibleRootFlush();
        }
      };

      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(runRefresh);
      } else {
        window.setTimeout(runRefresh, 0);
      }
    };

    window.addEventListener("scroll", requestRefresh, { passive: true });
    window.addEventListener("resize", requestRefresh, { passive: true });
  };

  const observeDebugTargetChanges = () => {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === DEBUG_TARGETS_ATTRIBUTE) {
          const targets = getDebugTargetsFromDocument();
          if (targets.length > 0) {
            publishRuntimeDebugSnapshot(targets, { force: true });
          } else {
            clearPublishedDebugState();
          }
          return;
        }
      }
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: [DEBUG_TARGETS_ATTRIBUTE]
    });
  };

  const refreshRuntimeState = async (options = {}) => {
    const { reapply = true } = options;
    const [runtimeConfiguration, loaded, tabState] = await Promise.all([
      loadRuntimeConfiguration(),
      loadOrderedRules(),
      loadTabRuntimeState()
    ]);
    activeRuntimeSettings = runtimeConfiguration.runtimeSettings;
    activeDisabledSites = runtimeConfiguration.disabledSites;
    activePopupBundleId = runtimeConfiguration.popupBundleId;
    activeLoadedBundles = Array.isArray(loaded?.bundles) ? loaded.bundles.map((bundle) => ({
      id: bundle.id,
      label: bundle.label,
      kind: bundle.kind,
      order: bundle.order ?? 0,
      enabled: bundle.enabled !== false,
      path: bundle.path ?? null
    })) : [];
    activeManifestBundleIds = loaded?.manifestBundleIds ?? [];
    activeTransformStages = loaded.stages;
    activeDictionaryOnlyStages = activeTransformStages.filter((stage) => stage.kind === "dictionary-rules");
    activeStringRules = activeTransformStages
      .filter((stage) => stage.kind === "dictionary-rules")
      .flatMap((stage) => stage.rules);
    activeTokenRules = activeTransformStages
      .filter((stage) => stage.kind === "token-rules")
      .flatMap((stage) => stage.rules);
    activeTabDisabled = tabState.tabDisabled === true;
    const tokenizerRevision = ++tokenizerWarmupRevision;
    activeTokenizer = null;
    if (activeTokenRules.length > 0) {
      getTokenizer().then((tokenizer) => {
        if (tokenizerRevision !== tokenizerWarmupRevision) {
          return;
        }

        activeTokenizer = tokenizer;
        publishRuntimeDebugSnapshot(getDebugTargetsFromDocument());
        if (isRuntimeEnabled()) {
          runtimeRevision += 1;
          pendingRootQueue.clear();
          cancelRootFlushes();
          queueProcessableRoots(collectDocumentProcessingRoots(), { priority: "visible", restoreFirst: true });
        }
      }).catch((error) => {
        if (tokenizerRevision !== tokenizerWarmupRevision) {
          return;
        }

        console.error("tokenizer warmup failed", error);
      });
    }
    publishRuntimeDebugSnapshot(getDebugTargetsFromDocument());

    if (!reapply) {
      return;
    }

    if (!isRuntimeEnabled()) {
      pendingRootQueue.clear();
      cancelRootFlushes();
      restoreDocumentRuns(document.body);
      return;
    }

    pendingRootQueue.clear();
    cancelRootFlushes();
    runtimeRevision += 1;
    queueProcessableRoots(collectDocumentProcessingRoots(), { restoreFirst: true });
  };

  const handleRuntimeMessage = (message, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_PAGE_CONTEXT) {
      sendResponse({
        ok: true,
        url: location.href,
        hostname: location.hostname,
        selectionText: getCurrentSelectionText(),
        globalEnabled: activeRuntimeSettings.globalEnabled !== false,
        siteDisabled: isCurrentSiteDisabled(),
        tabDisabled: activeTabDisabled === true,
        effectiveEnabled: isRuntimeEnabled(),
        popupBundleId: activePopupBundleId
      });
      return false;
    }

    if (message.type === MESSAGE_TYPES.APPLY_SETTINGS_UPDATE) {
      sendResponse({ ok: true });
      refreshRuntimeState({ reapply: true }).catch((error) => {
        console.error("runtime refresh failed", error);
      });
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_RUNTIME_DEBUG_SNAPSHOT) {
      sendResponse({
        ok: true,
        snapshot: buildRuntimeDebugSnapshot(message.targets)
      });
      return false;
    }

    return false;
  };

  const bindRuntimeSynchronization = () => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes[BUNDLE_OVERRIDE_STORAGE_KEY]) {
          return;
        }

        refreshRuntimeState({ reapply: true }).catch((error) => {
          console.error("runtime refresh failed", error);
        });
      });
    }

    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        return handleRuntimeMessage(message, sendResponse);
      });
    }
  };

  const initialize = async () => {
    if (!document.body) {
      throw new Error("document.body が利用できません。");
    }

    await refreshRuntimeState({ reapply: false });
    bindRuntimeSynchronization();
    bindEditableLifecycle();
    bindViewportRefresh();
    observeDebugTargetChanges();
    const initialRoots = collectDocumentProcessingRoots();
    log("対象 root 数", initialRoots.length);
    runtimeRevision += 1;
    queueProcessableRoots(initialRoots);
    observeDynamicContent();
  };

  initialize()
    .then(() => {
      log("変換初期化完了", {
        stringRules: activeStringRules.length,
        tokenRules: activeTokenRules.length
      });
    })
    .catch((error) => {
      console.error("省略変換器: 初期化失敗", error);
    });
})();

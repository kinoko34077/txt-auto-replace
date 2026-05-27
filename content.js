// content.js
// Manifest で lib/json5.min.js → lib/kuromoji.js → content.js の順に読み込む前提。
// そのため、このファイルでは import / script 注入 / top-level await を使わない。

(() => {
  "use strict";

  const DEBUG = true;
  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const BUNDLE_OVERRIDE_STORAGE_KEY = "bundleOverrideSettingsV1";
  const DICT_PATH = "dict/";
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

  const processedTextByNode = new WeakMap();
  const pendingTextNodes = new Set();

  let flushTimer = null;
  let activeTokenRules = [];
  let activeStringRules = [];
  let activeTokenizer = null;

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

      const entryType = `${entry.type ?? "replace-rule"}`;
      if (entryType === "phrase-rule" || entryType === "character-map" || entryType === "replace-rule") {
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
          type: "replace-rule",
          from,
          to,
          raw: { ...entry },
          candidates: splitReplacementCandidates(entry.candidates ?? to),
          regex: entry.regex === true || entry.is_regex === true,
          priority: Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || fallbackPriority,
          enabled: entry.enabled !== false
        });
      }
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
    if (!token || token.surface_form !== rule.from) {
      return false;
    }

    return true;
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
        outputTokens[match.start].surface_form = match.replacement ?? chooseReplacement(rule, matchedText);

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

    const nodeValue = readNodeValueSafely(node);
    if (!nodeValue || !nodeValue.trim()) {
      return true;
    }

    return false;
  };

  const collectProcessableTextNodes = (root) => {
    if (!root) {
      return [];
    }

    if (root.nodeType === Node.TEXT_NODE) {
      return isSkippableTextNode(root) ? [] : [root];
    }

    const body = root.nodeType === Node.DOCUMENT_NODE ? root.body : root;
    if (!body) {
      return [];
    }

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];

    let currentNode;
    while ((currentNode = walker.nextNode())) {
      if (!isSkippableTextNode(currentNode)) {
        nodes.push(currentNode);
      }
    }

    return nodes;
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

  const normalizeStoredRule = (rule) => {
    return normalizePhraseRuleRecord(rule?.from ?? "", rule);
  };

  const normalizeStoredBundleOverride = (override) => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return null;
    }

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
      kind: typeof override.kind === "string" ? override.kind : normalizedRoot.kind,
      order: Number.isFinite(override.order) ? override.order : Number(override.order) || null,
      enabled: typeof override.enabled === "boolean" ? override.enabled : null,
      entries: normalizedRoot.entries,
      children: normalizedRoot.children
    };
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
                regex: entry.regex === true
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

    if (!definition || definition.kind !== "token-rules") {
      throw new Error(`未対応のバンドル種別です: ${bundle.id}`);
    }
  };

  const loadRules = async () => {
    const bundleManifest = await loadJson5Resource(TRANSFORM_BUNDLES_PATH);
    const bundleOverrides = await loadBundleOverrides();
    const manifestBundles = (bundleManifest.bundles || []).map(normalizeBundle);
    const manifestBundleIds = new Set(manifestBundles.map((bundle) => bundle.id));
    const virtualBundles = Object.values(bundleOverrides)
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
      .map((bundle) => applyBundleOverrideToManifest(bundle, bundleOverrides[bundle.id]))
      .filter((bundle) => bundle.enabled)
      .sort((left, right) => {
        return (left.order ?? 0) - (right.order ?? 0);
      });

    const stringRules = [];
    const tokenRules = [];

    for (const bundle of bundles) {
      const definition = mergeBundleDefinition(
        bundle.path ? await loadJson5Resource(bundle.path) : buildVirtualBundleDefinition(bundleOverrides[bundle.id]),
        bundleOverrides[bundle.id]
      );
      const bundleRules = extractBundleRules(bundle, definition);
      if (definition.kind === "dictionary-rules") {
        stringRules.push(...bundleRules);
      } else {
        tokenRules.push(...bundleRules);
      }
    }

    log("読込バンドル", bundles);
    log("読込 string rules", stringRules);
    log("読込 token rules", tokenRules);

    return { stringRules, tokenRules };
  };

  const transformText = (text) => {
    if (!text || !text.trim()) {
      return text;
    }

    const stringTransformed = applyStringTransformations(text, activeStringRules);
    if (!activeTokenizer || activeTokenRules.length === 0) {
      return stringTransformed;
    }

    const tokens = activeTokenizer.tokenize(stringTransformed);
    return applyTransformations(tokens, activeTokenRules);
  };

  const processTextNode = (textNode) => {
    if (isSkippableTextNode(textNode)) {
      return false;
    }

    const original = readNodeValueSafely(textNode);
    if (!original) {
      return false;
    }

    const transformed = transformText(original);
    processedTextByNode.set(textNode, transformed);

    if (transformed === original) {
      return false;
    }

    textNode.nodeValue = transformed;

    if (DEBUG) {
      log("textNode 更新", { original, transformed });
    }

    return true;
  };

  const flushPendingTextNodes = () => {
    flushTimer = null;

    if ((!activeTokenizer && activeTokenRules.length > 0) || (activeStringRules.length === 0 && activeTokenRules.length === 0) || pendingTextNodes.size === 0) {
      pendingTextNodes.clear();
      return;
    }

    let changedCount = 0;

    for (const textNode of pendingTextNodes) {
      pendingTextNodes.delete(textNode);

      try {
        const lastProcessed = processedTextByNode.get(textNode);
        if (lastProcessed !== undefined && lastProcessed === textNode.nodeValue) {
          continue;
        }

        if (processTextNode(textNode)) {
          changedCount++;
        }
      } catch (error) {
        console.error("省略変換器: 変換失敗", error, describeNodeSafely(textNode));
      }
    }

    if (changedCount > 0) {
      log("更新 textNode 数", changedCount);
    }
  };

  const queueTextNodes = (nodes, options = {}) => {
    const { immediate = false } = options;

    for (const node of nodes) {
      pendingTextNodes.add(node);
    }

    if (immediate) {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }

      flushPendingTextNodes();
      return;
    }

    if (flushTimer !== null) {
      return;
    }

    flushTimer = window.setTimeout(flushPendingTextNodes, 0);
  };

  const observeDynamicContent = () => {
    const observer = new MutationObserver((mutations) => {
      const queuedNodes = [];

      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          queuedNodes.push(...collectProcessableTextNodes(mutation.target));
          continue;
        }

        for (const addedNode of mutation.addedNodes) {
          queuedNodes.push(...collectProcessableTextNodes(addedNode));
        }
      }

      if (queuedNodes.length > 0) {
        queueTextNodes(queuedNodes);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    log("MutationObserver 開始");
  };

  const initialize = async () => {
    if (!document.body) {
      throw new Error("document.body が利用できません。");
    }

    const loaded = await loadRules();
    activeStringRules = loaded.stringRules;
    activeTokenRules = loaded.tokenRules;
    activeTokenizer = activeTokenRules.length > 0 ? await buildTokenizer() : null;

    const initialNodes = collectProcessableTextNodes(document.body);
    log("対象 textNode 数", initialNodes.length);
    queueTextNodes(initialNodes, { immediate: true });
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

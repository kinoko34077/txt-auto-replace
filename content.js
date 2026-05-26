// content.js
// Manifest で lib/json5.min.js → lib/kuromoji.js → content.js の順に読み込む前提。
// そのため、このファイルでは import / script 注入 / top-level await を使わない。

(() => {
  "use strict";

  const DEBUG = true;
  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
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
  let activeRules = [];
  let activeTokenizer = null;

  const log = (...args) => {
    if (DEBUG) {
      console.log("省略変換器:", ...args);
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

  const normalizeRule = (rule) => {
    const conditions = rule.conditions || {};

    return {
      ...rule,
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

        outputTokens[match.start].surface_form = rule.to;

        for (let offset = 1; offset < match.length; offset++) {
          outputTokens[match.start + offset].surface_form = "";
        }

        if (DEBUG) {
          log("変換", {
            from: matchedTokens.join(""),
            matchedTokens,
            to: rule.to,
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

    if (!node.nodeValue || !node.nodeValue.trim()) {
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
      path: bundle.path,
      order: bundle.order ?? 0,
      enabled: bundle.enabled !== false
    };
  };

  const extractBundleRules = (bundle, definition) => {
    if (!definition || definition.kind !== "token-rules") {
      throw new Error(`未対応のバンドル種別です: ${bundle.id}`);
    }

    const rules = Array.isArray(definition.rules) ? definition.rules : [];

    return rules
      .filter((rule) => rule && rule.enabled !== false)
      .map((rule) => withBundleMetadata(rule, bundle))
      .sort((left, right) => {
        return (right.priority || 0) - (left.priority || 0);
      });
  };

  const loadRules = async () => {
    const bundleManifest = await loadJson5Resource(TRANSFORM_BUNDLES_PATH);
    const bundles = (bundleManifest.bundles || [])
      .map(normalizeBundle)
      .filter((bundle) => bundle.enabled)
      .sort((left, right) => {
        return (left.order ?? 0) - (right.order ?? 0);
      });

    const rules = [];

    for (const bundle of bundles) {
      const definition = await loadJson5Resource(bundle.path);
      const bundleRules = extractBundleRules(bundle, definition);
      rules.push(...bundleRules);
    }

    log("読込バンドル", bundles);
    log("読込 rules", rules);

    return rules;
  };

  const transformText = (text) => {
    if (!text || !text.trim()) {
      return text;
    }

    const tokens = activeTokenizer.tokenize(text);
    return applyTransformations(tokens, activeRules);
  };

  const processTextNode = (textNode) => {
    if (isSkippableTextNode(textNode)) {
      return false;
    }

    const original = textNode.nodeValue;
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

    if (!activeTokenizer || !activeRules.length || pendingTextNodes.size === 0) {
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
        console.error("省略変換器: 変換失敗", error, textNode.nodeValue);
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

    [activeRules, activeTokenizer] = await Promise.all([loadRules(), buildTokenizer()]);

    const initialNodes = collectProcessableTextNodes(document.body);
    log("対象 textNode 数", initialNodes.length);
    queueTextNodes(initialNodes, { immediate: true });
    observeDynamicContent();
  };

  initialize()
    .then(() => {
      log("変換初期化完了", { rules: activeRules.length });
    })
    .catch((error) => {
      console.error("省略変換器: 初期化失敗", error);
    });
})();

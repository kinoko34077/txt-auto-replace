// content.js
// Manifestで lib/json5.min.js → lib/kuromoji.js → content.js の順に読み込む前提。
// そのため、このファイルでは import / script注入 / top-level await を使わない。

(() => {
  "use strict";

  const DEBUG = true;

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

  const log = (...args) => {
    if (DEBUG) console.log("省略変換器:", ...args);
  };

  const warn = (...args) => {
    if (DEBUG) console.warn("省略変換器:", ...args);
  };

  const isSkippableTextNode = (node) => {
    const parent = node.parentElement;
    if (!parent) return true;
    if (SKIP_TAGS.has(parent.tagName)) return true;
    if (!node.nodeValue || !node.nodeValue.trim()) return true;
    return false;
  };

  const buildTokenizer = () => {
    return new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji が未読込です。manifest.json の content_scripts の順序を確認してください。"));
        return;
      }

      kuromoji.builder({
        dicPath: chrome.runtime.getURL("dict/")
      }).build((err, tokenizer) => {
        if (err) reject(err);
        else resolve(tokenizer);
      });
    });
  };

  const loadRules = async () => {
    if (typeof JSON5 === "undefined") {
      throw new Error("JSON5 が未読込です。manifest.json の content_scripts の順序を確認してください。");
    }

    const url = chrome.runtime.getURL("rules.json5") + `?t=${Date.now()}`;

    const text = await fetch(url, {
      cache: "no-store"
    }).then(r => {
      if (!r.ok) throw new Error(`rules.json5 読込失敗: ${r.status}`);
      return r.text();
    });

    const rules = JSON5.parse(text);

    const sortedRules = [...rules]
      .filter(rule => rule && rule.enabled !== false)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    console.log("省略変換器: rules.json5 URL", url);
    console.log("省略変換器: 読込rules", sortedRules);

    return sortedRules;
  };

  const normalizeCondition = (condition) => {
    if (!condition || typeof condition !== "object") return condition;

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
      word_type: condition.word_type,
    };
  };

  const valueMatches = (actual, expected) => {
    if (expected === undefined || expected === null) return true;
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  };

  const tokenMatchesCondition = (token, condition) => {
    if (!token || !condition) return false;

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

    const cond = normalizeCondition(condition);

    return (
      valueMatches(token.surface_form, cond.surface_form) &&
      valueMatches(token.basic_form, cond.basic_form) &&
      valueMatches(token.pos, cond.pos) &&
      valueMatches(token.pos_detail_1, cond.pos_detail_1) &&
      valueMatches(token.pos_detail_2, cond.pos_detail_2) &&
      valueMatches(token.pos_detail_3, cond.pos_detail_3) &&
      valueMatches(token.conjugated_type, cond.conjugated_type) &&
      valueMatches(token.conjugated_form, cond.conjugated_form) &&
      valueMatches(token.reading, cond.reading) &&
      valueMatches(token.pronunciation, cond.pronunciation) &&
      valueMatches(token.word_type, cond.word_type)
    );
  };

  const anyConditionMatches = (token, conditionList) => {
    if (!Array.isArray(conditionList)) {
      return tokenMatchesCondition(token, conditionList);
    }
    return conditionList.some(cond => tokenMatchesCondition(token, cond));
  };

  const ruleMatches = (tokens, i, rule) => {
    const token = tokens[i];
    if (!token) return false;

    // 現段階では形態素トークン単位の完全一致。
    // これにより「ことば」等の語中部分は rule.from === "こと" に一致しない。
    if (token.surface_form !== rule.from) return false;

    const conditions = rule.conditions || {};

    if (conditions.current) {
      if (!anyConditionMatches(token, conditions.current)) return false;
    }

    if (conditions.prev) {
      const prev = tokens[i - 1];
      if (!anyConditionMatches(prev, conditions.prev)) return false;
    }

    if (conditions.next) {
      const next = tokens[i + 1];
      if (!anyConditionMatches(next, conditions.next)) return false;
    }

    return true;
  };

  const tokenLabel = (token) => {
    if (!token) return null;
    return {
      surface_form: token.surface_form,
      basic_form: token.basic_form,
      pos: token.pos,
      pos_detail_1: token.pos_detail_1,
      conjugated_form: token.conjugated_form,
      word_type: token.word_type,
    };
  };

  const applyTransformations = (tokens, rules) => {
    const out = tokens.map(t => ({ ...t }));

    for (let i = 0; i < out.length; i++) {
      const token = out[i];

      if (DEBUG && token.surface_form === "こと") {
        log("こと検出", {
          index: i,
          prev: tokenLabel(out[i - 1]),
          current: tokenLabel(token),
          next: tokenLabel(out[i + 1]),
          matchedRules: rules.filter(rule => rule.from === "こと"),
        });
      }

      for (const rule of rules) {
        if (!ruleMatches(out, i, rule)) continue;

        const before = out[i].surface_form;
        out[i].surface_form = rule.to;

        if (DEBUG) {
          log("変換", {
            from: before,
            to: rule.to,
            rule,
            prev: tokenLabel(out[i - 1]),
            current: tokenLabel(out[i]),
            next: tokenLabel(out[i + 1]),
          });
        }

        break;
      }
    }

    return out.map(t => t.surface_form).join("");
  };

  const walkAndRewrite = async (rules, tokenizer) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];

    let node;
    while ((node = walker.nextNode())) {
      if (!isSkippableTextNode(node)) nodes.push(node);
    }

    log("対象textNode数", nodes.length);

    let changedCount = 0;

    for (const textNode of nodes) {
      try {
        const original = textNode.nodeValue;
        const tokens = tokenizer.tokenize(original);
        const transformed = applyTransformations(tokens, rules);

        if (transformed !== original) {
          textNode.nodeValue = transformed;
          changedCount++;

          if (DEBUG) {
            log("textNode更新", { original, transformed });
          }
        }
      } catch (e) {
        console.error("省略変換器: 変換失敗", e, textNode.nodeValue);
      }
    }

    log("更新textNode数", changedCount);
  };

  (async () => {
    try {
      const [rules, tokenizer] = await Promise.all([loadRules(), buildTokenizer()]);
      await walkAndRewrite(rules, tokenizer);
      log("変換完了", { rules: rules.length });
    } catch (e) {
      console.error("省略変換器: 初期化失敗", e);
    }
  })();
})();
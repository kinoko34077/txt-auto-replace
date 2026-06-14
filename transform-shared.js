(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.TransformShared = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ESCAPE_SENTINEL = "\u0000";

  const unescapeCandidateText = (value) => {
    if (typeof value !== "string") {
      return `${value ?? ""}`;
    }

    return value
      .replaceAll(`${ESCAPE_SENTINEL}[`, "[")
      .replaceAll(`${ESCAPE_SENTINEL}]`, "]")
      .replaceAll(`${ESCAPE_SENTINEL},`, ",")
      .replaceAll(`${ESCAPE_SENTINEL}*`, "\\*")
      .replaceAll(`${ESCAPE_SENTINEL}-`, "\\-")
      .replaceAll(`${ESCAPE_SENTINEL}\\`, "\\");
  };

  const tokenizeEscapes = (value) => {
    if (typeof value !== "string") {
      return `${value ?? ""}`;
    }

    let output = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === "\\" && index + 1 < value.length) {
        const next = value[index + 1];
        if (next === "[" || next === "]" || next === "," || next === "*" || next === "-" || next === "\\") {
          output += `${ESCAPE_SENTINEL}${next}`;
          index += 1;
          continue;
        }
      }
      output += char;
    }
    return output;
  };

  const splitTopLevelCommaCandidates = (value) => {
    const text = tokenizeEscapes(`${value ?? ""}`);
    const parts = [];
    let current = "";
    let bracketDepth = 0;

    for (const char of text) {
      if (char === "[" && !current.endsWith(ESCAPE_SENTINEL)) {
        bracketDepth += 1;
        current += char;
        continue;
      }
      if (char === "]" && !current.endsWith(ESCAPE_SENTINEL)) {
        bracketDepth = Math.max(0, bracketDepth - 1);
        current += char;
        continue;
      }
      if (char === "," && bracketDepth === 0 && current[current.length - 1] !== ESCAPE_SENTINEL) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }

    if (current || text.endsWith(",")) {
      parts.push(current.trim());
    }

    return parts
      .map((entry) => entry.trim())
      .filter(Boolean);
  };

  const expandBracketAlternatives = (value) => {
    const text = tokenizeEscapes(`${value ?? ""}`.trim());
    if (!text) {
      return [""];
    }

    let openIndex = -1;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "[" && text[index - 1] !== ESCAPE_SENTINEL) {
        openIndex = index;
        break;
      }
    }
    if (openIndex < 0) {
      return [text];
    }

    let depth = 0;
    let closeIndex = -1;
    for (let index = openIndex; index < text.length; index += 1) {
      const char = text[index];
      if (char === "[" && text[index - 1] !== ESCAPE_SENTINEL) {
        depth += 1;
      } else if (char === "]" && text[index - 1] !== ESCAPE_SENTINEL) {
        depth -= 1;
        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }

    if (closeIndex < 0) {
      return [text];
    }

    const prefix = text.slice(0, openIndex);
    const inner = text.slice(openIndex + 1, closeIndex);
    const suffix = text.slice(closeIndex + 1);
    const branches = splitTopLevelCommaCandidates(inner);
    if (branches.length === 0) {
      return [text];
    }

    const variants = [];
    for (const branch of branches) {
      const nested = expandBracketAlternatives(`${prefix}${branch}${suffix}`);
      for (const candidate of nested) {
        variants.push(candidate);
      }
    }

    return variants;
  };

  const splitCommaSeparatedValues = (value) => {
    if (Array.isArray(value)) {
      return value
        .flatMap((entry) => splitCommaSeparatedValues(entry))
        .filter(Boolean);
    }

    if (typeof value !== "string") {
      return [];
    }

    return splitTopLevelCommaCandidates(value)
      .flatMap((entry) => expandBracketAlternatives(entry))
      .map((entry) => unescapeCandidateText(`${entry ?? ""}`.trim()))
      .filter(Boolean);
  };

  const splitDelimitedRow = (line, delimiter = ",") => {
    const source = tokenizeEscapes(`${line ?? ""}`);
    const separator = typeof delimiter === "string" && delimiter.length > 0
      ? delimiter
      : ",";
    const cells = [];
    let current = "";
    let quoted = false;
    let bracketDepth = 0;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === "\"") {
        if (quoted && source[index + 1] === "\"") {
          current += "\"";
          index += 1;
          continue;
        }
        quoted = !quoted;
        continue;
      }
      if (!quoted) {
        if (char === "[" && source[index - 1] !== ESCAPE_SENTINEL) {
          bracketDepth += 1;
        } else if (char === "]" && source[index - 1] !== ESCAPE_SENTINEL) {
          bracketDepth = Math.max(0, bracketDepth - 1);
        }
      }
      if (
        !quoted &&
        bracketDepth === 0 &&
        source.slice(index, index + separator.length) === separator
      ) {
        cells.push(unescapeCandidateText(current.trim()));
        current = "";
        index += separator.length - 1;
        continue;
      }
      current += char;
    }

    cells.push(unescapeCandidateText(current.trim()));
    return cells;
  };

  const splitReplacementCandidates = (value) => splitCommaSeparatedValues(value);
  const splitMatchCandidates = (value) => splitCommaSeparatedValues(value);

  const normalizeReplacementCandidates = (value, isRegex = false, fallbackValue = "") => {
    const fallback = `${fallbackValue ?? value ?? ""}`.trim();
    if (isRegex) {
      return fallback ? [fallback] : [];
    }
    const candidates = splitReplacementCandidates(value);
    if (candidates.length > 0) {
      return candidates;
    }
    return fallback ? [fallback] : [];
  };

  const expandRegexReplacementTemplate = (
    template,
    matchedText,
    captures = [],
    groups = null,
    sourceText = "",
    offset = 0
  ) => {
    return `${template ?? ""}`.replace(/\$(\$|&|`|'|<([A-Za-z][A-Za-z0-9_]*)>|[0-9]{1,2})/g, (...args) => {
      const token = args[0];
      const marker = args[1];
      const groupName = args[2];
      if (marker === "$") {
        return "$";
      }
      if (marker === "&") {
        return matchedText;
      }
      if (marker === "`") {
        return `${sourceText ?? ""}`.slice(0, offset);
      }
      if (marker === "'") {
        return `${sourceText ?? ""}`.slice(offset + matchedText.length);
      }
      if (groupName) {
        return groups && Object.prototype.hasOwnProperty.call(groups, groupName)
          ? `${groups[groupName] ?? ""}`
          : "";
      }
      const groupIndex = Number(marker);
      if (Number.isFinite(groupIndex) && groupIndex > 0 && groupIndex <= captures.length) {
        return `${captures[groupIndex - 1] ?? ""}`;
      }
      if (marker.length === 2) {
        const firstDigitIndex = Number(marker[0]);
        if (firstDigitIndex > 0 && firstDigitIndex <= captures.length) {
          return `${captures[firstDigitIndex - 1] ?? ""}${marker[1]}`;
        }
      }
      return token;
    });
  };

  const isNegativeMatchCandidate = (value) => {
    const text = `${value ?? ""}`;
    return text.startsWith("-") && !text.startsWith("\\-");
  };

  const normalizeMatcherCandidateLiteral = (value) => {
    const text = `${value ?? ""}`;
    return text.startsWith("\\-") ? text.slice(1) : text;
  };

  const splitPositiveNegativeCandidates = (value) => {
    const positive = [];
    const negative = [];
    for (const candidate of splitMatchCandidates(value)) {
      if (isNegativeMatchCandidate(candidate)) {
        const normalized = normalizeMatcherCandidateLiteral(candidate.slice(1).trim());
        if (normalized) {
          negative.push(normalized);
        }
      } else {
        const normalized = normalizeMatcherCandidateLiteral(candidate);
        if (normalized) {
          positive.push(normalized);
        }
      }
    }
    return { positive, negative };
  };

  const katakanaToHiragana = (value) => {
    return Array.from(`${value ?? ""}`).map((char) => {
      const codePoint = char.codePointAt(0);
      if (codePoint >= 0x30a1 && codePoint <= 0x30f6) {
        return String.fromCodePoint(codePoint - 0x60);
      }
      return char;
    }).join("");
  };

  const normalizeKanaForMatch = (value) => katakanaToHiragana(value);

  const decodeEscapedLiteral = (value) => {
    const source = tokenizeEscapes(`${value ?? ""}`);
    let output = "";

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === ESCAPE_SENTINEL && index + 1 < source.length) {
        output += source[index + 1];
        index += 1;
        continue;
      }
      output += char;
    }

    return output;
  };

  const hasWildcard = (value) => {
    const text = tokenizeEscapes(`${value ?? ""}`);
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "*" && text[index - 1] !== ESCAPE_SENTINEL) {
        return true;
      }
    }
    return false;
  };

  const escapeRegex = (value) => {
    return `${value ?? ""}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const compileWildcardPattern = (pattern, options = {}) => {
    const source = tokenizeEscapes(`${pattern ?? ""}`);
    const anchored = options.anchored !== false;
    let regexSource = anchored ? "^" : "";
    let captureCount = 0;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === ESCAPE_SENTINEL && index + 1 < source.length) {
        regexSource += escapeRegex(source[index + 1]);
        index += 1;
        continue;
      }
      if (char === "*") {
        regexSource += "(.*?)";
        captureCount += 1;
        continue;
      }
      regexSource += escapeRegex(char);
    }

    if (anchored) {
      regexSource += "$";
    }

    const flags = options.flags ?? "u";
    return {
      pattern: `${pattern ?? ""}`,
      captureCount,
      regex: new RegExp(regexSource, flags)
    };
  };

  const matchWildcardPattern = (value, pattern, options = {}) => {
    const sourceValue = `${value ?? ""}`;
    const sourcePattern = `${pattern ?? ""}`;
    const normalizedValue = options.kanaInsensitive
      ? normalizeKanaForMatch(sourceValue)
      : sourceValue;
    const normalizedPattern = options.kanaInsensitive
      ? normalizeKanaForMatch(sourcePattern)
      : sourcePattern;

    if (!hasWildcard(pattern)) {
      const literalPattern = decodeEscapedLiteral(normalizedPattern);
      return normalizedValue === literalPattern
        ? { matched: true, captures: [], pattern: literalPattern }
        : null;
    }

    const compiled = compileWildcardPattern(normalizedPattern, {
      flags: options.preserveCaptures ? "du" : "u"
    });
    const match = normalizedValue.match(compiled.regex);
    if (!match) {
      return null;
    }

    const captures = options.preserveCaptures && match.indices
      ? match.indices.slice(1).map((range) => {
        if (!range) {
          return "";
        }
        return sourceValue.slice(range[0], range[1]);
      })
      : match.slice(1);

    return {
      matched: true,
      captures,
      pattern
    };
  };

  const applyWildcardReplacement = (template, captures = []) => {
    const source = tokenizeEscapes(`${template ?? ""}`);
    let output = "";
    let captureIndex = 0;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === ESCAPE_SENTINEL && index + 1 < source.length) {
        output += source[index + 1];
        index += 1;
        continue;
      }
      if (char === "*") {
        output += `${captures[captureIndex] ?? ""}`;
        captureIndex += 1;
        continue;
      }
      output += char;
    }

    return output;
  };

  const replaceWildcardPattern = (text, pattern, replacement, options = {}) => {
    const sourceText = `${text ?? ""}`;
    const sourcePattern = `${pattern ?? ""}`;
    const normalizedText = options.kanaInsensitive
      ? normalizeKanaForMatch(sourceText)
      : sourceText;
    const normalizedPattern = options.kanaInsensitive
      ? normalizeKanaForMatch(sourcePattern)
      : sourcePattern;

    if (!hasWildcard(sourcePattern)) {
      const literalReplacement = applyWildcardReplacement(replacement, []);
      const literalPattern = decodeEscapedLiteral(normalizedPattern);
      if (!options.kanaInsensitive) {
        return sourceText.split(literalPattern).join(literalReplacement);
      }

      let output = "";
      let cursor = 0;
      let matchIndex = normalizedText.indexOf(literalPattern);
      while (matchIndex >= 0) {
        output += sourceText.slice(cursor, matchIndex);
        output += literalReplacement;
        cursor = matchIndex + literalPattern.length;
        matchIndex = normalizedText.indexOf(literalPattern, cursor);
      }
      return output + sourceText.slice(cursor);
    }

    const compiled = compileWildcardPattern(normalizedPattern, { anchored: false, flags: "gdu" });
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
      output += sourceText.slice(cursor, range[0]);
      output += applyWildcardReplacement(replacement, captures);
      cursor = range[1];
      if (range[0] === range[1]) {
        cursor += 1;
      }
    }
    return output + sourceText.slice(cursor);
  };

  const normalizePhraseRuleRecord = (from, rawRule) => {
    const isArrayRegexRule = Array.isArray(rawRule) && rawRule[3] === true;
    const fromCandidates = isArrayRegexRule
      ? [`${from ?? ""}`.trim()].filter(Boolean)
      : splitMatchCandidates(from);

    if (typeof rawRule === "string") {
      const candidates = normalizeReplacementCandidates(rawRule, false, rawRule);
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
      const candidates = normalizeReplacementCandidates(rawRule[0], isArrayRegexRule, rawRule[0]);
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
      const isRegexRule = rawRule.regex === true || rawRule.is_regex === true;
      const candidates = normalizeReplacementCandidates(rawRule.candidates ?? rawRule.to, isRegexRule, rawRule.to);
      const ruleFromCandidates = isRegexRule
        ? [`${rawRule.from ?? from ?? ""}`.trim()].filter(Boolean)
        : splitMatchCandidates(rawRule.from ?? from ?? "");
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

  const mapConditionFields = (condition) => {
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
      word_type: condition.word_type,
      sequence: Array.isArray(condition.sequence) ? condition.sequence.map(mapConditionFields) : condition.sequence
    };
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
      if (!from || !to) {
        continue;
      }

      const isRegexRule = entry.regex === true || entry.is_regex === true;
      const fromOptions = isRegexRule
        ? [from]
        : splitMatchCandidates(entry.from_options ?? entry.from ?? from);

      replaceRules.push({
        id: `${entry.id ?? ""}`.trim() || undefined,
        type: `${entry.type ?? "replace-rule"}`,
        from: fromOptions[0] ?? from,
        from_options: fromOptions,
        to,
        raw: { ...entry },
        candidates: normalizeReplacementCandidates(entry.candidates ?? to, isRegexRule, to),
        regex: entry.regex === true || entry.is_regex === true,
        priority: Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || fallbackPriority,
        enabled: entry.enabled !== false,
        match_target: entry.match_target ?? entry.matchTarget ?? null,
        match_options: entry.match_options && typeof entry.match_options === "object"
          ? { ...entry.match_options }
          : null,
        conditions: entry.conditions ?? null,
        sequence: Array.isArray(entry.sequence) ? entry.sequence.map(mapConditionFields) : (entry.sequence ?? null),
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
      settings: node?.settings && typeof node.settings === "object" && !Array.isArray(node.settings)
        ? { ...node.settings }
        : null,
      entries: directEntries.length > 0 ? directEntries : (directRules.length > 0 ? directRules : legacyEntries),
      children: childSource.map((child, index) => {
        return normalizeDictionaryNode(child, `${fallbackId}-${index + 1}`, `${fallbackLabel} ${index + 1}`);
      })
    };
  };

  const HIRAGANA_START = 0x3040;
  const HIRAGANA_END = 0x309f;
  const KATAKANA_START = 0x30a0;
  const KATAKANA_END = 0x30ff;
  const KATAKANA_PHONETIC_START = 0x31f0;
  const KATAKANA_PHONETIC_END = 0x31ff;
  const HALF_KATAKANA_START = 0xff66;
  const HALF_KATAKANA_END = 0xff9d;
  const CJK_START = 0x4e00;
  const CJK_END = 0x9fff;
  const CJK_EXT_A_START = 0x3400;
  const CJK_EXT_A_END = 0x4dbf;
  const KANJI_ITERATION = new Set(["々", "〆", "〇", "ヶ"]);

  const GODAN_STAGE4_SUFFIXES = {
    "う": { basic: "う", mizen: "わ", renyou: "い", katei: "え", meirei: "え", volitional: "おう" },
    "く": { basic: "く", mizen: "か", renyou: "き", katei: "け", meirei: "け", volitional: "こう" },
    "ぐ": { basic: "ぐ", mizen: "が", renyou: "ぎ", katei: "げ", meirei: "げ", volitional: "ごう" },
    "す": { basic: "す", mizen: "さ", renyou: "し", katei: "せ", meirei: "せ", volitional: "そう" },
    "つ": { basic: "つ", mizen: "た", renyou: "ち", katei: "て", meirei: "て", volitional: "とう" },
    "ぬ": { basic: "ぬ", mizen: "な", renyou: "に", katei: "ね", meirei: "ね", volitional: "のう" },
    "ぶ": { basic: "ぶ", mizen: "ば", renyou: "び", katei: "べ", meirei: "べ", volitional: "ぼう" },
    "む": { basic: "む", mizen: "ま", renyou: "み", katei: "め", meirei: "め", volitional: "もう" },
    "る": { basic: "る", mizen: "ら", renyou: "り", katei: "れ", meirei: "れ", volitional: "ろう" }
  };

  const getCodePoint = (char) => {
    return typeof char === "string" && char.length > 0
      ? char.codePointAt(0)
      : null;
  };

  const isHiraganaChar = (char) => {
    const codePoint = getCodePoint(char);
    return codePoint !== null && codePoint >= HIRAGANA_START && codePoint <= HIRAGANA_END;
  };

  const isKatakanaChar = (char) => {
    const codePoint = getCodePoint(char);
    if (codePoint === null) {
      return false;
    }

    return (
      (codePoint >= KATAKANA_START && codePoint <= KATAKANA_END) ||
      (codePoint >= KATAKANA_PHONETIC_START && codePoint <= KATAKANA_PHONETIC_END) ||
      (codePoint >= HALF_KATAKANA_START && codePoint <= HALF_KATAKANA_END)
    );
  };

  const isKanaChar = (char) => {
    return isHiraganaChar(char) || isKatakanaChar(char);
  };

  const isKanjiChar = (char) => {
    if (KANJI_ITERATION.has(char)) {
      return true;
    }

    const codePoint = getCodePoint(char);
    if (codePoint === null) {
      return false;
    }

    return (
      (codePoint >= CJK_START && codePoint <= CJK_END) ||
      (codePoint >= CJK_EXT_A_START && codePoint <= CJK_EXT_A_END)
    );
  };

  const containsKanji = (value) => {
    return Array.from(`${value ?? ""}`).some((char) => isKanjiChar(char));
  };

  const containsKana = (value) => {
    return Array.from(`${value ?? ""}`).some((char) => isKanaChar(char));
  };

  const splitTrailingKana = (value) => {
    const text = `${value ?? ""}`;
    const characters = Array.from(text);
    let splitIndex = characters.length;

    while (splitIndex > 0 && isKanaChar(characters[splitIndex - 1])) {
      splitIndex -= 1;
    }

    return {
      stem: characters.slice(0, splitIndex).join(""),
      okurigana: characters.slice(splitIndex).join("")
    };
  };

  const hasKanjiWithTrailingKana = (value) => {
    const { stem, okurigana } = splitTrailingKana(value);
    return Boolean(okurigana) && containsKanji(stem);
  };

  const splitKanjiKanaSegments = (value) => {
    const characters = Array.from(`${value ?? ""}`);
    if (characters.length === 0) {
      return [];
    }

    const segments = [];
    let current = characters[0];

    for (let index = 1; index < characters.length; index += 1) {
      const previousChar = characters[index - 1];
      const currentChar = characters[index];
      const startsNewSegment = isKanjiChar(currentChar) && isKanaChar(previousChar);

      if (startsNewSegment) {
        segments.push(current);
        current = currentChar;
        continue;
      }

      current += currentChar;
    }

    if (current) {
      segments.push(current);
    }

    return segments;
  };

  const isKatakanaOnlyText = (value) => {
    const characters = Array.from(`${value ?? ""}`);
    return characters.length > 0 && characters.every((char) => isKatakanaChar(char) || char === "ー");
  };

  const hasTrailingKatakanaLongVowel = (value) => {
    const text = `${value ?? ""}`;
    return text.endsWith("ー") && isKatakanaOnlyText(text);
  };

  const isVerbToken = (token) => {
    return token?.pos === "動詞";
  };

  const isSahenVerbToken = (token) => {
    if (!isVerbToken(token)) {
      return false;
    }

    const basicForm = `${token?.basic_form ?? ""}`;
    const conjugatedType = `${token?.conjugated_type ?? ""}`;
    return basicForm === "する" || conjugatedType.includes("サ変");
  };

  const isIchidanVerbToken = (token) => {
    if (!isVerbToken(token)) {
      return false;
    }

    return `${token?.conjugated_type ?? ""}`.includes("一段");
  };

  const isGodanVerbToken = (token) => {
    if (!isVerbToken(token)) {
      return false;
    }

    return `${token?.conjugated_type ?? ""}`.includes("五段");
  };

  const isRenyouTaTeVerbToken = (token) => {
    const conjugatedForm = `${token?.conjugated_form ?? ""}`;
    return conjugatedForm.includes("タ接続") || conjugatedForm.includes("テ接続");
  };

  const isRenyouGeneralVerbToken = (token) => {
    if (!isVerbToken(token)) {
      return false;
    }

    const conjugatedForm = `${token?.conjugated_form ?? ""}`;
    return conjugatedForm.includes("連用") && !isRenyouTaTeVerbToken(token);
  };

  const getGodanStage4SuffixSet = (tokenOrBasicForm) => {
    const basicForm = typeof tokenOrBasicForm === "string"
      ? tokenOrBasicForm
      : `${tokenOrBasicForm?.basic_form ?? ""}`;
    const characters = Array.from(basicForm);
    const ending = characters.length > 0 ? characters[characters.length - 1] : "";
    return GODAN_STAGE4_SUFFIXES[ending] ?? null;
  };

  const getStage4MinimalVerbSuffix = (token, options = {}) => {
    if (!token || typeof token !== "object") {
      return null;
    }

    const surface = `${token.surface_form ?? ""}`;
    const trailing = splitTrailingKana(surface).okurigana;
    const conjugatedForm = `${token.conjugated_form ?? ""}`;

    if (isSahenVerbToken(token)) {
      if (conjugatedForm.includes("仮定") || conjugatedForm.includes("命令")) {
        return "せ";
      }
      if (conjugatedForm.includes("基本") || conjugatedForm.includes("連体")) {
        return "す";
      }
      return null;
    }

    if (isIchidanVerbToken(token)) {
      if (options.compressRenyou && isRenyouGeneralVerbToken(token)) {
        return "";
      }
      return trailing;
    }

    if (!isGodanVerbToken(token)) {
      return trailing;
    }

    if (isRenyouTaTeVerbToken(token)) {
      return trailing;
    }

    const suffixSet = getGodanStage4SuffixSet(token);
    if (!suffixSet) {
      return trailing;
    }

    if (conjugatedForm.includes("未然")) {
      return suffixSet.mizen;
    }
    if (conjugatedForm.includes("連用")) {
      return options.compressRenyou ? "" : suffixSet.renyou;
    }
    if (conjugatedForm.includes("仮定")) {
      return suffixSet.katei;
    }
    if (conjugatedForm.includes("命令")) {
      return suffixSet.meirei;
    }
    if (conjugatedForm.includes("意志") || conjugatedForm.includes("推量")) {
      return suffixSet.volitional;
    }
    if (conjugatedForm.includes("基本") || conjugatedForm.includes("連体")) {
      return suffixSet.basic;
    }

    return trailing;
  };

  return {
    splitCommaSeparatedValues,
    splitDelimitedRow,
    splitMatchCandidates,
    splitReplacementCandidates,
    normalizeReplacementCandidates,
    splitPositiveNegativeCandidates,
    isNegativeMatchCandidate,
    normalizeMatcherCandidateLiteral,
    expandRegexReplacementTemplate,
    katakanaToHiragana,
    normalizeKanaForMatch,
    hasWildcard,
    compileWildcardPattern,
    matchWildcardPattern,
    applyWildcardReplacement,
    replaceWildcardPattern,
    normalizePhraseRuleRecord,
    normalizePhraseRulesInput,
    splitNodeEntries,
    normalizeDictionaryNode,
    isKatakanaChar,
    isKanaChar,
    isKanjiChar,
    containsKanji,
    containsKana,
    splitTrailingKana,
    hasKanjiWithTrailingKana,
    splitKanjiKanaSegments,
    isKatakanaOnlyText,
    hasTrailingKatakanaLongVowel,
    isVerbToken,
    isSahenVerbToken,
    isIchidanVerbToken,
    isGodanVerbToken,
    isRenyouGeneralVerbToken,
    isRenyouTaTeVerbToken,
    getGodanStage4SuffixSet,
    getStage4MinimalVerbSuffix
  };
});

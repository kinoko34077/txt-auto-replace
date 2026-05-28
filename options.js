(() => {
  "use strict";

  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const STORAGE_KEY = "bundleOverrideSettingsV1";
  const DICT_PATH = "./dict/";

  const state = {
    activeTab: "bundles",
    roots: [],
    baseRoots: [],
    nodeSerial: 0,
    entrySerial: 0,
    tokenizer: null
  };

  const bundleRoot = document.getElementById("bundle-root");
  const diagnosticsRoot = document.getElementById("diagnostics-root");
  const panelBundles = document.getElementById("panel-bundles");
  const panelDiagnostics = document.getElementById("panel-diagnostics");
  const panelTokenizer = document.getElementById("panel-tokenizer");
  const tabBundlesButton = document.getElementById("tab-bundles");
  const tabDiagnosticsButton = document.getElementById("tab-diagnostics");
  const tabTokenizerButton = document.getElementById("tab-tokenizer");
  const statusNode = document.getElementById("status");
  const saveAllButton = document.getElementById("save-all");
  const addBundleButton = document.getElementById("add-bundle");
  const reloadDefaultsButton = document.getElementById("reload-defaults");
  const importSettingsButton = document.getElementById("import-settings");
  const exportJsonButton = document.getElementById("export-json");
  const exportYamlButton = document.getElementById("export-yaml");
  const importFileInput = document.getElementById("import-file");
  const tokenizerInput = document.getElementById("tokenizer-input");
  const tokenizerRunButton = document.getElementById("tokenizer-run");
  const tokenizerResult = document.getElementById("tokenizer-result");

  const setStatus = (message, type = "info") => {
    statusNode.textContent = message;
    statusNode.dataset.type = type;
  };

  const cloneValue = (value) => JSON.parse(JSON.stringify(value));

  const createNodeId = () => {
    state.nodeSerial += 1;
    return `node-${Date.now().toString(36)}-${state.nodeSerial.toString(36)}`;
  };

  const createEntryId = () => {
    state.entrySerial += 1;
    return `entry-${Date.now().toString(36)}-${state.entrySerial.toString(36)}`;
  };

  const storageGet = async (key) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(result?.[key]);
      });
    });
  };

  const storageSet = async (payload) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve();
      });
    });
  };

  const loadJson5Resource = async (path) => {
    const url = chrome.runtime.getURL(path) + `?t=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path} 邵ｺ・ｮ髫ｱ・ｭ髴趣ｽｼ邵ｺ・ｫ陞滂ｽｱ隰ｨ蜉ｱ・邵ｺ・ｾ邵ｺ蜉ｱ笳・ ${response.status}`);
    }

    return JSON5.parse(await response.text());
  };

  const buildTokenizer = () => {
    return new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji ????????????"));
        return;
      }

      const dicPath = DICT_PATH;
      const requiredFiles = [
        "base.dat.gz",
        "check.dat.gz",
        "tid.dat.gz",
        "tid_pos.dat.gz",
        "tid_map.dat.gz",
        "cc.dat.gz",
        "unk.dat.gz",
        "unk_pos.dat.gz",
        "unk_map.dat.gz",
        "unk_char.dat.gz",
        "unk_compat.dat.gz",
        "unk_invoke.dat.gz"
      ];

      Promise.all(requiredFiles.map(async (filename) => {
        const url = new URL(filename, new URL(DICT_PATH, window.location.href)).href;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`髴取ｨ雁ｶ檎ｹ晁ｼ斐＜郢ｧ・､郢晢ｽｫ陷ｿ髢・ｾ諤懶ｽ､・ｱ隰ｨ繝ｻ ${response.status} ${url}`);
        }
        await response.arrayBuffer();
        return url;
      }))
        .then(() => {
          kuromoji.builder({ dicPath }).build((error, tokenizer) => {
            if (error) {
              if (error && typeof error === "object" && error.type) {
                reject(new Error(`tokenizer build error: ${error.type}`));
                return;
              }
              reject(error instanceof Error ? error : new Error(`${error ?? "tokenizer build error"}`));
              return;
            }

            if (!tokenizer) {
              reject(new Error("tokenizer ?????????????????????????"));
              return;
            }

            resolve(tokenizer);
          });
        })
        .catch((error) => {
          reject(error instanceof Error ? error : new Error(`${error ?? "dictionary probe error"}`));
        });
    });
  };

  const parseJson5LikeValue = (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    try {
      if (
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))
      ) {
        return JSON5.parse(trimmed);
      }

      if (
        (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        const parsedString = JSON5.parse(trimmed);
        if (typeof parsedString === "string") {
          const nested = parsedString.trim();
          if (
            (nested.startsWith("[") && nested.endsWith("]")) ||
            (nested.startsWith("{") && nested.endsWith("}"))
          ) {
            return JSON5.parse(nested);
          }
        }
        return parsedString;
      }
    } catch (error) {
      return value;
    }

    return value;
  };

  const quoteYamlString = (value) => JSON.stringify(String(value));
  const quoteYamlKey = (key) => /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);

  const serializeYamlScalar = (value) => {
    if (typeof value === "string") {
      return quoteYamlString(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (value === null) {
      return "null";
    }
    return quoteYamlString(JSON.stringify(value));
  };

  const serializeYamlValue = (value, indent = 0) => {
    const spacing = " ".repeat(indent);

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "[]";
      }

      return value.map((entry) => {
        if (entry && typeof entry === "object") {
          return `${spacing}- ${serializeYamlObjectInline(entry, indent + 2)}`;
        }

        return `${spacing}- ${serializeYamlScalar(entry)}`;
      }).join("\n");
    }

    if (value && typeof value === "object") {
      return serializeYamlObject(value, indent);
    }

    return serializeYamlScalar(value);
  };

  const serializeYamlObjectInline = (object, indent) => {
    const entries = Object.entries(object);
    if (entries.length === 0) {
      return "{}";
    }

    const [firstKey, firstValue] = entries[0];
    const firstLineValue = serializeYamlValue(firstValue, indent);
    if (!/\n/.test(firstLineValue)) {
      const head = `${quoteYamlKey(firstKey)}: ${firstLineValue}`;
      if (entries.length === 1) {
        return head;
      }

      return `${head}\n${serializeYamlObject(Object.fromEntries(entries.slice(1)), indent)}`;
    }

    return `\n${serializeYamlObject(object, indent)}`;
  };

  const serializeYamlObject = (object, indent = 0) => {
    const spacing = " ".repeat(indent);

    return Object.entries(object)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          if (value.length === 0) {
            return `${spacing}${quoteYamlKey(key)}: []`;
          }

          return `${spacing}${quoteYamlKey(key)}:\n${serializeYamlValue(value, indent + 2)}`;
        }

        if (value && typeof value === "object") {
          const serialized = serializeYamlObject(value, indent + 2);
          if (!serialized.trim()) {
            return `${spacing}${quoteYamlKey(key)}: {}`;
          }
          return `${spacing}${quoteYamlKey(key)}:\n${serialized}`;
        }

        return `${spacing}${quoteYamlKey(key)}: ${serializeYamlScalar(value)}`;
      })
      .join("\n");
  };

  const stripTrailingYamlComma = (value) => {
    let inSingle = false;
    let inDouble = false;

    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      const prev = value[index - 1];

      if (char === "\"" && !inSingle && prev !== "\\") {
        inDouble = !inDouble;
        continue;
      }
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
      }
    }

    if (!inSingle && !inDouble && /,\s*$/.test(value)) {
      return value.replace(/,\s*$/, "");
    }

    return value;
  };

  const parseYamlScalar = (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    if (trimmed === "null") {
      return null;
    }
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return parseJson5LikeValue(trimmed);
    }
  };

  const splitYamlKeyValue = (text) => {
    let inSingle = false;
    let inDouble = false;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const prev = text[index - 1];

      if (char === "\"" && !inSingle && prev !== "\\") {
        inDouble = !inDouble;
        continue;
      }
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (char === ":" && !inSingle && !inDouble) {
        return {
          key: text.slice(0, index).trim(),
          value: text.slice(index + 1).trim()
        };
      }
    }

    throw new Error(`YAML 邵ｺ・ｮ髯ｦ蠕鯉ｽ帝囓・｣鬩･蛹ｻ縲堤ｸｺ髦ｪ竏ｪ邵ｺ蟶呻ｽ・ ${text}`);
  };

  const normalizeYamlKey = (key) => parseYamlScalar(key);

  const parseYamlDocument = (text) => {
    const lines = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => stripTrailingYamlComma(line))
      .filter((line) => !/^\s*$/.test(line) && !/^\s*#/.test(line));

    let index = 0;

    const countIndent = (line) => {
      const matched = line.match(/^ */);
      return matched ? matched[0].length : 0;
    };

    const isStandaloneBracketLine = (line) => /^\s*[{}\[\]]\s*$/.test(line);

    const parseNode = (indent) => {
      while (index < lines.length && isStandaloneBracketLine(lines[index])) {
        index += 1;
      }
      if (index >= lines.length) {
        return null;
      }

      const currentIndent = countIndent(lines[index]);
      if (currentIndent < indent) {
        return null;
      }

      const trimmed = lines[index].trim();
      if (trimmed.startsWith("- ")) {
        return parseArray(indent);
      }
      if (!trimmed.includes(":")) {
        index += 1;
        return parseYamlScalar(trimmed);
      }
      return parseObject(indent);
    };

    const parseObject = (indent) => {
      const result = {};
      let objectIndent = null;

      while (index < lines.length) {
        while (index < lines.length && isStandaloneBracketLine(lines[index])) {
          index += 1;
        }
        if (index >= lines.length) {
          break;
        }

        const line = lines[index];
        const lineIndent = countIndent(line);
        if (lineIndent < indent) {
          break;
        }

        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          break;
        }

        if (objectIndent === null) {
          objectIndent = lineIndent;
        }

        if (lineIndent !== objectIndent) {
          if (lineIndent < objectIndent) {
            break;
          }
        }

        const { key, value } = splitYamlKeyValue(trimmed);
        index += 1;

        if (value === "{") {
          result[normalizeYamlKey(key)] = parseObject(lineIndent + 2);
          continue;
        }
        if (value === "[") {
          result[normalizeYamlKey(key)] = parseArray(lineIndent + 2);
          continue;
        }
        if (value) {
          result[normalizeYamlKey(key)] = parseYamlScalar(value);
          continue;
        }

        while (index < lines.length && isStandaloneBracketLine(lines[index])) {
          index += 1;
        }

        const nextLine = lines[index];
        if (!nextLine || countIndent(nextLine) <= lineIndent) {
          result[normalizeYamlKey(key)] = null;
          continue;
        }

        result[normalizeYamlKey(key)] = parseNode(lineIndent + 2);
      }

      return result;
    };

    const parseArray = (indent) => {
      const result = [];
      let arrayIndent = null;

      while (index < lines.length) {
        while (index < lines.length && isStandaloneBracketLine(lines[index])) {
          index += 1;
        }
        if (index >= lines.length) {
          break;
        }

        const line = lines[index];
        const lineIndent = countIndent(line);
        if (lineIndent < indent) {
          break;
        }

        const trimmed = line.trim();
        if (!trimmed.startsWith("- ")) {
          break;
        }

        if (arrayIndent === null) {
          arrayIndent = lineIndent;
        }

        const itemText = trimmed.slice(2).trim();
        index += 1;

        if (!itemText) {
          result.push(parseNode(lineIndent + 2));
          continue;
        }

        if (itemText.includes(":")) {
          const item = {};
          const firstPair = splitYamlKeyValue(itemText);
          if (firstPair.value === "{") {
            item[normalizeYamlKey(firstPair.key)] = parseObject(lineIndent + 4);
          } else if (firstPair.value === "[") {
            item[normalizeYamlKey(firstPair.key)] = parseArray(lineIndent + 4);
          } else if (firstPair.value) {
            item[normalizeYamlKey(firstPair.key)] = parseYamlScalar(firstPair.value);
          } else {
            item[normalizeYamlKey(firstPair.key)] = parseNode(lineIndent + 4);
          }

          while (index < lines.length) {
            while (index < lines.length && isStandaloneBracketLine(lines[index])) {
              index += 1;
            }
            if (index >= lines.length) {
              break;
            }

            const nextLine = lines[index];
            const nextIndent = countIndent(nextLine);
            if (nextIndent <= lineIndent) {
              break;
            }

            const nextTrimmed = nextLine.trim();
            if (nextTrimmed.startsWith("- ") && nextIndent === lineIndent) {
              break;
            }

            const nextPair = splitYamlKeyValue(nextTrimmed);
            index += 1;
            if (nextPair.value === "{") {
              item[normalizeYamlKey(nextPair.key)] = parseObject(nextIndent + 2);
            } else if (nextPair.value === "[") {
              item[normalizeYamlKey(nextPair.key)] = parseArray(nextIndent + 2);
            } else if (nextPair.value) {
              item[normalizeYamlKey(nextPair.key)] = parseYamlScalar(nextPair.value);
            } else {
              item[normalizeYamlKey(nextPair.key)] = parseNode(nextIndent + 2);
            }
          }

          result.push(item);
          continue;
        }

        result.push(parseYamlScalar(itemText));
      }

      return result;
    };

    return parseNode(0);
  };

  const downloadText = (filename, text, mimeType) => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const normalizeEntryFromObject = (entry, fallbackPriority = 90) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const sequenceLabel = Array.isArray(entry.sequence)
      ? entry.sequence
          .map((token) => `${token?.surface ?? token?.basic ?? "*"}`.trim())
          .filter(Boolean)
          .join(" ")
      : "";
    const from = `${entry.from ?? sequenceLabel ?? ""}`.trim();
    const to = `${entry.to ?? ""}`.trim();
    if (!from) {
      return null;
    }

    return {
      id: `${entry.id ?? createEntryId()}`,
      from,
      to,
      priority: Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || fallbackPriority,
      enabled: entry.enabled !== false,
      regex: entry.regex === true || entry.is_regex === true,
      match_target: entry.match_target ?? (entry.type === "verb" ? "basic_form" : null),
      conditions: cloneValue(entry.conditions ?? null),
      sequence: cloneValue(entry.sequence ?? null),
      raw: cloneValue(entry),
      metaOpen: false,
      selected: false
    };
  };

  const normalizeReplacementRecord = (from, rawRule, fallbackPriority = 90) => {
    const normalizedRawRule = parseJson5LikeValue(rawRule);

    if (Array.isArray(normalizedRawRule)) {
      const firstValue = parseJson5LikeValue(normalizedRawRule[0]);
      if (Array.isArray(firstValue)) {
        return normalizeReplacementRecord(from, firstValue, fallbackPriority);
      }

      return {
        id: createEntryId(),
        from: `${from ?? ""}`.trim(),
        to: `${normalizedRawRule[0] ?? ""}`.trim(),
        priority: Number.isFinite(normalizedRawRule[1]) ? normalizedRawRule[1] : Number(normalizedRawRule[1]) || fallbackPriority,
        enabled: normalizedRawRule[2] !== false,
        regex: normalizedRawRule[3] === true,
        match_target: null,
        conditions: null,
        sequence: null,
        raw: null,
        metaOpen: false,
        selected: false
      };
    }

    if (typeof normalizedRawRule === "string") {
      return {
        id: createEntryId(),
        from: `${from ?? ""}`.trim(),
        to: normalizedRawRule.trim(),
        priority: fallbackPriority,
        enabled: true,
        regex: false,
        match_target: null,
        conditions: null,
        sequence: null,
        raw: null,
        metaOpen: false,
        selected: false
      };
    }

    if (normalizedRawRule && typeof normalizedRawRule === "object") {
      return normalizeEntryFromObject({
        ...normalizedRawRule,
        from: normalizedRawRule.from ?? from
      }, fallbackPriority);
    }

    return null;
  };

  const normalizeLegacyRulesObject = (rules, fallbackPriority = 90) => {
    if (Array.isArray(rules)) {
      return rules
        .map((rule) => {
          if (Array.isArray(rule)) {
            return normalizeReplacementRecord(rule[0], [rule[1], rule[2], rule[3], rule[4]], fallbackPriority);
          }

          return normalizeReplacementRecord(rule?.from ?? "", rule, fallbackPriority);
        })
        .filter((rule) => rule && rule.from);
    }

    if (rules && typeof rules === "object") {
      return Object.entries(rules)
        .map(([from, rawRule]) => normalizeReplacementRecord(from, rawRule, fallbackPriority))
        .filter((rule) => rule && rule.from);
    }

    return [];
  };

  const normalizeEntries = (source) => {
    const fallbackPriority = Number.isFinite(source?.entry_priority)
      ? source.entry_priority
      : Number(source?.entry_priority) || Number(source?.character_map_priority) || 90;

    const directEntries = Array.isArray(source?.entries)
      ? source.entries
        .map((entry) => normalizeEntryFromObject(entry, fallbackPriority))
        .filter(Boolean)
      : [];
    if (directEntries.length > 0) {
      return directEntries;
    }

    const ruleEntries = Array.isArray(source?.rules)
      ? source.rules
        .map((entry) => normalizeEntryFromObject(entry, fallbackPriority))
        .filter(Boolean)
      : [];
    if (ruleEntries.length > 0) {
      return ruleEntries;
    }

    return [
      ...normalizeLegacyRulesObject(source?.phrase_rules, fallbackPriority),
      ...normalizeLegacyRulesObject(source?.replace_rules, fallbackPriority),
      ...(
        source?.character_map &&
        typeof source.character_map === "object" &&
        !Array.isArray(source.character_map)
          ? Object.entries(source.character_map)
            .map(([from, to]) => normalizeEntryFromObject({
              from,
              to,
              priority: fallbackPriority,
              enabled: true,
              regex: false
            }, fallbackPriority))
            .filter(Boolean)
          : []
      )
    ];
  };

  const inferBundleKind = (source) => {
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

    return "dictionary-rules";
  };

  const normalizeNode = (source, fallbackId = "group", fallbackLabel = "Group") => {
    const childrenSource = Array.isArray(source?.children) && source.children.length > 0
      ? source.children
      : Array.isArray(source?.groups) && source.groups.length > 0
        ? source.groups
        : [];

    return {
      id: `${source?.id ?? createNodeId()}`.trim() || fallbackId,
      label: `${source?.label ?? fallbackLabel}`.trim() || fallbackLabel,
      kind: `${inferBundleKind(source)}`.trim() || "dictionary-rules",
      enabled: source?.enabled !== false,
      order: Number.isFinite(source?.order) ? source.order : Number(source?.order) || 0,
      entries: normalizeEntries(source),
      children: childrenSource.map((child, index) => {
        return normalizeNode(child, `${fallbackId}-${index + 1}`, `${fallbackLabel} ${index + 1}`);
      })
    };
  };

  const normalizeManifestDefinition = (bundle, definition) => {
    if (!definition || !definition.kind) {
      throw new Error(`${bundle.id} の定義が不正です。`);
    }
    return normalizeNode({
      ...definition,
      id: bundle.id,
      label: definition.label ?? bundle.label ?? bundle.id,
      enabled: bundle.enabled !== false,
      order: bundle.order ?? 0
    }, bundle.id, bundle.label ?? bundle.id);
  };

  const normalizeImportedRoots = (payload) => {
    const directRoots = Array.isArray(payload?.roots)
      ? payload.roots
      : Array.isArray(payload?.[STORAGE_KEY]?.roots)
        ? payload[STORAGE_KEY].roots
        : null;
    if (directRoots) {
      return directRoots.map((root, index) => normalizeNode(root, `bundle-${index + 1}`, `Bundle ${index + 1}`));
    }

    const directBundles = payload?.bundles
      ? payload.bundles
      : payload?.[STORAGE_KEY]?.bundles
        ? payload[STORAGE_KEY].bundles
        : null;
    if (directBundles && typeof directBundles === "object" && !Array.isArray(directBundles)) {
      return Object.entries(directBundles)
        .map(([bundleId, bundleValue], index) => {
          return normalizeNode({
            ...bundleValue,
            id: bundleValue?.id ?? bundleId,
            label: bundleValue?.label ?? bundleId
          }, bundleId, `Bundle ${index + 1}`);
        });
    }

    const topLevelObject = payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.entries(payload)
      : [];
    if (topLevelObject.length > 0 && topLevelObject.every(([, value]) => value && typeof value === "object")) {
      return topLevelObject.map(([bundleId, bundleValue], index) => {
        return normalizeNode({
          ...bundleValue,
          id: bundleValue?.id ?? bundleId,
          label: bundleValue?.label ?? bundleId
        }, bundleId, `Bundle ${index + 1}`);
      });
    }

    throw new Error("読み込んだデータから roots を構築できません");
  };

  const serializeEntry = (entry, index) => {
    const serialized = entry.raw && typeof entry.raw === "object"
      ? cloneValue(entry.raw)
      : {};
    serialized.id = `${entry.id ?? createEntryId()}`.trim() || `entry-${index + 1}`;
    serialized.from = `${entry.from ?? ""}`.trim();
    serialized.to = `${entry.to ?? ""}`.trim();
    serialized.priority = Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || 0;
    serialized.enabled = entry.enabled !== false;
    serialized.regex = entry.regex === true;
    if (entry.match_target === "basic_form") {
      serialized.match_target = "basic_form";
    } else {
      delete serialized.match_target;
    }
    if (entry.conditions && (
      entry.conditions.prev ||
      entry.conditions.current ||
      entry.conditions.next
    )) {
      serialized.conditions = {};
      if (entry.conditions.prev) {
        serialized.conditions.prev = cloneValue(entry.conditions.prev);
      }
      if (entry.conditions.current) {
        serialized.conditions.current = cloneValue(entry.conditions.current);
      }
      if (entry.conditions.next) {
        serialized.conditions.next = cloneValue(entry.conditions.next);
      }
    } else {
      delete serialized.conditions;
    }
    if (Array.isArray(entry.sequence) && entry.sequence.length > 0) {
      serialized.sequence = cloneValue(entry.sequence);
    } else {
      delete serialized.sequence;
    }
    return serialized;
  };

  const serializeNode = (node, order) => {
    const base = {
      id: `${node.id}`.trim() || createNodeId(),
      label: `${node.label}`.trim() || "Group",
      kind: `${node.kind ?? "dictionary-rules"}`.trim() || "dictionary-rules",
      enabled: node.enabled !== false,
      order,
      children: node.children.map((child, index) => serializeNode(child, index + 1))
    };

    const serializedEntries = node.entries
      .map((entry, index) => serializeEntry(entry, index))
      .filter((entry) => entry.from && entry.to);

    if (base.kind === "token-rules") {
      base.rules = serializedEntries;
    } else {
      base.entries = serializedEntries;
    }

    return base;
  };

  const buildPayload = () => {
    return {
      schema_version: 3,
      roots: state.roots.map((root, index) => serializeNode(root, index + 1))
    };
  };

  const buildStoragePayload = () => ({
    [STORAGE_KEY]: buildPayload()
  });

  const findBaseRoot = (rootId) => {
    return state.baseRoots.find((root) => root.id === rootId) ?? null;
  };

  const getNodePathText = (trail) => {
    return trail.map((node) => node.label || "Group").join(" / ");
  };

  const walkNodes = (nodes, visit, trail = []) => {
    for (const node of nodes) {
      const nextTrail = [...trail, node];
      visit(node, nextTrail);
      walkNodes(node.children, visit, nextTrail);
    }
  };

  const saveAll = async () => {
    await storageSet(buildStoragePayload());
    setStatus("設定を保存しました。対象タブを再読み込みしてください。", "success");
  };

  const reloadDefaults = () => {
    state.roots = cloneValue(state.baseRoots);
    renderApp();
    setStatus("既定値に戻しました。", "info");
  };

  const resetRoot = (rootId) => {
    const rootIndex = state.roots.findIndex((root) => root.id === rootId);
    if (rootIndex < 0) {
      return;
    }

    const baseRoot = findBaseRoot(rootId);
    if (baseRoot) {
      state.roots[rootIndex] = cloneValue(baseRoot);
    } else {
      state.roots.splice(rootIndex, 1);
    }
    renderApp();
    setStatus("Bundle を初期化しました。", "info");
  };

  const moveItem = (items, index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) {
      return false;
    }

    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    return true;
  };

  const createButton = (label, className, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const autosizeInput = (input, min = 4, max = 32) => {
    const valueLength = Math.max(
      `${input.value ?? input.placeholder ?? ""}`.length + 1,
      min
    );
    input.size = Math.min(max, valueLength);
  };

  const createCompactInput = (value, { type = "text", min = 4, max = 32, className = "cell-input" } = {}) => {
    const input = document.createElement("input");
    input.type = type;
    input.className = className;
    input.value = value;
    autosizeInput(input, min, max);
    input.addEventListener("input", () => autosizeInput(input, min, max));
    return input;
  };

  const formatConditionText = (value) => {
    if (!value) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value);
  };

  const parseConditionText = (text) => {
    const trimmed = `${text ?? ""}`.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = parseJson5LikeValue(trimmed);
    return parsed;
  };

  const formatSequenceText = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
      return "";
    }

    return JSON.stringify(value);
  };

  const parseSequenceText = (text) => {
    const trimmed = `${text ?? ""}`.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = parseJson5LikeValue(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("sequence は配列で指定してください");
    }
    return parsed;
  };

  const COMMON_POS_VALUES = ["名詞", "動詞", "助詞", "助動詞", "形容詞", "副詞", "連体詞", "接続詞", "記号"];
  const COMMON_POS1_VALUES = ["一般", "自立", "非自立", "接尾", "格助詞", "係助詞", "副詞可能", "サ変接続"];
  const COMMON_CFORM_VALUES = ["基本形", "連体形", "連用形", "未然形", "仮定形", "命令形"];
  const COMMON_CTYPE_VALUES = ["五段・ラ行", "五段・ワ行促音便", "一段", "サ変・スル", "カ変・クル", "形容詞・イ段"];

  const ensureDatalist = (id, values) => {
    let datalist = document.getElementById(id);
    if (datalist) {
      return datalist;
    }

    datalist = document.createElement("datalist");
    datalist.id = id;
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      datalist.appendChild(option);
    }
    document.body.appendChild(datalist);
    return datalist;
  };

  const normalizeMatcherDraft = (value) => {
    if (Array.isArray(value)) {
      return normalizeMatcherDraft(value[0] ?? null);
    }
    if (typeof value === "string") {
      return { surface: value };
    }
    if (value && typeof value === "object") {
      return cloneValue(value);
    }
    return {};
  };

  const cleanupMatcherDraft = (draft) => {
    const normalized = {};
    const keys = ["surface", "basic", "pos", "pos1", "pos2", "pos3", "ctype", "cform", "reading", "pronunciation", "word_type"];
    for (const key of keys) {
      const value = `${draft?.[key] ?? ""}`.trim();
      if (value) {
        normalized[key] = value;
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  };

  const assignConditionSlot = (entry, slot, matcher) => {
    const nextConditions = { ...(entry.conditions ?? {}) };
    if (matcher) {
      nextConditions[slot] = matcher;
    } else {
      delete nextConditions[slot];
    }
    entry.conditions = Object.keys(nextConditions).length > 0 ? nextConditions : null;
  };

  const setAllRowsSelected = (entries, selected) => {
    for (const entry of entries) {
      entry.selected = selected;
    }
  };

  const getSelectedCount = (entries) => {
    return entries.filter((entry) => entry.selected === true).length;
  };

  const deleteSelectedRows = (entries) => {
    return entries.filter((entry) => entry.selected !== true);
  };

  const updateSelectAllState = (checkbox, entries) => {
    const selectedCount = getSelectedCount(entries);
    checkbox.checked = entries.length > 0 && selectedCount === entries.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < entries.length;
  };

  const createEditableTitle = (tagName, node, fallback, onCommit) => {
    const heading = document.createElement(tagName);
    heading.className = "editable-title";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "title-button";
    button.textContent = node.label || fallback;

    const startEditing = () => {
      const editor = createCompactInput(node.label || "", {
        type: "text",
        min: 6,
        max: 48,
        className: "cell-input title-editor"
      });
      editor.placeholder = fallback;
      heading.replaceChildren(editor);
      editor.focus();
      editor.select();

      const finish = (commit) => {
        if (commit) {
          node.label = editor.value.trim() || fallback;
          onCommit();
        } else {
          renderApp();
        }
      };

      editor.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });

      editor.addEventListener("blur", () => finish(true), { once: true });
    };

    button.addEventListener("dblclick", startEditing);
    heading.appendChild(button);
    return heading;
  };

  const createMatcherField = (labelText, value, datalistId, datalistValues, onInput) => {
    const label = document.createElement("label");
    label.style.display = "grid";
    label.style.gap = "3px";

    const caption = document.createElement("span");
    caption.className = "count";
    caption.textContent = labelText;

    const input = createCompactInput(value, {
      type: "text",
      min: 3,
      max: 16,
      className: "cell-input"
    });
    if (datalistId && Array.isArray(datalistValues)) {
      ensureDatalist(datalistId, datalistValues);
      input.setAttribute("list", datalistId);
    }
    input.addEventListener("input", () => onInput(input.value));

    label.append(caption, input);
    return label;
  };

  const renderConditionEditor = (entry, slot, labelText) => {
    const wrap = document.createElement("div");
    wrap.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = labelText;
    const hint = document.createElement("span");
    hint.className = "count";
    hint.textContent = "surface / basic / pos / pos1 / cform";
    head.append(title, hint);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gap = "6px";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(92px, 1fr))";

    const draft = normalizeMatcherDraft(entry.conditions?.[slot]);
    const updateField = (key, value) => {
      draft[key] = value;
      assignConditionSlot(entry, slot, cleanupMatcherDraft(draft));
      renderDiagnostics();
    };

    grid.appendChild(createMatcherField("表層", draft.surface ?? "", null, null, (value) => updateField("surface", value)));
    grid.appendChild(createMatcherField("原形条件", draft.basic ?? "", null, null, (value) => updateField("basic", value)));
    grid.appendChild(createMatcherField("品詞", draft.pos ?? "", "pos-values", COMMON_POS_VALUES, (value) => updateField("pos", value)));
    grid.appendChild(createMatcherField("品詞1", draft.pos1 ?? "", "pos1-values", COMMON_POS1_VALUES, (value) => updateField("pos1", value)));
    grid.appendChild(createMatcherField("活用形", draft.cform ?? "", "cform-values", COMMON_CFORM_VALUES, (value) => updateField("cform", value)));
    grid.appendChild(createMatcherField("活用型", draft.ctype ?? "", "ctype-values", COMMON_CTYPE_VALUES, (value) => updateField("ctype", value)));

    wrap.append(head, grid);
    return wrap;
  };

  const renderSequenceEditor = (entry) => {
    const wrap = document.createElement("div");
    wrap.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = "sequence";
    const actions = document.createElement("div");
    actions.className = "panel-actions";
    actions.appendChild(createButton("Token髴托ｽｽ陷会｣ｰ", "secondary", () => {
      const next = Array.isArray(entry.sequence) ? cloneValue(entry.sequence) : [];
      next.push({ surface: "", pos: "" });
      entry.sequence = next;
      renderApp();
    }));
    head.append(title, actions);

    const sequence = Array.isArray(entry.sequence) ? entry.sequence : [];
    if (sequence.length === 0) {
      const empty = document.createElement("div");
      empty.className = "count";
      empty.textContent = "sequence は未設定です。";
      wrap.append(head, empty);
      return wrap;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>髯ｦ・ｨ陞ｻ・､</th>
        <th>陷ｴ貅ｷ・ｽ・｢</th>
        <th>陷ｩ竏ｬ・ｩ繝ｻ/th>
        <th>陷ｩ竏ｬ・ｩ繝ｻ</th>
        <th>雎｢・ｻ騾包ｽｨ陟厄ｽ｢</th>
        <th>雎｢・ｻ騾包ｽｨ陜吶・/th>
        <th>隰ｫ蝣ｺ・ｽ繝ｻ/th>
      </tr>
    `;
    const tbody = document.createElement("tbody");

    sequence.forEach((matcher, matcherIndex) => {
      const row = document.createElement("tr");
      const draft = normalizeMatcherDraft(matcher);
      const updateMatcher = (key, value) => {
        const next = Array.isArray(entry.sequence) ? cloneValue(entry.sequence) : [];
        const matcherDraft = normalizeMatcherDraft(next[matcherIndex]);
        matcherDraft[key] = value;
        next[matcherIndex] = cleanupMatcherDraft(matcherDraft) ?? {};
        entry.sequence = next;
        renderDiagnostics();
      };

      const appendCell = (node) => {
        const td = document.createElement("td");
        td.appendChild(node);
        row.appendChild(td);
      };

      appendCell(createCompactInput(draft.surface ?? "", { min: 3, max: 18 }));
      row.lastChild.firstChild.addEventListener("input", (event) => updateMatcher("surface", event.currentTarget.value));

      appendCell(createCompactInput(draft.basic ?? "", { min: 3, max: 18 }));
      row.lastChild.firstChild.addEventListener("input", (event) => updateMatcher("basic", event.currentTarget.value));

      const posInput = createCompactInput(draft.pos ?? "", { min: 3, max: 12 });
      ensureDatalist("pos-values", COMMON_POS_VALUES);
      posInput.setAttribute("list", "pos-values");
      posInput.addEventListener("input", (event) => updateMatcher("pos", event.currentTarget.value));
      appendCell(posInput);

      const pos1Input = createCompactInput(draft.pos1 ?? "", { min: 3, max: 12 });
      ensureDatalist("pos1-values", COMMON_POS1_VALUES);
      pos1Input.setAttribute("list", "pos1-values");
      pos1Input.addEventListener("input", (event) => updateMatcher("pos1", event.currentTarget.value));
      appendCell(pos1Input);

      const cformInput = createCompactInput(draft.cform ?? "", { min: 3, max: 12 });
      ensureDatalist("cform-values", COMMON_CFORM_VALUES);
      cformInput.setAttribute("list", "cform-values");
      cformInput.addEventListener("input", (event) => updateMatcher("cform", event.currentTarget.value));
      appendCell(cformInput);

      const ctypeInput = createCompactInput(draft.ctype ?? "", { min: 3, max: 14 });
      ensureDatalist("ctype-values", COMMON_CTYPE_VALUES);
      ctypeInput.setAttribute("list", "ctype-values");
      ctypeInput.addEventListener("input", (event) => updateMatcher("ctype", event.currentTarget.value));
      appendCell(ctypeInput);

      const actionTd = document.createElement("td");
      actionTd.className = "action-col";
      actionTd.appendChild(createButton("↑", "ghost", () => {
        if (moveItem(sequence, matcherIndex, -1)) {
          entry.sequence = cloneValue(sequence);
          renderApp();
        }
      }));
      actionTd.appendChild(createButton("↓", "ghost", () => {
        if (moveItem(sequence, matcherIndex, 1)) {
          entry.sequence = cloneValue(sequence);
          renderApp();
        }
      }));
      actionTd.appendChild(createButton("削除", "danger", () => {
        const next = cloneValue(sequence);
        next.splice(matcherIndex, 1);
        entry.sequence = next.length > 0 ? next : null;
        renderApp();
      }));
      row.appendChild(actionTd);

      tbody.appendChild(row);
    });

    table.append(thead, tbody);
    tableWrap.appendChild(table);
    wrap.append(head, tableWrap);
    return wrap;
  };

  const renderEntryTable = (node, effectiveKind) => {
    const wrapper = document.createElement("div");
    wrapper.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = "項目";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = effectiveKind === "token-rules"
      ? `token ${node.entries.length} 件 / 選択 ${getSelectedCount(node.entries)} 件`
      : `dictionary ${node.entries.length} 件 / 選択 ${getSelectedCount(node.entries)} 件`;
    head.append(title, count);

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th class="check-col"></th>
        <th class="check-col">有効</th>
        <th class="check-col">正規</th>
        <th class="check-col">原形一致</th>
        <th>変更前</th>
        <th>変更後</th>
        <th>優先</th>
        <th>操作</th>
      </tr>
    `;

    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.setAttribute("aria-label", "全選択");
    thead.querySelector("th")?.appendChild(selectAll);

    const tbody = document.createElement("tbody");
    node.entries.forEach((entry, entryIndex) => {
      const row = document.createElement("tr");
      row.id = `entry-${entry.id}`;
      row.dataset.searchValue = `${entry.regex ? "regex" : "plain"} ${entry.from} ${entry.to}`;

      const checkTd = document.createElement("td");
      checkTd.className = "check-col";
      const rowCheckbox = document.createElement("input");
      rowCheckbox.type = "checkbox";
      rowCheckbox.checked = entry.selected === true;
      rowCheckbox.addEventListener("change", () => {
        entry.selected = rowCheckbox.checked;
        updateSelectAllState(selectAll, node.entries);
        renderDiagnostics();
      });
      checkTd.appendChild(rowCheckbox);

      const enabledTd = document.createElement("td");
      enabledTd.className = "check-col";
      const enabledCheckbox = document.createElement("input");
      enabledCheckbox.type = "checkbox";
      enabledCheckbox.checked = entry.enabled !== false;
      enabledCheckbox.addEventListener("change", () => {
        entry.enabled = enabledCheckbox.checked;
        renderDiagnostics();
      });
      enabledTd.appendChild(enabledCheckbox);

      const regexTd = document.createElement("td");
      regexTd.className = "check-col";
      const regexCheckbox = document.createElement("input");
      regexCheckbox.type = "checkbox";
      regexCheckbox.checked = entry.regex === true;
      regexCheckbox.addEventListener("change", () => {
        entry.regex = regexCheckbox.checked;
        row.dataset.searchValue = `${entry.regex ? "regex" : "plain"} ${entry.from} ${entry.to}`;
        renderDiagnostics();
      });
      regexTd.appendChild(regexCheckbox);

      const basicTd = document.createElement("td");
      basicTd.className = "check-col";
      const basicCheckbox = document.createElement("input");
      basicCheckbox.type = "checkbox";
      basicCheckbox.title = effectiveKind === "token-rules"
        ? "変更前を辞書形 basic_form に対して一致させる"
        : "dictionary-rules では使用しません";
      basicCheckbox.checked = effectiveKind === "token-rules" && entry.match_target === "basic_form";
      basicCheckbox.disabled = effectiveKind !== "token-rules";
      basicCheckbox.addEventListener("change", () => {
        entry.match_target = basicCheckbox.checked ? "basic_form" : null;
        renderDiagnostics();
      });
      basicTd.appendChild(basicCheckbox);

      const fromTd = document.createElement("td");
      const fromInput = createCompactInput(entry.from, { min: 2, max: 24 });
      fromInput.addEventListener("input", () => {
        entry.from = fromInput.value;
        row.dataset.searchValue = `${entry.regex ? "regex" : "plain"} ${entry.from} ${entry.to}`;
        renderDiagnostics();
      });
      fromTd.appendChild(fromInput);

      const toTd = document.createElement("td");
      const toInput = createCompactInput(entry.to, { min: 2, max: 24 });
      toInput.addEventListener("input", () => {
        entry.to = toInput.value;
        row.dataset.searchValue = `${entry.regex ? "regex" : "plain"} ${entry.from} ${entry.to}`;
        renderDiagnostics();
      });
      toTd.appendChild(toInput);

      const priorityTd = document.createElement("td");
      const priorityInput = createCompactInput(String(entry.priority ?? 90), {
        type: "number",
        min: 3,
        max: 6,
        className: "cell-input compact"
      });
      priorityInput.addEventListener("input", () => {
        entry.priority = Number(priorityInput.value) || 0;
        renderDiagnostics();
      });
      priorityTd.appendChild(priorityInput);

      const actionTd = document.createElement("td");
      actionTd.className = "action-col";
      const detailButton = createButton(entry.metaOpen ? "閉じる" : "条件", "ghost", () => {
        entry.metaOpen = !entry.metaOpen;
        renderApp();
      });
      if (effectiveKind !== "token-rules") {
        detailButton.disabled = true;
        detailButton.title = "dictionary-rules では条件・sequence を使いません";
      }
      actionTd.appendChild(detailButton);
      actionTd.appendChild(createButton("削除", "danger row-delete", () => {
        node.entries.splice(entryIndex, 1);
        renderApp();
      }));

      row.append(checkTd, enabledTd, regexTd, basicTd, fromTd, toTd, priorityTd, actionTd);
      tbody.appendChild(row);

      if (effectiveKind === "token-rules" && entry.metaOpen) {
        const detailRow = document.createElement("tr");
        const detailCell = document.createElement("td");
        detailCell.colSpan = 8;

        const detailWrap = document.createElement("div");
        detailWrap.className = "panel-block";

        const detailHead = document.createElement("div");
        detailHead.className = "panel-head";
        const detailTitle = document.createElement("h4");
        detailTitle.textContent = "条件";
        const detailHint = document.createElement("span");
        detailHint.className = "count";
        detailHint.textContent = "前後条件・現条件・sequence を編集";
        detailHead.append(detailTitle, detailHint);

        const detailGrid = document.createElement("div");
        detailGrid.style.display = "grid";
        detailGrid.style.gap = "6px";
        detailGrid.appendChild(renderConditionEditor(entry, "prev", "前"));
        detailGrid.appendChild(renderConditionEditor(entry, "current", "現"));
        detailGrid.appendChild(renderConditionEditor(entry, "next", "後"));
        detailGrid.appendChild(renderSequenceEditor(entry));

        detailWrap.append(detailHead, detailGrid);
        detailCell.appendChild(detailWrap);
        detailRow.appendChild(detailCell);
        tbody.appendChild(detailRow);
      }
    });

    selectAll.addEventListener("change", () => {
      setAllRowsSelected(node.entries, selectAll.checked);
      renderApp();
    });
    updateSelectAllState(selectAll, node.entries);

    table.append(thead, tbody);
    tableWrap.appendChild(table);
    wrapper.append(head, tableWrap);
    return wrapper;
  };

  const renderNodeSection = ({ node, parentChildren, index, depth = 0, isRoot = false, inheritedKind = null }) => {
    const card = document.createElement("section");
    card.className = isRoot ? "bundle-card" : "group-card";
    card.id = `node-${node.id}`;
    const effectiveKind = isRoot
      ? (node.kind ?? "dictionary-rules")
      : (inheritedKind ?? node.kind ?? "dictionary-rules");

    const header = document.createElement("div");
    header.className = isRoot ? "bundle-head" : "group-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = isRoot ? "bundle-title" : "group-title";
    titleWrap.appendChild(createEditableTitle(isRoot ? "h2" : "h3", node, isRoot ? "Bundle" : "Group", renderApp));

    const entryChip = document.createElement("span");
    entryChip.className = "chip";
    entryChip.textContent = `項目 ${node.entries.length}`;
    const childChip = document.createElement("span");
    childChip.className = "chip";
    childChip.textContent = `子箱 ${node.children.length}`;
    const kindChip = document.createElement("span");
    kindChip.className = "chip";
    kindChip.textContent = effectiveKind;
    titleWrap.append(entryChip, childChip, kindChip);

    const actions = document.createElement("div");
    actions.className = isRoot ? "bundle-actions" : "group-actions";

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "toggle";
    const enabledCheckbox = document.createElement("input");
    enabledCheckbox.type = "checkbox";
    enabledCheckbox.checked = node.enabled !== false;
    enabledCheckbox.addEventListener("change", () => {
      node.enabled = enabledCheckbox.checked;
      renderDiagnostics();
    });
    enabledLabel.append(enabledCheckbox, document.createTextNode("有効"));
    actions.appendChild(enabledLabel);

    if (isRoot) {
      const kindSelect = document.createElement("select");
      kindSelect.title = "Bundle の実行種別";
      kindSelect.innerHTML = `
        <option value="token-rules">token-rules</option>
        <option value="dictionary-rules">dictionary-rules</option>
      `;
      kindSelect.value = effectiveKind;
      kindSelect.addEventListener("change", () => {
        node.kind = kindSelect.value;
        renderApp();
      });
      actions.appendChild(kindSelect);
    }

    actions.appendChild(createButton("↑", "ghost", () => {
      if (moveItem(parentChildren, index, -1)) {
        renderApp();
      }
    }));
    actions.appendChild(createButton("↓", "ghost", () => {
      if (moveItem(parentChildren, index, 1)) {
        renderApp();
      }
    }));
    actions.appendChild(createButton("子箱追加", "secondary", () => {
      node.children.push(normalizeNode({
        id: createNodeId(),
        label: "Group",
        kind: effectiveKind,
        enabled: true,
        entries: [],
        children: []
      }, "group", "Group"));
      renderApp();
    }));
    actions.appendChild(createButton("行追加", "secondary", () => {
      node.entries.push({
        id: createEntryId(),
        from: "",
        to: "",
        priority: 90,
        enabled: true,
        regex: false,
        match_target: null,
        conditions: null,
        sequence: null,
        raw: null,
        metaOpen: false,
        selected: false
      });
      renderApp();
    }));
    actions.appendChild(createButton("選択削除", "danger", () => {
      node.entries = deleteSelectedRows(node.entries);
      renderApp();
    }));

    if (isRoot) {
      actions.appendChild(createButton("初期化", "ghost", () => {
        resetRoot(node.id);
      }));
      if (!findBaseRoot(node.id)) {
        actions.appendChild(createButton("Bundle削除", "warn", () => {
          parentChildren.splice(index, 1);
          renderApp();
        }));
      }
    } else {
      actions.appendChild(createButton("箱削除", "warn", () => {
        parentChildren.splice(index, 1);
        renderApp();
      }));
    }

    header.append(titleWrap, actions);
    card.appendChild(header);

    if (node.entries.length > 0 || node.children.length === 0) {
      card.appendChild(renderEntryTable(node, effectiveKind));
    }

    if (node.children.length > 0) {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "bundle-body";
      node.children.forEach((child, childIndex) => {
        childrenWrap.appendChild(renderNodeSection({
          node: child,
          parentChildren: node.children,
          index: childIndex,
          depth: depth + 1,
          isRoot: false,
          inheritedKind: effectiveKind
        }));
      });
      card.appendChild(childrenWrap);
    }

    return card;
  };

  const collectDiagnostics = () => {
    const duplicateFromMap = new Map();
    const duplicateNodeLabelMap = new Map();
    const overlapIssues = [];
    const plainEntries = [];

    walkNodes(state.roots, (node, trail) => {
      const pathText = getNodePathText(trail);
      const nodeKey = `${trail.length}:${node.label}`;
      if (!duplicateNodeLabelMap.has(nodeKey)) {
        duplicateNodeLabelMap.set(nodeKey, []);
      }
      duplicateNodeLabelMap.get(nodeKey).push(pathText);

      for (const entry of node.entries) {
        if (!entry.from) {
          continue;
        }
        const entryKey = `${entry.regex === true ? "regex" : "plain"}:${entry.from}`;
        if (!duplicateFromMap.has(entryKey)) {
          duplicateFromMap.set(entryKey, []);
        }
        duplicateFromMap.get(entryKey).push({
          rootId: trail[0]?.id ?? null,
          nodeId: node.id,
          entryId: entry.id,
          from: entry.from,
          pathText,
          to: entry.to,
          priority: entry.priority,
          regex: entry.regex === true
        });

        if (entry.regex !== true) {
          plainEntries.push({
            rootId: trail[0]?.id ?? null,
            nodeId: node.id,
            entryId: entry.id,
            from: entry.from,
            to: entry.to,
            pathText
          });
        }
      }
    });

    for (let leftIndex = 0; leftIndex < plainEntries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < plainEntries.length; rightIndex += 1) {
        const left = plainEntries[leftIndex];
        const right = plainEntries[rightIndex];
        if (!left.from || !right.from || left.from === right.from) {
          continue;
        }

        const leftContainsRight = left.from.includes(right.from);
        const rightContainsLeft = right.from.includes(left.from);
        if (!leftContainsRight && !rightContainsLeft) {
          continue;
        }

        const longer = left.from.length >= right.from.length ? left : right;
        const shorter = longer === left ? right : left;
        overlapIssues.push({
          longer,
          shorter
        });
      }
    }

    return {
      duplicateFromIssues: [...duplicateFromMap.entries()].filter(([, entries]) => entries.length > 1),
      duplicateNodeLabelIssues: [...duplicateNodeLabelMap.entries()].filter(([, entries]) => entries.length > 1),
      overlapIssues
    };
  };

  const setTemporaryHighlight = (element) => {
    if (!element) {
      return;
    }

    const previousOutline = element.style.outline;
    const previousOutlineOffset = element.style.outlineOffset;
    element.style.outline = "2px solid var(--accent)";
    element.style.outlineOffset = "2px";
    window.setTimeout(() => {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOutlineOffset;
    }, 1800);
  };

  const findEntryById = (entryId) => {
    let found = null;
    walkNodes(state.roots, (node) => {
      if (found) {
        return;
      }
      const entry = node.entries.find((candidate) => candidate.id === entryId);
      if (entry) {
        found = entry;
      }
    });
    return found;
  };

  const jumpToDiagnosticTarget = (target) => {
    if (!target) {
      return;
    }

    if (target.entryId) {
      const entry = findEntryById(target.entryId);
      if (entry) {
        entry.metaOpen = true;
      }
    }

    state.activeTab = "bundles";
    renderApp();

    window.setTimeout(() => {
      const selector = target.entryId
        ? `entry-${target.entryId}`
        : target.nodeId
          ? `node-${target.nodeId}`
          : target.rootId
            ? `node-${target.rootId}`
            : null;
      if (!selector) {
        return;
      }

      const element = document.getElementById(selector);
      if (!element) {
        return;
      }

      element.scrollIntoView({ block: "center", behavior: "smooth" });
      setTemporaryHighlight(element);
    }, 0);
  };

  const createJumpButton = (label, target) => {
    return createButton(label, "ghost", () => {
      jumpToDiagnosticTarget(target);
    });
  };

  const renderIssueCard = (title, issues, emptyText, renderRow) => {
    const card = document.createElement("section");
    card.className = "diagnostics-card";

    const heading = document.createElement("h2");
    heading.textContent = title;
    card.appendChild(heading);

    const summary = document.createElement("p");
    summary.className = "diag-summary";
    summary.textContent = issues.length === 0 ? emptyText : `${issues.length} 件の問題があります。`;
    card.appendChild(summary);

    if (issues.length === 0) {
      return card;
    }

    const list = document.createElement("div");
    list.className = "diag-list";
    for (const issue of issues) {
      list.appendChild(renderRow(issue));
    }
    card.appendChild(list);
    return card;
  };

  const renderDiagnostics = () => {
    diagnosticsRoot.textContent = "";
    const diagnostics = collectDiagnostics();

    diagnosticsRoot.appendChild(renderIssueCard(
      "重複した変更前",
      diagnostics.duplicateFromIssues,
      "重複はありません。",
      ([entryKey, occurrences]) => {
        const item = document.createElement("div");
        item.className = "diag-item";
        const heading = document.createElement("h3");
        const [mode, from] = entryKey.split(":");
        heading.textContent = `${from} (${mode === "regex" ? "regex" : "plain"})`;
        const body = document.createElement("div");
        body.className = "diag-occurrence";
        for (const occurrence of occurrences) {
          const line = document.createElement("div");
          line.appendChild(createJumpButton("移動", occurrence));
          line.append(` ${occurrence.pathText} -> ${occurrence.to} / priority ${occurrence.priority}`);
          body.appendChild(line);
        }
        item.append(heading, body);
        return item;
      }
    ));

    diagnosticsRoot.appendChild(renderIssueCard(
      "包含している変更前",
      diagnostics.overlapIssues,
      "包含関係はありません。",
      ({ longer, shorter }) => {
        const item = document.createElement("div");
        item.className = "diag-item";
        const heading = document.createElement("h3");
        heading.textContent = `${longer.from} ⊃ ${shorter.from}`;
        const body = document.createElement("div");
        body.className = "diag-occurrence";

        const longerLine = document.createElement("div");
        longerLine.appendChild(createJumpButton("長い方へ移動", longer));
        longerLine.append(` ${longer.pathText} -> ${longer.to}`);

        const shorterLine = document.createElement("div");
        shorterLine.appendChild(createJumpButton("短い方へ移動", shorter));
        shorterLine.append(` ${shorter.pathText} -> ${shorter.to}`);

        body.append(longerLine, shorterLine);
        item.append(heading, body);
        return item;
      }
    ));

    diagnosticsRoot.appendChild(renderIssueCard(
      "重複したグループ名",
      diagnostics.duplicateNodeLabelIssues,
      "重複はありません。",
      ([, paths]) => {
        const item = document.createElement("div");
        item.className = "diag-item";
        const heading = document.createElement("h3");
        heading.textContent = paths[0].split(" / ").slice(-1)[0];
        const body = document.createElement("div");
        body.className = "diag-occurrence";
        for (const pathText of paths) {
          const targetNode = state.roots
            .flatMap((root) => {
              const matches = [];
              walkNodes([root], (node, trail) => {
                if (getNodePathText(trail) === pathText) {
                  matches.push(node);
                }
              });
              return matches;
            })[0];
          const line = document.createElement("div");
          if (targetNode) {
            line.appendChild(createJumpButton("移動", { nodeId: targetNode.id, rootId: targetNode.id }));
            line.append(` ${pathText}`);
          } else {
            line.textContent = pathText;
          }
          body.appendChild(line);
        }
        item.append(heading, body);
        return item;
      }
    ));
  };

  const renderTokenizerResult = (tokens) => {
    tokenizerResult.textContent = "";
    tokens.forEach((token) => {
      const row = document.createElement("tr");
      const cells = [
        token.surface_form ?? "",
        token.basic_form ?? "",
        token.pos ?? "",
        token.pos_detail_1 ?? "",
        token.conjugated_form ?? "",
        token.conjugated_type ?? "",
        token.reading ?? ""
      ];
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        row.appendChild(td);
      }
      tokenizerResult.appendChild(row);
    });
  };

  const runTokenizerTest = async () => {
    if (!state.tokenizer) {
      state.tokenizer = await buildTokenizer();
    }

    const text = tokenizerInput.value ?? "";
    const tokens = state.tokenizer.tokenize(text);
    renderTokenizerResult(tokens);
    setStatus(`形態素 ${tokens.length} 件を解析しました。`, "success");
  };

  const renderTabState = () => {
    const bundlesActive = state.activeTab === "bundles";
    const diagnosticsActive = state.activeTab === "diagnostics";
    const tokenizerActive = state.activeTab === "tokenizer";
    panelBundles.hidden = !bundlesActive;
    panelDiagnostics.hidden = !diagnosticsActive;
    panelTokenizer.hidden = !tokenizerActive;
    tabBundlesButton.setAttribute("aria-selected", bundlesActive ? "true" : "false");
    tabDiagnosticsButton.setAttribute("aria-selected", diagnosticsActive ? "true" : "false");
    tabTokenizerButton.setAttribute("aria-selected", tokenizerActive ? "true" : "false");
    tabBundlesButton.className = bundlesActive ? "tab-button secondary" : "tab-button ghost";
    tabDiagnosticsButton.className = diagnosticsActive ? "tab-button secondary" : "tab-button ghost";
    tabTokenizerButton.className = tokenizerActive ? "tab-button secondary" : "tab-button ghost";
  };

  const renderBundles = () => {
    bundleRoot.textContent = "";
    state.roots.forEach((root, index) => {
      bundleRoot.appendChild(renderNodeSection({
        node: root,
        parentChildren: state.roots,
        index,
        depth: 0,
        isRoot: true
      }));
    });
  };

  const renderApp = () => {
    renderBundles();
    renderDiagnostics();
    renderTabState();
  };

  const exportSettingsAsJson = () => {
    downloadText("transform-settings.json", `${JSON.stringify(buildPayload(), null, 2)}\n`, "application/json");
    setStatus("JSON を書き出しました。", "success");
  };

  const exportSettingsAsYaml = () => {
    downloadText("transform-settings.yaml", `${serializeYamlObject(buildPayload())}\n`, "text/yaml");
    setStatus("YAML を書き出しました。", "success");
  };

  const importSettingsFromText = async (text, fileName) => {
    let parsed;
    try {
      parsed = JSON5.parse(text);
    } catch (jsonError) {
      try {
        parsed = parseYamlDocument(text);
      } catch (yamlError) {
        throw new Error(`髫ｱ・ｭ髴趣ｽｼ邵ｺ・ｫ陞滂ｽｱ隰ｨ蜉ｱ・邵ｺ・ｾ邵ｺ蜉ｱ笳・ ${yamlError.message}`);
      }
    }

    const importedRoots = normalizeImportedRoots(parsed);
    state.roots = importedRoots;
    renderApp();
    setStatus(`${fileName} を読み込みました。`, "success");
  };

  const initialize = async () => {
    const bundleManifest = await loadJson5Resource(TRANSFORM_BUNDLES_PATH);
    const manifestBundles = Array.isArray(bundleManifest?.bundles)
      ? bundleManifest.bundles
          .filter((bundle) => bundle?.id)
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      : [];

    const baseRoots = [];
    for (const bundle of manifestBundles) {
      if (!bundle.path) {
        continue;
      }
      const definition = await loadJson5Resource(bundle.path);
      baseRoots.push(normalizeManifestDefinition(bundle, definition));
    }

    const storedPayload = await storageGet(STORAGE_KEY);
    let currentRoots = cloneValue(baseRoots);
    if (storedPayload) {
      const importedRoots = normalizeImportedRoots(storedPayload);
      const importedById = new Map(importedRoots.map((root) => [root.id, root]));

      currentRoots = baseRoots.map((baseRoot) => {
        return cloneValue(importedById.get(baseRoot.id) ?? baseRoot);
      });

      for (const importedRoot of importedRoots) {
        if (!baseRoots.some((baseRoot) => baseRoot.id === importedRoot.id)) {
          currentRoots.push(cloneValue(importedRoot));
        }
      }
    }

    state.baseRoots = cloneValue(baseRoots);
    state.roots = currentRoots;
    renderApp();
    setStatus("設定を読み込みました。", "info");
  };

  tabBundlesButton.addEventListener("click", () => {
    state.activeTab = "bundles";
    renderTabState();
  });

  tabDiagnosticsButton.addEventListener("click", () => {
    state.activeTab = "diagnostics";
    renderTabState();
  });

  tabTokenizerButton.addEventListener("click", async () => {
    state.activeTab = "tokenizer";
    renderTabState();
    try {
      await runTokenizerTest();
    } catch (error) {
      console.error(error);
      setStatus(`形態素解析に失敗しました: ${error.message}`, "error");
    }
  });

  saveAllButton.addEventListener("click", async () => {
    try {
      await saveAll();
    } catch (error) {
      console.error(error);
      setStatus(`保存に失敗しました: ${error.message}`, "error");
    }
  });

  addBundleButton.addEventListener("click", () => {
    state.roots.push(normalizeNode({
      id: createNodeId(),
      label: "Bundle",
      enabled: true,
      entries: [],
      children: []
    }, "bundle", "Bundle"));
    renderApp();
    setStatus("Bundle を追加しました。", "info");
  });

  reloadDefaultsButton.addEventListener("click", () => {
    reloadDefaults();
  });

  importSettingsButton.addEventListener("click", () => {
    importFileInput.value = "";
    importFileInput.click();
  });

  importFileInput.addEventListener("change", async () => {
    const file = importFileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      await importSettingsFromText(await file.text(), file.name);
    } catch (error) {
      console.error(error);
      setStatus(error.message, "error");
    }
  });

  exportJsonButton.addEventListener("click", () => {
    try {
      exportSettingsAsJson();
    } catch (error) {
      console.error(error);
      setStatus(`JSON 書き出しに失敗しました: ${error.message}`, "error");
    }
  });

  exportYamlButton.addEventListener("click", () => {
    try {
      exportSettingsAsYaml();
    } catch (error) {
      console.error(error);
      setStatus(`YAML 書き出しに失敗しました: ${error.message}`, "error");
    }
  });

  tokenizerRunButton.addEventListener("click", async () => {
    try {
      await runTokenizerTest();
    } catch (error) {
      console.error(error);
      setStatus(`形態素解析に失敗しました: ${error.message}`, "error");
    }
  });

  initialize().catch((error) => {
    console.error(error);
    setStatus(`初期化に失敗しました: ${error.message}`, "error");
  });
})();

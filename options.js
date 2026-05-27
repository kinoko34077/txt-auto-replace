(() => {
  "use strict";

  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const STORAGE_KEY = "bundleOverrideSettingsV1";

  const state = {
    activeTab: "bundles",
    roots: [],
    baseRoots: [],
    nodeSerial: 0,
    entrySerial: 0
  };

  const bundleRoot = document.getElementById("bundle-root");
  const diagnosticsRoot = document.getElementById("diagnostics-root");
  const panelBundles = document.getElementById("panel-bundles");
  const panelDiagnostics = document.getElementById("panel-diagnostics");
  const tabBundlesButton = document.getElementById("tab-bundles");
  const tabDiagnosticsButton = document.getElementById("tab-diagnostics");
  const statusNode = document.getElementById("status");
  const saveAllButton = document.getElementById("save-all");
  const addBundleButton = document.getElementById("add-bundle");
  const reloadDefaultsButton = document.getElementById("reload-defaults");
  const importSettingsButton = document.getElementById("import-settings");
  const exportJsonButton = document.getElementById("export-json");
  const exportYamlButton = document.getElementById("export-yaml");
  const importFileInput = document.getElementById("import-file");

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
      throw new Error(`${path} の読込に失敗しました: ${response.status}`);
    }

    return JSON5.parse(await response.text());
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

    throw new Error(`YAML の行を解釈できません: ${text}`);
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

  const normalizeNode = (source, fallbackId = "group", fallbackLabel = "Group") => {
    const childrenSource = Array.isArray(source?.children) && source.children.length > 0
      ? source.children
      : Array.isArray(source?.groups) && source.groups.length > 0
        ? source.groups
        : [];

    return {
      id: `${source?.id ?? createNodeId()}`.trim() || fallbackId,
      label: `${source?.label ?? fallbackLabel}`.trim() || fallbackLabel,
      kind: `${source?.kind ?? "dictionary-rules"}`.trim() || "dictionary-rules",
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
      throw new Error(`${bundle.id} の定義が不正です`);
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

    throw new Error("読込データから roots を取得できません");
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
    setStatus("既定値を読み直しました。保存すると反映されます。", "info");
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
    setStatus("Bundle を初期状態へ戻しました。", "info");
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

  const renderEntryTable = (node) => {
    const wrapper = document.createElement("div");
    wrapper.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = "置換";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `選択 ${getSelectedCount(node.entries)} 件 / 全 ${node.entries.length} 件`;
    head.append(title, count);

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th class="check-col"></th>
        <th class="check-col">有効</th>
        <th class="check-col">正規表現</th>
        <th>変更前</th>
        <th>変更後</th>
        <th>優先</th>
        <th>操作</th>
      </tr>
    `;

    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.setAttribute("aria-label", "この表を全選択");
    thead.querySelector("th").appendChild(selectAll);

    const tbody = document.createElement("tbody");
    node.entries.forEach((entry, entryIndex) => {
      const row = document.createElement("tr");
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
      actionTd.appendChild(createButton(entry.metaOpen ? "閉じる" : "条件", "ghost", () => {
        entry.metaOpen = !entry.metaOpen;
        renderApp();
      }));
      actionTd.appendChild(createButton("削除", "danger row-delete", () => {
        node.entries.splice(entryIndex, 1);
        renderApp();
      }));

      row.append(checkTd, enabledTd, regexTd, fromTd, toTd, priorityTd, actionTd);
      tbody.appendChild(row);

      if (entry.metaOpen) {
        const detailRow = document.createElement("tr");
        const detailCell = document.createElement("td");
        detailCell.colSpan = 7;

        const detailWrap = document.createElement("div");
        detailWrap.className = "panel-block";

        const detailHead = document.createElement("div");
        detailHead.className = "panel-head";
        const detailTitle = document.createElement("h4");
        detailTitle.textContent = "条件";
        const detailHint = document.createElement("span");
        detailHint.className = "count";
        detailHint.textContent = "JSON5 風入力可。空欄で無効。";
        detailHead.append(detailTitle, detailHint);

        const detailGrid = document.createElement("div");
        detailGrid.style.display = "grid";
        detailGrid.style.gap = "6px";
        detailGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";

        const makeConditionField = (labelText, value, onInput) => {
          const label = document.createElement("label");
          label.style.display = "grid";
          label.style.gap = "4px";

          const caption = document.createElement("span");
          caption.className = "count";
          caption.textContent = labelText;

          const input = createCompactInput(value, {
            type: "text",
            min: 8,
            max: 40,
            className: "cell-input"
          });
          input.style.width = "100%";
          input.addEventListener("input", () => {
            try {
              onInput(input.value);
              setStatus("条件を更新しました。", "info");
            } catch (error) {
              setStatus(error.message, "error");
            }
          });

          label.append(caption, input);
          return label;
        };

        const conditions = entry.conditions ?? {};
        detailGrid.appendChild(makeConditionField("前", formatConditionText(conditions.prev), (value) => {
          const nextConditions = { ...(entry.conditions ?? {}) };
          nextConditions.prev = parseConditionText(value);
          entry.conditions = nextConditions;
          renderDiagnostics();
        }));
        detailGrid.appendChild(makeConditionField("現", formatConditionText(conditions.current), (value) => {
          const nextConditions = { ...(entry.conditions ?? {}) };
          nextConditions.current = parseConditionText(value);
          entry.conditions = nextConditions;
          renderDiagnostics();
        }));
        detailGrid.appendChild(makeConditionField("後", formatConditionText(conditions.next), (value) => {
          const nextConditions = { ...(entry.conditions ?? {}) };
          nextConditions.next = parseConditionText(value);
          entry.conditions = nextConditions;
          renderDiagnostics();
        }));
        detailGrid.appendChild(makeConditionField("sequence", formatSequenceText(entry.sequence), (value) => {
          entry.sequence = parseSequenceText(value);
          renderDiagnostics();
        }));

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

  const renderNodeSection = ({ node, parentChildren, index, depth = 0, isRoot = false }) => {
    const card = document.createElement("section");
    card.className = isRoot ? "bundle-card" : "group-card";

    const header = document.createElement("div");
    header.className = isRoot ? "bundle-head" : "group-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = isRoot ? "bundle-title" : "group-title";
    titleWrap.appendChild(createEditableTitle(isRoot ? "h2" : "h3", node, isRoot ? "Bundle" : "Group", renderApp));

    const entryChip = document.createElement("span");
    entryChip.className = "chip";
    entryChip.textContent = `置換 ${node.entries.length}`;
    const childChip = document.createElement("span");
    childChip.className = "chip";
    childChip.textContent = `子箱 ${node.children.length}`;
    const kindChip = document.createElement("span");
    kindChip.className = "chip";
    kindChip.textContent = node.kind === "token-rules" ? "token" : "dictionary";
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
      card.appendChild(renderEntryTable(node));
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
          isRoot: false
        }));
      });
      card.appendChild(childrenWrap);
    }

    return card;
  };

  const collectDiagnostics = () => {
    const duplicateFromMap = new Map();
    const duplicateNodeLabelMap = new Map();

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
          pathText,
          to: entry.to,
          priority: entry.priority,
          regex: entry.regex === true
        });
      }
    });

    return {
      duplicateFromIssues: [...duplicateFromMap.entries()].filter(([, entries]) => entries.length > 1),
      duplicateNodeLabelIssues: [...duplicateNodeLabelMap.entries()].filter(([, entries]) => entries.length > 1)
    };
  };

  const renderIssueCard = (title, issues, emptyText, renderRow) => {
    const card = document.createElement("section");
    card.className = "diagnostics-card";

    const heading = document.createElement("h2");
    heading.textContent = title;
    card.appendChild(heading);

    const summary = document.createElement("p");
    summary.className = "diag-summary";
    summary.textContent = issues.length === 0 ? emptyText : `${issues.length} 件の候補があります。`;
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
      "重複した変更前はありません。",
      ([entryKey, occurrences]) => {
        const item = document.createElement("div");
        item.className = "diag-item";
        const heading = document.createElement("h3");
        const [mode, from] = entryKey.split(":");
        heading.textContent = `${from} (${mode === "regex" ? "regex" : "plain"})`;
        const body = document.createElement("div");
        body.className = "diag-occurrence";
        body.innerHTML = occurrences.map((occurrence) => {
          return `${occurrence.pathText} → ${occurrence.to} / priority ${occurrence.priority}`;
        }).join("<br>");
        item.append(heading, body);
        return item;
      }
    ));

    diagnosticsRoot.appendChild(renderIssueCard(
      "同名の箱",
      diagnostics.duplicateNodeLabelIssues,
      "同じ名前の箱はありません。",
      ([, paths]) => {
        const item = document.createElement("div");
        item.className = "diag-item";
        const heading = document.createElement("h3");
        heading.textContent = paths[0].split(" / ").slice(-1)[0];
        const body = document.createElement("div");
        body.className = "diag-occurrence";
        body.innerHTML = paths.join("<br>");
        item.append(heading, body);
        return item;
      }
    ));
  };

  const renderTabState = () => {
    const bundlesActive = state.activeTab === "bundles";
    panelBundles.hidden = !bundlesActive;
    panelDiagnostics.hidden = bundlesActive;
    tabBundlesButton.setAttribute("aria-selected", bundlesActive ? "true" : "false");
    tabDiagnosticsButton.setAttribute("aria-selected", bundlesActive ? "false" : "true");
    tabBundlesButton.className = bundlesActive ? "tab-button secondary" : "tab-button ghost";
    tabDiagnosticsButton.className = bundlesActive ? "tab-button ghost" : "tab-button secondary";
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
        throw new Error(`読込に失敗しました: ${yamlError.message}`);
      }
    }

    const importedRoots = normalizeImportedRoots(parsed);
    state.roots = importedRoots;
    renderApp();
    setStatus(`${fileName} を読み込みました。保存すると反映されます。`, "success");
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
      setStatus(`JSON 書出に失敗しました: ${error.message}`, "error");
    }
  });

  exportYamlButton.addEventListener("click", () => {
    try {
      exportSettingsAsYaml();
    } catch (error) {
      console.error(error);
      setStatus(`YAML 書出に失敗しました: ${error.message}`, "error");
    }
  });

  initialize().catch((error) => {
    console.error(error);
    setStatus(`初期化に失敗しました: ${error.message}`, "error");
  });
})();

(() => {
  "use strict";

  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const STORAGE_KEY = "bundleOverrideSettingsV1";
  const DIAGNOSTIC_UI_STATE_KEY = "diagnosticUiStateV1";
  const BUNDLE_UI_STATE_KEY = "bundleOptionsUiStateV1";
  const DICT_PATH = "./dict/";
  const DEFAULT_POPUP_BUNDLE_ID = "popup-quick-replacements";
  const MESSAGE_TYPES = {
    APPLY_SETTINGS_UPDATE: "APPLY_SETTINGS_UPDATE",
    OPEN_SHORTCUTS_PAGE: "OPEN_SHORTCUTS_PAGE"
  };
  const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
    skipEditableInputs: false,
    globalEnabled: true
  });
  const DEFAULT_DISABLED_SITES = Object.freeze({
    domains: []
  });
  const UiStrings = globalThis.ExtensionUiStrings;
  const TransformShared = globalThis.TransformShared;
  const TransformEngine = globalThis.TransformEngine;

  const state = {
    activeTab: "bundles",
    roots: [],
    baseRoots: [],
    runtimeSettings: { ...DEFAULT_RUNTIME_SETTINGS },
    disabledSites: { ...DEFAULT_DISABLED_SITES },
    popupBundleId: DEFAULT_POPUP_BUNDLE_ID,
    nodeSerial: 0,
    entrySerial: 0,
    collapsedNodes: {},
    tokenizer: null,
    dismissedDiagnostics: {},
    dismissedDiagnosticsCollapsed: true,
    commands: [],
    clipboard: null,
    focusedNodeId: null,
    dragPayload: null,
    undoAction: null,
    tableUi: {},
    bundleUi: {
      selectedNodeId: "__all__",
      expandedTreeIds: {},
      searchText: ""
    }
  };

  const bundleRoot = document.getElementById("bundle-root");
  const diagnosticsRoot = document.getElementById("diagnostics-root");
  const hotkeysRoot = document.getElementById("hotkeys-root");
  const sitesRoot = document.getElementById("sites-root");
  const panelBundles = document.getElementById("panel-bundles");
  const panelDiagnostics = document.getElementById("panel-diagnostics");
  const panelTokenizer = document.getElementById("panel-tokenizer");
  const panelHotkeys = document.getElementById("panel-hotkeys");
  const panelSites = document.getElementById("panel-sites");
  const tabBundlesButton = document.getElementById("tab-bundles");
  const tabDiagnosticsButton = document.getElementById("tab-diagnostics");
  const tabTokenizerButton = document.getElementById("tab-tokenizer");
  const tabHotkeysButton = document.getElementById("tab-hotkeys");
  const tabSitesButton = document.getElementById("tab-sites");
  const statusNode = document.getElementById("status");
  const saveAllButton = document.getElementById("save-all");
  const addBundleButton = document.getElementById("add-bundle");
  const reloadDefaultsButton = document.getElementById("reload-defaults");
  const importSettingsButton = document.getElementById("import-settings");
  const exportJsonButton = document.getElementById("export-json");
  const exportYamlButton = document.getElementById("export-yaml");
  const importFileInput = document.getElementById("import-file");
  const runtimeGlobalEnabledInput = document.getElementById("runtime-global-enabled");
  const runtimeSkipEditableInput = document.getElementById("runtime-skip-editable");
  const tokenizerInput = document.getElementById("tokenizer-input");
  const tokenizerRunButton = document.getElementById("tokenizer-run");
  const tokenizerResult = document.getElementById("tokenizer-result");
  const openShortcutsButton = document.getElementById("open-shortcuts");
  const addCurrentSiteButton = document.getElementById("add-current-site");

  const t = (path, params) => {
    return typeof UiStrings?.get === "function"
      ? UiStrings.get(path, params)
      : `${path ?? ""}`;
  };

  const uiText = (value, params) => {
    return typeof UiStrings?.resolve === "function"
      ? UiStrings.resolve(value, params)
      : value;
  };

  const normalizeUiTree = (root = document.body) => {
    if (!root) {
      return;
    }

    const normalizeAttributes = (element) => {
      ["title", "placeholder", "aria-label"].forEach((attributeName) => {
        const currentValue = element.getAttribute(attributeName);
        if (!currentValue) {
          return;
        }
        const nextValue = uiText(currentValue);
        if (nextValue !== currentValue) {
          element.setAttribute(attributeName, nextValue);
        }
      });
    };

    if (root.nodeType === Node.ELEMENT_NODE) {
      normalizeAttributes(root);
    } else if (root.nodeType === Node.TEXT_NODE) {
      const nextValue = uiText(root.textContent);
      if (nextValue !== root.textContent) {
        root.textContent = nextValue;
      }
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let current = walker.currentNode;
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        const nextValue = uiText(current.textContent);
        if (nextValue !== current.textContent) {
          current.textContent = nextValue;
        }
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        normalizeAttributes(current);
      }
      current = walker.nextNode();
    }
  };

  const setStatus = (message, type = "info") => {
    statusNode.textContent = uiText(message);
    statusNode.dataset.type = type;
  };

  const cloneValue = (value) => JSON.parse(JSON.stringify(value));

  const fallbackSplitCommaSeparatedValues = (value) => {
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => fallbackSplitCommaSeparatedValues(item))
        .filter(Boolean);
    }

    const normalized = `${value ?? ""}`.trim();
    if (!normalized) {
      return [];
    }

    const ESCAPE_SENTINEL = "\u0000";
    const tokenizeEscapes = (text) => {
      let output = "";
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === "\\" && index + 1 < text.length) {
          const next = text[index + 1];
          if (next === "[" || next === "]" || next === "," || next === "\\") {
            output += `${ESCAPE_SENTINEL}${next}`;
            index += 1;
            continue;
          }
        }
        output += char;
      }
      return output;
    };
    const unescapeText = (text) => {
      return text
        .replaceAll(`${ESCAPE_SENTINEL}[`, "[")
        .replaceAll(`${ESCAPE_SENTINEL}]`, "]")
        .replaceAll(`${ESCAPE_SENTINEL},`, ",")
        .replaceAll(`${ESCAPE_SENTINEL}\\`, "\\");
    };
    const splitTopLevel = (text) => {
      const parts = [];
      let current = "";
      let depth = 0;
      for (const char of tokenizeEscapes(text)) {
        if (char === "[") {
          depth += 1;
        } else if (char === "]") {
          depth = Math.max(0, depth - 1);
        } else if (char === "," && depth === 0 && current[current.length - 1] !== ESCAPE_SENTINEL) {
          parts.push(current.trim());
          current = "";
          continue;
        }
        current += char;
      }
      if (current || text.endsWith(",")) {
        parts.push(current.trim());
      }
      return parts.filter(Boolean);
    };
    const expand = (text) => {
      const source = tokenizeEscapes(text.trim());
      if (!source) {
        return [""];
      }
      let openIndex = -1;
      for (let index = 0; index < source.length; index += 1) {
        if (source[index] === "[" && source[index - 1] !== ESCAPE_SENTINEL) {
          openIndex = index;
          break;
        }
      }
      if (openIndex < 0) {
        return [source];
      }
      let depth = 0;
      let closeIndex = -1;
      for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        if (char === "[" && source[index - 1] !== ESCAPE_SENTINEL) {
          depth += 1;
        } else if (char === "]" && source[index - 1] !== ESCAPE_SENTINEL) {
          depth -= 1;
          if (depth === 0) {
            closeIndex = index;
            break;
          }
        }
      }
      if (closeIndex < 0) {
        return [unescapeText(source)];
      }
      const prefix = source.slice(0, openIndex);
      const inner = source.slice(openIndex + 1, closeIndex);
      const suffix = source.slice(closeIndex + 1);
      return splitTopLevel(inner).flatMap((branch) => expand(`${prefix}${branch}${suffix}`));
    };

    return splitTopLevel(normalized)
      .flatMap((item) => expand(item))
      .map((item) => unescapeText(item.trim()))
      .filter(Boolean);
  };

  const splitCommaSeparatedValues = typeof TransformShared?.splitCommaSeparatedValues === "function"
    ? TransformShared.splitCommaSeparatedValues
    : fallbackSplitCommaSeparatedValues;
  const splitDelimitedRow = typeof TransformShared?.splitDelimitedRow === "function"
    ? TransformShared.splitDelimitedRow
    : (line, delimiter = ",") => `${line ?? ""}`.split(delimiter).map((cell) => `${cell ?? ""}`.trim());
  const splitMatchCandidates = typeof TransformShared?.splitMatchCandidates === "function"
    ? TransformShared.splitMatchCandidates
    : splitCommaSeparatedValues;
  const splitReplacementCandidates = typeof TransformShared?.splitReplacementCandidates === "function"
    ? TransformShared.splitReplacementCandidates
    : splitCommaSeparatedValues;

  const normalizeFromOptions = (value, fallbackValue = "") => {
    const candidates = splitMatchCandidates(value);
    if (candidates.length > 0) {
      return [...new Set(candidates)];
    }

    const fallback = `${fallbackValue ?? ""}`.trim();
    return fallback ? [fallback] : [];
  };

  const stringifyFromOptions = (value, fallbackValue = "") => {
    return normalizeFromOptions(value, fallbackValue).join(",");
  };

  const listifyValue = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => `${item ?? ""}`.trim())
        .filter(Boolean);
    }
    const normalized = `${value ?? ""}`.trim();
    return normalized ? [normalized] : [];
  };

  const getCurrentConditions = (entry) => {
    return Array.isArray(entry?.conditions?.current)
      ? entry.conditions.current
      : entry?.conditions?.current
        ? [entry.conditions.current]
        : [];
  };

  const inferEntryType = (entry) => {
    if (typeof entry?.type === "string" && entry.type.trim()) {
      return entry.type.trim();
    }

    const currentConditions = getCurrentConditions(entry);
    const hasCurrentPos = (expected) => {
      return currentConditions.some((condition) => {
        return listifyValue(condition?.pos).includes(expected);
      });
    };

    if (hasCurrentPos("動詞")) {
      return "verb";
    }
    if (hasCurrentPos("形容詞")) {
      return "adjective";
    }

    return null;
  };

  const getEffectiveEntryMatchTarget = (entry, inferredType = inferEntryType(entry)) => {
    if (entry?.match_target !== undefined && entry.match_target !== null) {
      return entry.match_target;
    }

    return inferredType === "verb" || inferredType === "adjective"
      ? "basic_form"
      : null;
  };

  const normalizeRuntimeSettings = (value) => {
    return {
      skipEditableInputs: value?.skipEditableInputs === true,
      globalEnabled: value?.globalEnabled !== false
    };
  };

  const extractRuntimeSettings = (payload) => {
    if (!payload || typeof payload !== "object") {
      return { ...DEFAULT_RUNTIME_SETTINGS };
    }

    return normalizeRuntimeSettings(
      payload.runtime_settings ?? payload?.[STORAGE_KEY]?.runtime_settings
    );
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

  const extractDisabledSites = (payload) => {
    if (!payload || typeof payload !== "object") {
      return { ...DEFAULT_DISABLED_SITES };
    }

    return normalizeDisabledSites(
      payload.disabled_sites ?? payload?.[STORAGE_KEY]?.disabled_sites
    );
  };

  const extractPopupBundleId = (payload) => {
    const popupBundleId = `${payload?.popup_bundle_id ?? payload?.[STORAGE_KEY]?.popup_bundle_id ?? DEFAULT_POPUP_BUNDLE_ID}`.trim();
    return popupBundleId || DEFAULT_POPUP_BUNDLE_ID;
  };

  const getCollapsedNodes = () => {
    return state.collapsedNodes ?? {};
  };

  const isNodeCollapsed = (nodeId) => {
    return Boolean(getCollapsedNodes()[nodeId]);
  };

  const setNodeCollapsed = (nodeId, collapsed) => {
    state.collapsedNodes = {
      ...getCollapsedNodes(),
      [nodeId]: collapsed === true
    };
    saveDiagnosticUiState();
  };

  const getDismissedDiagnostics = () => {
    return state.dismissedDiagnostics ?? {};
  };

  const isDiagnosticDismissed = (issueId) => {
    return Boolean(getDismissedDiagnostics()[issueId]);
  };

  const dismissDiagnostic = (issueId, label) => {
    state.dismissedDiagnostics = {
      ...getDismissedDiagnostics(),
      [issueId]: label
    };
    saveDiagnosticUiState();
  };

  const restoreDiagnostic = (issueId) => {
    const next = { ...getDismissedDiagnostics() };
    delete next[issueId];
    state.dismissedDiagnostics = next;
    saveDiagnosticUiState();
  };

  const restoreAllDiagnostics = () => {
    state.dismissedDiagnostics = {};
    saveDiagnosticUiState();
  };

  const saveDiagnosticUiState = () => {
    storageSet({
      [DIAGNOSTIC_UI_STATE_KEY]: {
        dismissedDiagnostics: getDismissedDiagnostics(),
        collapsed: state.dismissedDiagnosticsCollapsed !== false,
        collapsedNodes: getCollapsedNodes()
      }
    }).catch((error) => {
      console.error("險ｺ譁ｭ UI 迥ｶ諷九・菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆", error);
    });
  };

  const normalizeBundleUiState = (value) => {
    return {
      selectedNodeId: `${value?.selectedNodeId ?? "__all__"}` || "__all__",
      expandedTreeIds: value?.expandedTreeIds && typeof value.expandedTreeIds === "object" ? value.expandedTreeIds : {},
      searchText: `${value?.searchText ?? ""}`
    };
  };

  const saveBundleUiState = () => {
    storageSet({
      [BUNDLE_UI_STATE_KEY]: {
        selectedNodeId: state.bundleUi.selectedNodeId,
        expandedTreeIds: state.bundleUi.expandedTreeIds,
        searchText: state.bundleUi.searchText
      }
    }).catch((error) => {
      console.error("bundle UI state save failed", error);
    });
  };

  const CURRENT_CONDITION_FIELDS = ["surface", "basic", "pos", "pos1", "cform", "ctype"];

  const createEmptyCurrentBulkDraft = () => ({
    surface: "",
    basic: "",
    pos: "",
    pos1: "",
    cform: "",
    ctype: ""
  });

  const getTableUiState = (nodeId) => {
    const key = `${nodeId ?? ""}`.trim();
    if (!key) {
      return {
        sort: { key: null, direction: null },
        bulkImportDelimiter: "",
        currentBulkDraft: createEmptyCurrentBulkDraft()
      };
    }
    if (!state.tableUi[key]) {
      state.tableUi[key] = {
        sort: { key: null, direction: null },
        bulkImportDelimiter: "",
        currentBulkDraft: createEmptyCurrentBulkDraft()
      };
    }
    return state.tableUi[key];
  };

  const getTableSortState = (nodeId) => getTableUiState(nodeId).sort;
  const getTableBulkDelimiter = (nodeId) => getTableUiState(nodeId).bulkImportDelimiter ?? "";
  const getTableCurrentBulkDraft = (nodeId) => getTableUiState(nodeId).currentBulkDraft ?? createEmptyCurrentBulkDraft();

  const setTableSortState = (nodeId, key, direction) => {
    const tableUi = getTableUiState(nodeId);
    tableUi.sort = { key: key ?? null, direction: direction ?? null };
  };

  const setTableBulkDelimiter = (nodeId, value) => {
    getTableUiState(nodeId).bulkImportDelimiter = `${value ?? ""}`;
  };

  const updateTableCurrentBulkDraft = (nodeId, field, value) => {
    const tableUi = getTableUiState(nodeId);
    tableUi.currentBulkDraft = {
      ...createEmptyCurrentBulkDraft(),
      ...(tableUi.currentBulkDraft ?? {}),
      [field]: `${value ?? ""}`
    };
  };

  const resetTableCurrentBulkDraft = (nodeId) => {
    getTableUiState(nodeId).currentBulkDraft = createEmptyCurrentBulkDraft();
  };

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

  const sendRuntimeMessage = async (message) => {
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

  const getAllCommands = async () => {
    if (!chrome?.commands?.getAll) {
      return [];
    }

    return new Promise((resolve, reject) => {
      chrome.commands.getAll((commands) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(commands ?? []);
      });
    });
  };

  const getActiveTab = async () => {
    if (!chrome?.tabs?.query) {
      return null;
    }

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    return tabs[0] ?? null;
  };

  const sendMessageToTab = async (tabId, message) => {
    if (!chrome?.tabs?.sendMessage || typeof tabId !== "number") {
      return null;
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(response ?? null);
      });
    });
  };

  const notifyRuntimeSettingsApplied = async () => {
    await sendRuntimeMessage({
      type: MESSAGE_TYPES.APPLY_SETTINGS_UPDATE
    });
  };

  const loadJson5Resource = async (path) => {
    const url = chrome.runtime.getURL(path) + `?t=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path} 驍ｵ・ｺ繝ｻ・ｮ鬮ｫ・ｱ繝ｻ・ｭ鬮ｴ雜｣・ｽ・ｼ驍ｵ・ｺ繝ｻ・ｫ髯樊ｻゑｽｽ・ｱ髫ｰ・ｨ陷会ｽｱ繝ｻ・ｰ驍ｵ・ｺ繝ｻ・ｾ驍ｵ・ｺ陷会ｽｱ隨ｳ繝ｻ ${response.status}`);
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
          throw new Error(`鬮ｴ蜿厄ｽｨ髮・ｽｶ讙趣ｽｹ譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・､驛｢譎｢・ｽ・ｫ髯ｷ・ｿ鬮｢ﾂ繝ｻ・ｾ隲､諛ｶ・ｽ・､繝ｻ・ｱ髫ｰ・ｨ郢晢ｽｻ ${response.status} ${url}`);
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

  const parseBooleanLike = (value, fallback = false) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    const normalized = `${value ?? ""}`.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    if (["1", "true", "yes", "on", "enabled", "enable", "有効", "譛牙柑"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "disabled", "disable", "無効", "辟｡蜉ｹ"].includes(normalized)) {
      return false;
    }
    return fallback;
  };

  const parseDelimitedRow = (line, delimiter) => {
    return splitDelimitedRow(line, delimiter).map((cell) => `${cell ?? ""}`.trim());
  };

  const normalizeBulkDelimiterValue = (value, fallback = ",") => {
    const normalized = `${value ?? ""}`.trim();
    if (!normalized) {
      return fallback;
    }
    if (normalized === "\\t") {
      return "\t";
    }
    return normalized;
  };

  const detectBulkImportDelimiter = (line, preferredDelimiter = "") => {
    const explicit = normalizeBulkDelimiterValue(preferredDelimiter, "");
    if (explicit) {
      return explicit;
    }
    const source = `${line ?? ""}`;
    const candidates = ["\t", "|", ";", ","];
    return candidates.find((candidate) => source.includes(candidate)) ?? ",";
  };

  const normalizeBulkFieldName = (value) => {
    return `${value ?? ""}`.trim().toLowerCase();
  };

  const isRecognizedBulkFieldName = (fieldName) => {
    const normalized = normalizeBulkFieldName(fieldName);
    if (!normalized) {
      return false;
    }
    if (/^(prev|current|next)\.(surface|basic|pos|pos1|cform|ctype)$/.test(normalized)) {
      return true;
    }
    return [
      "enabled",
      "有効",
      "regex",
      "正規",
      "正規表現",
      "basic_match",
      "basic",
      "原形一致",
      "from",
      "変更前",
      "to",
      "変更後",
      "priority",
      "優先",
      "sequence"
    ].includes(normalized);
  };

  const createEmptyBulkEntry = () => ({
    id: createEntryId(),
    from: "",
    from_options: [],
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

  const setEntryFieldFromBulk = (entry, fieldName, rawValue, effectiveKind) => {
    const value = `${rawValue ?? ""}`.trim();
    switch (normalizeBulkFieldName(fieldName)) {
      case "enabled":
      case "有効":
      case "譛牙柑":
        entry.enabled = parseBooleanLike(value, true);
        return;
      case "regex":
      case "正規":
      case "正規表現":
      case "豁｣隕・":
      case "豁｣隕剰｡ｨ迴ｾ":
        entry.regex = parseBooleanLike(value, false);
        return;
      case "basic_match":
      case "basic":
      case "原形一致":
      case "蜴溷ｽ｢荳閾ｴ":
        entry.match_target = effectiveKind === "token-rules" && parseBooleanLike(value, false) ? "basic_form" : null;
        return;
      case "from":
      case "変更前":
      case "螟画峩蜑・":
        entry.from = value;
        entry.from_options = normalizeFromOptions(value);
        return;
      case "to":
      case "変更後":
      case "螟画峩蠕・":
        entry.to = value;
        return;
      case "priority":
      case "優先":
      case "蜆ｪ蜈・":
        entry.priority = Number.isFinite(Number(value)) ? Number(value) : 90;
        return;
      case "sequence":
        entry.sequence = parseSequenceDsl(value);
        return;
      default:
        break;
    }

    const conditionMatch = normalizeBulkFieldName(fieldName).match(/^(prev|current|next)\.(surface|basic|pos|pos1|cform|ctype)$/);
    if (conditionMatch) {
      const [, slot, field] = conditionMatch;
      setEntryConditionInlineValue(entry, slot, field, value);
    }
  };

  const applyBulkDefaults = (entry, defaults, effectiveKind) => {
    for (const [fieldName, value] of Object.entries(defaults ?? {})) {
      setEntryFieldFromBulk(entry, fieldName, value, effectiveKind);
    }
  };

  const parseBulkTableBlock = (lines, meta, effectiveKind) => {
    const delimiter = typeof meta.delimiter === "string" && meta.delimiter.length > 0
      ? meta.delimiter.replace("\\t", "\t")
      : detectBulkImportDelimiter(lines[0] ?? "");
    const rows = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseDelimitedRow(line, delimiter));
    if (rows.length === 0) {
      return [];
    }

    const headers = rows[0].map((header) => normalizeBulkFieldName(header));
    return rows.slice(1).flatMap((cells) => {
      if (cells.every((cell) => !`${cell ?? ""}`.trim())) {
        return [];
      }
      const entry = {
        id: createEntryId(),
        from: "",
        from_options: [],
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
      };
      applyBulkDefaults(entry, meta.defaults, effectiveKind);
      headers.forEach((header, index) => {
        if (header) {
          setEntryFieldFromBulk(entry, header, cells[index] ?? "", effectiveKind);
        }
      });
      if (!entry.from && Array.isArray(entry.sequence) && entry.sequence.length > 0) {
        entry.from = formatSequenceDsl(entry.sequence);
      }
      return entry.from && entry.to ? [entry] : [];
    });
  };

  const parseBulkMetadataBlock = (text, effectiveKind) => {
    const lines = `${text ?? ""}`.split(/\r?\n/);
    const meta = {
      defaults: {},
      delimiter: null
    };
    const bodyLines = [];
    let inBody = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!inBody && (!line || line === "---")) {
        inBody = true;
        continue;
      }
      if (!inBody && line.startsWith("@")) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex < 0) {
          continue;
        }
        const key = line.slice(1, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (key === "delimiter") {
          meta.delimiter = value;
        } else if (key.startsWith("defaults.")) {
          meta.defaults[key.slice("defaults.".length)] = value;
        } else {
          meta[key] = value;
        }
        continue;
      }
      inBody = true;
      if (line) {
        bodyLines.push(rawLine);
      }
    }

    if (bodyLines.length === 0) {
      return [];
    }

    return parseBulkTableBlock(bodyLines, meta, effectiveKind);
  };

  const parseBulkImportText = (text, effectiveKind) => {
    const normalizedText = `${text ?? ""}`.trim();
    if (!normalizedText) {
      return [];
    }

    if (/@(?:bundle|group|kind|delimiter|defaults\.)/m.test(normalizedText)) {
      return normalizedText
        .split(/\n\s*\n/g)
        .flatMap((block) => parseBulkMetadataBlock(block, effectiveKind));
    }

    const entries = [];
    for (const rawLine of normalizedText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) {
        continue;
      }

      let cells;
      if (line.includes("->")) {
        cells = line.split("->").map((cell) => cell.trim());
      } else if (line.includes("=>")) {
        cells = line.split("=>").map((cell) => cell.trim());
      } else if (line.includes("→")) {
        cells = line.split("→").map((cell) => cell.trim());
      } else if (line.includes("竊・")) {
        cells = line.split("竊・").map((cell) => cell.trim());
      } else {
        cells = parseDelimitedRow(line, detectBulkImportDelimiter(line));
      }

      if (cells.length < 2 || !cells[0] || !cells[1]) {
        continue;
      }

      const priority = Number(cells[2]);
      entries.push({
        id: createEntryId(),
        from: cells[0],
        from_options: normalizeFromOptions(cells[0]),
        to: cells[1],
        priority: Number.isFinite(priority) ? priority : 90,
        enabled: parseBooleanLike(cells[3], true),
        regex: parseBooleanLike(cells[4], false),
        match_target: effectiveKind === "token-rules" && parseBooleanLike(cells[5], false)
          ? "basic_form"
          : null,
        conditions: null,
        sequence: null,
        raw: null,
        metaOpen: false,
        selected: false
      });
    }

    return entries;
  };

  const setEntryFieldFromBulkV2 = (entry, fieldName, rawValue, effectiveKind) => {
    const value = `${rawValue ?? ""}`.trim();
    const normalizedFieldName = normalizeBulkFieldName(fieldName);
    switch (normalizedFieldName) {
      case "enabled":
      case "有効":
        entry.enabled = parseBooleanLike(value, true);
        return;
      case "regex":
      case "正規":
      case "正規表現":
        entry.regex = parseBooleanLike(value, false);
        return;
      case "basic_match":
      case "basic":
      case "原形一致":
        entry.match_target = effectiveKind === "token-rules" && parseBooleanLike(value, false) ? "basic_form" : null;
        return;
      case "from":
      case "変更前":
        entry.from = value;
        entry.from_options = normalizeFromOptions(value);
        return;
      case "to":
      case "変更後":
        entry.to = value;
        return;
      case "priority":
      case "優先":
        entry.priority = Number.isFinite(Number(value)) ? Number(value) : 90;
        return;
      case "sequence":
        entry.sequence = parseSequenceDsl(value);
        return;
      default:
        break;
    }

    const conditionMatch = normalizedFieldName.match(/^(prev|current|next)\.(surface|basic|pos|pos1|cform|ctype)$/);
    if (conditionMatch) {
      const [, slot, field] = conditionMatch;
      setEntryConditionInlineValue(entry, slot, field, value);
    }
  };

  const applyBulkDefaultsV2 = (entry, defaults, effectiveKind) => {
    for (const [fieldName, value] of Object.entries(defaults ?? {})) {
      setEntryFieldFromBulkV2(entry, fieldName, value, effectiveKind);
    }
  };

  const finalizeBulkEntry = (entry) => {
    if (!entry.from && Array.isArray(entry.sequence) && entry.sequence.length > 0) {
      entry.from = formatSequenceDsl(entry.sequence);
    }
    if (entry.from) {
      entry.from_options = normalizeFromOptions(entry.from_options ?? entry.from, entry.from);
    }
    return entry.from && entry.to ? entry : null;
  };

  const parseBulkRowsWithHeaders = (rows, defaults, effectiveKind) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }
    const headers = rows[0].map((header) => normalizeBulkFieldName(header));
    return rows.slice(1).flatMap((cells) => {
      if (cells.every((cell) => !`${cell ?? ""}`.trim())) {
        return [];
      }
      const entry = createEmptyBulkEntry();
      applyBulkDefaultsV2(entry, defaults, effectiveKind);
      headers.forEach((header, index) => {
        if (header) {
          setEntryFieldFromBulkV2(entry, header, cells[index] ?? "", effectiveKind);
        }
      });
      const finalized = finalizeBulkEntry(entry);
      return finalized ? [finalized] : [];
    });
  };

  const parseBulkTableBlockV2 = (lines, meta, effectiveKind, fallbackDelimiter = "") => {
    const delimiter = typeof meta?.delimiter === "string" && meta.delimiter.length > 0
      ? normalizeBulkDelimiterValue(meta.delimiter, ",")
      : detectBulkImportDelimiter(lines[0] ?? "", fallbackDelimiter);
    const rows = (Array.isArray(lines) ? lines : [])
      .map((line) => `${line ?? ""}`.trim())
      .filter(Boolean)
      .map((line) => parseDelimitedRow(line, delimiter));
    return parseBulkRowsWithHeaders(rows, meta?.defaults ?? {}, effectiveKind);
  };

  const parseBulkMetadataBlockV2 = (text, effectiveKind, fallbackDelimiter = "") => {
    const lines = `${text ?? ""}`.split(/\r?\n/);
    const meta = { defaults: {}, delimiter: null };
    const bodyLines = [];
    let inBody = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!inBody && (!line || line === "---")) {
        inBody = true;
        continue;
      }
      if (!inBody && line.startsWith("@")) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex < 0) {
          continue;
        }
        const key = line.slice(1, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (key === "delimiter") {
          meta.delimiter = value;
        } else if (key.startsWith("defaults.")) {
          meta.defaults[key.slice("defaults.".length)] = value;
        }
        continue;
      }
      inBody = true;
      if (line) {
        bodyLines.push(rawLine);
      }
    }

    return parseBulkTableBlockV2(bodyLines, meta, effectiveKind, fallbackDelimiter);
  };

  const parseBulkImportEntries = (text, effectiveKind, defaultDelimiter = "") => {
    const normalizedText = `${text ?? ""}`.trim();
    if (!normalizedText) {
      return [];
    }

    if (/@(?:bundle|group|kind|delimiter|defaults\.)/m.test(normalizedText)) {
      return normalizedText
        .split(/\n\s*\n/g)
        .flatMap((block) => parseBulkMetadataBlockV2(block, effectiveKind, defaultDelimiter));
    }

    const usableLines = normalizedText
      .split(/\r?\n/)
      .map((line) => `${line ?? ""}`.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"));
    if (usableLines.length === 0) {
      return [];
    }

    const detectedDelimiter = detectBulkImportDelimiter(usableLines[0], defaultDelimiter);
    const rows = usableLines.map((line) => parseDelimitedRow(line, detectedDelimiter));
    if ((rows[0] ?? []).some((header) => isRecognizedBulkFieldName(header))) {
      return parseBulkRowsWithHeaders(rows, {}, effectiveKind);
    }

    return usableLines.flatMap((line) => {
      let cells;
      if (line.includes("->")) {
        cells = line.split("->").map((cell) => cell.trim());
      } else if (line.includes("=>")) {
        cells = line.split("=>").map((cell) => cell.trim());
      } else {
        cells = parseDelimitedRow(line, detectedDelimiter);
      }
      if (cells.length < 2 || !cells[0] || !cells[1]) {
        return [];
      }
      const entry = createEmptyBulkEntry();
      entry.from = cells[0];
      entry.from_options = normalizeFromOptions(cells[0]);
      entry.to = cells[1];
      entry.priority = Number.isFinite(Number(cells[2])) ? Number(cells[2]) : 90;
      entry.enabled = parseBooleanLike(cells[3], true);
      entry.regex = parseBooleanLike(cells[4], false);
      entry.match_target = effectiveKind === "token-rules" && parseBooleanLike(cells[5], false)
        ? "basic_form"
        : null;
      const finalized = finalizeBulkEntry(entry);
      return finalized ? [finalized] : [];
    });
  };

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

    throw new Error(`YAML 驍ｵ・ｺ繝ｻ・ｮ鬮ｯ・ｦ陟暮ｯ会ｽｽ蟶晏專繝ｻ・｣鬯ｩ・･陋ｹ・ｻ邵ｲ蝣､・ｸ・ｺ鬮ｦ・ｪ遶擾ｽｪ驍ｵ・ｺ陝ｶ蜻ｻ・ｽ繝ｻ ${text}`);
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
    const fromOptions = normalizeFromOptions(entry.from_options ?? entry.from, sequenceLabel);
    const displayFrom = stringifyFromOptions(fromOptions, from);
    const to = `${entry.to ?? ""}`.trim();
    if (!displayFrom) {
      return null;
    }

    const inferredType = inferEntryType(entry);

    return {
      id: `${entry.id ?? createEntryId()}`,
      from: displayFrom,
      from_options: fromOptions,
      to,
      priority: Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || fallbackPriority,
      enabled: entry.enabled !== false,
      regex: entry.regex === true || entry.is_regex === true,
      type: inferredType,
      match_target: getEffectiveEntryMatchTarget(entry, inferredType),
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

  const sourceHasTokenFeatures = (source) => {
    if (Array.isArray(source?.rules)) {
      return true;
    }

    if (Array.isArray(source?.entries) && source.entries.some((entry) => {
      return entry && typeof entry === "object" && (
        entry.match_target !== undefined ||
        entry.conditions !== undefined ||
        entry.sequence !== undefined ||
        entry.type === "verb" ||
        entry.type === "adjective" ||
        entry.type === "literal" ||
        entry.type === "compound" ||
        entry.type === "renyou"
      );
    })) {
      return true;
    }

    if (Array.isArray(source?.children) && source.children.some((child) => sourceHasTokenFeatures(child))) {
      return true;
    }

    return false;
  };

  const inferBundleKind = (source) => {
    if (typeof source?.kind === "string" && source.kind.trim()) {
      return source.kind;
    }

    if (sourceHasTokenFeatures(source)) {
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
      selected: source?.selected === true,
      order: Number.isFinite(source?.order) ? source.order : Number(source?.order) || 0,
      entries: normalizeEntries(source),
      children: childrenSource.map((child, index) => {
        return normalizeNode(child, `${fallbackId}-${index + 1}`, `${fallbackLabel} ${index + 1}`);
      })
    };
  };

  const mergeImportedRootsWithBaseRoots = (importedRoots, baseRoots) => {
    const importedById = new Map(importedRoots.map((root) => [root.id, root]));
    const mergedRoots = baseRoots.map((baseRoot) => {
      return cloneValue(importedById.get(baseRoot.id) ?? baseRoot);
    });

    for (const importedRoot of importedRoots) {
      if (!baseRoots.some((baseRoot) => baseRoot.id === importedRoot.id)) {
        mergedRoots.push(cloneValue(importedRoot));
      }
    }

    return mergedRoots;
  };

  const createPopupBundleRoot = () => {
    return normalizeNode({
      id: DEFAULT_POPUP_BUNDLE_ID,
      label: t("options.popupBundleLabel"),
      kind: "token-rules",
      enabled: true,
      order: 57,
      entries: [],
      children: []
    }, DEFAULT_POPUP_BUNDLE_ID, t("options.popupBundleLabel"));
  };

  const ensurePopupBundleRoot = (roots) => {
    const existing = roots.find((root) => root.id === state.popupBundleId);
    if (existing) {
      existing.label = existing.label || t("options.popupBundleLabel");
      return roots;
    }

    roots.push(createPopupBundleRoot());
    return roots;
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

      throw new Error(t("options.invalidImportedRoots"));
  };

  const serializeEntry = (entry, index) => {
    const inferredType = inferEntryType(entry);
    const fromOptions = normalizeFromOptions(entry.from_options ?? entry.from, entry.from);
    const serializedFrom = stringifyFromOptions(fromOptions, entry.from);

    const serialized = {
      id: `${entry.id ?? createEntryId()}`.trim() || `entry-${index + 1}`,
      from: serializedFrom,
      to: `${entry.to ?? ""}`.trim(),
      priority: Number.isFinite(entry.priority) ? entry.priority : Number(entry.priority) || 0,
      enabled: entry.enabled !== false,
      regex: entry.regex === true
    };

    if (fromOptions.length > 1) {
      serialized.from_options = cloneValue(fromOptions);
    }

    if (inferredType) {
      serialized.type = inferredType;
    }

    const effectiveMatchTarget = getEffectiveEntryMatchTarget(entry, inferredType);
    if (effectiveMatchTarget === "basic_form") {
      serialized.match_target = "basic_form";
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
    }

    if (Array.isArray(entry.sequence) && entry.sequence.length > 0) {
      serialized.sequence = cloneValue(entry.sequence);
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
      runtime_settings: cloneValue(state.runtimeSettings),
      disabled_sites: cloneValue(state.disabledSites),
      popup_bundle_id: state.popupBundleId,
      roots: state.roots.map((root, index) => serializeNode(root, index + 1))
    };
  };

  const buildStoragePayload = () => ({
    [STORAGE_KEY]: buildPayload()
  });

  const applyPersistedPayloadToState = (payload) => {
    const importedRoots = normalizeImportedRoots(payload);
    state.roots = mergeImportedRootsWithBaseRoots(importedRoots, state.baseRoots);
    state.runtimeSettings = extractRuntimeSettings(payload);
    state.disabledSites = extractDisabledSites(payload);
    state.popupBundleId = extractPopupBundleId(payload);
    ensurePopupBundleRoot(state.roots);
  };

  const saveAllAndNotify = async () => {
    const payload = buildPayload();
    applyPersistedPayloadToState(payload);
    renderApp();
    await storageSet({
      [STORAGE_KEY]: payload
    });
    await notifyRuntimeSettingsApplied();
    setStatus("設定を保存しました。現在のタブへ即時反映しました。", "success");
  };

  const applyDefaultState = () => {
    state.roots = cloneValue(state.baseRoots);
    state.runtimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
    state.disabledSites = { ...DEFAULT_DISABLED_SITES };
    ensurePopupBundleRoot(state.roots);
  };

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
    const payload = buildPayload();
    applyPersistedPayloadToState(payload);
    renderApp();
    await storageSet({
      [STORAGE_KEY]: payload
    });
    setStatus("設定を保存しました。表示タブを再読み込みしてください。", "success");
  };

  const reloadDefaults = () => {
    state.roots = cloneValue(state.baseRoots);
    state.runtimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
    renderApp();
    setStatus("既定値へ戻しました。", "info");
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

  const createDeepEntryClone = (entry) => {
    return {
      ...cloneValue(entry),
      id: createEntryId(),
      selected: false,
      metaOpen: false
    };
  };

  const refreshNodeIdentity = (node) => {
    node.id = createNodeId();
    node.selected = false;
    node.children = Array.isArray(node.children) ? node.children : [];
    node.entries = Array.isArray(node.entries) ? node.entries : [];
    node.entries = node.entries.map((entry) => createDeepEntryClone(entry));
    node.children = node.children.map((child) => refreshNodeIdentity(child));
    return node;
  };

  const createDeepNodeClone = (node) => {
    return refreshNodeIdentity(cloneValue(node));
  };

  const setFocusedNode = (nodeId) => {
    state.focusedNodeId = nodeId;
  };

  const findNodeLocation = (nodeId, nodes = state.roots, parentChildren = state.roots, parentNode = null) => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) {
        return { node, index, parentChildren, parentNode };
      }

      const nested = findNodeLocation(nodeId, node.children ?? [], node.children ?? [], node);
      if (nested) {
        return nested;
      }
    }

    return null;
  };

  const findEntryLocation = (entryId) => {
    let found = null;
    walkNodes(state.roots, (node) => {
      if (found) {
        return;
      }

      const index = node.entries.findIndex((entry) => entry.id === entryId);
      if (index >= 0) {
        found = {
          node,
          index,
          entry: node.entries[index]
        };
      }
    });
    return found;
  };

  const isNodeAncestorOf = (ancestorId, descendantId) => {
    const descendantLocation = findNodeLocation(descendantId);
    let cursor = descendantLocation?.parentNode ?? null;
    while (cursor) {
      if (cursor.id === ancestorId) {
        return true;
      }
      const parentLocation = findNodeLocation(cursor.id);
      cursor = parentLocation?.parentNode ?? null;
    }
    return false;
  };

  const collectSelectedEntries = () => {
    const selected = [];
    walkNodes(state.roots, (node) => {
      node.entries.forEach((entry, index) => {
        if (entry.selected === true) {
          selected.push({ node, index, entry });
        }
      });
    });
    return selected;
  };

  const collectSelectedNodes = () => {
    const selected = [];
    walkNodes(state.roots, (node, trail) => {
      if (node.selected === true) {
        const location = findNodeLocation(node.id);
        if (location) {
          selected.push({
            node,
            trail,
            ...location
          });
        }
      }
    });
    return selected;
  };

  const clearAllSelections = () => {
    walkNodes(state.roots, (node) => {
      node.selected = false;
      node.entries.forEach((entry) => {
        entry.selected = false;
      });
    });
  };

  const getPreferredPasteTargetNode = () => {
    if (state.focusedNodeId) {
      const focused = findNodeLocation(state.focusedNodeId);
      if (focused) {
        return focused.node;
      }
    }

    const selectedNodes = collectSelectedNodes();
    if (selectedNodes.length > 0) {
      return selectedNodes[0].node;
    }

    const selectedEntries = collectSelectedEntries();
    if (selectedEntries.length > 0) {
      return selectedEntries[0].node;
    }

    return state.roots[0] ?? null;
  };

  const copyCurrentSelection = (cut = false) => {
    const selectedNodes = collectSelectedNodes();
    if (selectedNodes.length > 0) {
      const items = selectedNodes.map(({ node }) => createDeepNodeClone(node));
      state.clipboard = { type: "nodes", items };
      if (cut) {
        selectedNodes
          .sort((left, right) => {
            if (left.trail.length !== right.trail.length) {
              return right.trail.length - left.trail.length;
            }
            return right.index - left.index;
          })
          .forEach(({ parentChildren, index }) => {
            parentChildren.splice(index, 1);
          });
        clearAllSelections();
      }
      setStatus(`${items.length} 個の箱を${cut ? "切り取り" : "コピー"}しました。`, "info");
      renderApp();
      return true;
    }

    const selectedEntries = collectSelectedEntries();
    if (selectedEntries.length > 0) {
      const items = selectedEntries.map(({ entry }) => createDeepEntryClone(entry));
      state.clipboard = { type: "entries", items };
      if (cut) {
        const groups = new Map();
        selectedEntries.forEach(({ node, index }) => {
          const key = node.id;
          if (!groups.has(key)) {
            groups.set(key, { node, indexes: [] });
          }
          groups.get(key).indexes.push(index);
        });
        groups.forEach(({ node, indexes }) => {
          indexes.sort((a, b) => b - a).forEach((index) => {
            node.entries.splice(index, 1);
          });
        });
        clearAllSelections();
      }
      setStatus(`${items.length} 件の項目を${cut ? "切り取り" : "コピー"}しました。`, "info");
      renderApp();
      return true;
    }

    setStatus("コピーまたは切り取り対象が選択されていません。", "error");
    return false;
  };

  const pasteClipboardIntoNode = (targetNodeId = null) => {
    const clipboard = state.clipboard;
    if (!clipboard || !Array.isArray(clipboard.items) || clipboard.items.length === 0) {
      setStatus("貼り付け対象がありません。", "error");
      return false;
    }

    const targetNode = targetNodeId
      ? findNodeLocation(targetNodeId)?.node
      : getPreferredPasteTargetNode();
    if (!targetNode) {
      setStatus("貼り付け先の箱が見つかりません。", "error");
      return false;
    }

    if (clipboard.type === "entries") {
      targetNode.entries.push(...clipboard.items.map((entry) => createDeepEntryClone(entry)));
      setStatus(`${clipboard.items.length} 件の項目を貼り付けました。`, "success");
      renderApp();
      return true;
    }

    if (clipboard.type === "nodes") {
      targetNode.children.push(...clipboard.items.map((node) => createDeepNodeClone(node)));
      setStatus(`${clipboard.items.length} 個の箱を貼り付けました。`, "success");
      renderApp();
      return true;
    }

    return false;
  };

  const deleteCurrentSelection = () => {
    const selectedNodes = collectSelectedNodes();
    if (selectedNodes.length > 0) {
      selectedNodes
        .sort((left, right) => {
          if (left.trail.length !== right.trail.length) {
            return right.trail.length - left.trail.length;
          }
          return right.index - left.index;
        })
        .forEach(({ parentChildren, index }) => {
          parentChildren.splice(index, 1);
        });
      clearAllSelections();
      renderApp();
      setStatus("選択した箱を削除しました。", "info");
      return true;
    }

    const selectedEntries = collectSelectedEntries();
    if (selectedEntries.length > 0) {
      const grouped = new Map();
      selectedEntries.forEach(({ node, index }) => {
        if (!grouped.has(node.id)) {
          grouped.set(node.id, { node, indexes: [] });
        }
        grouped.get(node.id).indexes.push(index);
      });
      grouped.forEach(({ node, indexes }) => {
        indexes.sort((a, b) => b - a).forEach((index) => {
          node.entries.splice(index, 1);
        });
      });
      clearAllSelections();
      renderApp();
      setStatus("選択した項目を削除しました。", "info");
      return true;
    }

    return false;
  };

  const moveEntryBetweenNodes = (entryId, sourceNodeId, targetNodeId, targetIndex = null) => {
    const source = findNodeLocation(sourceNodeId)?.node;
    const target = findNodeLocation(targetNodeId)?.node;
    if (!source || !target) {
      return false;
    }

    const index = source.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) {
      return false;
    }

    const [entry] = source.entries.splice(index, 1);
    let normalizedIndex = targetIndex === null || targetIndex === undefined
      ? target.entries.length
      : Math.max(0, Math.min(targetIndex, target.entries.length));
    if (source.id === target.id && index < normalizedIndex) {
      normalizedIndex -= 1;
    }
    target.entries.splice(normalizedIndex, 0, entry);
    return true;
  };

  const moveNodeBetweenParents = (nodeId, targetParentChildren, targetIndex) => {
    const source = findNodeLocation(nodeId);
    if (!source || !Array.isArray(targetParentChildren)) {
      return false;
    }

    const [node] = source.parentChildren.splice(source.index, 1);
    let normalizedIndex = Math.max(0, Math.min(targetIndex, targetParentChildren.length));
    if (source.parentChildren === targetParentChildren && source.index < normalizedIndex) {
      normalizedIndex -= 1;
    }
    targetParentChildren.splice(normalizedIndex, 0, node);
    return true;
  };

  const createButton = (label, className, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = uiText(label);
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

  const createCompactInput = (value, {
    type = "text",
    min = 4,
    max = 32,
    className = "cell-input",
    placeholder = "",
    title = ""
  } = {}) => {
    const input = document.createElement("input");
    input.type = type;
    input.className = className;
    input.value = value;
    input.placeholder = uiText(placeholder);
    input.title = uiText(title || `${value ?? ""}`);
    autosizeInput(input, min, max);
    input.addEventListener("input", () => {
      autosizeInput(input, min, max);
      input.title = uiText(input.value);
    });
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
      throw new Error(t("options.invalidSequenceArray"));
    }
    return parsed;
  };

  const COMMON_POS_VALUES = ["名詞", "動詞", "助詞", "助動詞", "形容詞", "副詞", "連体詞", "接続詞", "記号"];
  const COMMON_POS1_VALUES = ["一般", "自立", "非自立", "接尾", "格助詞", "係助詞", "副詞可能", "サ変接続"];
  const COMMON_CFORM_VALUES = ["基本形", "連体形", "連用形", "未然形", "仮定形", "命令形"];
  const COMMON_CTYPE_VALUES = ["五段・ラ行", "五段・ワ行促音便", "一段", "サ変・スル", "カ変・クル", "形容詞・イ段"];

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
    pos1: {
      "格助": "格助詞",
      "係助": "係助詞",
      "副可": "副詞可能",
      "サ変": "サ変接続"
    },
    cform: {
      "基本": "基本形",
      "連用": "連用形",
      "連体": "連体形",
      "未然": "未然形",
      "命令": "命令形",
      "仮定": "仮定形"
    },
    ctype: {
      "一段": "一段",
      "五段": "五段・ワ行促音便",
      "サ変": "サ変・スル",
      "カ変": "カ変・クル",
      "形容詞": "形容詞・アウオ段"
    }
  };

  const CONDITION_SLOT_KEYS = ["prev", "current", "next"];
  const MATCHER_FIELD_KEYS = ["surface", "basic", "pos", "pos1", "cform", "ctype"];

  const formatSequenceDsl = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
      return "";
    }

    return value
      .map((token) => {
        const matcher = cleanupMatcherDraft(token) ?? {};
        const surface = matcher.surface ?? "";
        const pairs = Object.entries(matcher)
          .filter(([key]) => key !== "surface")
          .map(([key, fieldValue]) => `${key}=${fieldValue}`);
        if (pairs.length === 0) {
          return surface;
        }
        return `${surface}{${pairs.join(";")}}`;
      })
      .join(" ");
  };

  const parseSequenceDsl = (text) => {
    const trimmed = `${text ?? ""}`.trim();
    if (!trimmed) {
      return null;
    }

    const tokenTexts = [];
    let current = "";
    let braceDepth = 0;
    for (const char of trimmed) {
      if (char === "{") {
        braceDepth += 1;
        current += char;
        continue;
      }
      if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        current += char;
        continue;
      }
      if (/\s/.test(char) && braceDepth === 0) {
        if (current.trim()) {
          tokenTexts.push(current.trim());
          current = "";
        }
        continue;
      }
      current += char;
    }
    if (current.trim()) {
      tokenTexts.push(current.trim());
    }

    return tokenTexts
      .map((tokenText) => {
        const openIndex = tokenText.indexOf("{");
        if (openIndex < 0) {
          return cleanupMatcherDraft({ surface: tokenText });
        }
        if (!tokenText.endsWith("}")) {
          throw new Error(`invalid sequence token: ${tokenText}`);
        }
        const surface = tokenText.slice(0, openIndex).trim();
        const body = tokenText.slice(openIndex + 1, -1).trim();
        const matcher = surface ? { surface } : {};
        for (const pairText of body.split(";").map((item) => item.trim()).filter(Boolean)) {
          const separatorIndex = pairText.indexOf("=");
          if (separatorIndex < 0) {
            throw new Error(`invalid sequence field: ${pairText}`);
          }
          matcher[pairText.slice(0, separatorIndex).trim()] = pairText.slice(separatorIndex + 1).trim();
        }
        return cleanupMatcherDraft(matcher);
      })
      .filter(Boolean);
  };

  const canonicalizeMatcherFieldValue = (key, value) => {
    const tokens = splitCommaSeparatedValues(value);
    if (tokens.length === 0) {
      return `${value ?? ""}`.trim();
    }

    const aliases = MATCHER_VALUE_ALIASES[key];
    const normalized = tokens
      .map((token) => {
        const trimmed = `${token ?? ""}`.trim();
        if (!trimmed) {
          return "";
        }
        return aliases?.[trimmed] ?? trimmed;
      })
      .filter(Boolean);

    return [...new Set(normalized)].join(",");
  };

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

  const normalizeMatcherDraftList = (value) => {
    if (Array.isArray(value)) {
      const drafts = value.map((item) => normalizeMatcherDraft(item));
      return drafts.length > 0 ? drafts : [{}];
    }

    if (value) {
      return [normalizeMatcherDraft(value)];
    }

    return [{}];
  };

  const getConditionDraftList = (entry, slot) => {
    if (!entry._conditionDrafts || typeof entry._conditionDrafts !== "object") {
      entry._conditionDrafts = {};
    }

    if (!Array.isArray(entry._conditionDrafts[slot])) {
      entry._conditionDrafts[slot] = normalizeMatcherDraftList(entry.conditions?.[slot]);
    }

    return entry._conditionDrafts[slot];
  };

  const cleanupMatcherDraft = (draft) => {
    const normalized = {};
    const keys = ["surface", "basic", "pos", "pos1", "pos2", "pos3", "ctype", "cform", "reading", "pronunciation", "word_type"];
    for (const key of keys) {
      const value = canonicalizeMatcherFieldValue(key, draft?.[key] ?? "");
      if (value) {
        normalized[key] = value;
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  };

  const cleanupMatcherDraftList = (draftList) => {
    const cleaned = (Array.isArray(draftList) ? draftList : [])
      .map((draft) => cleanupMatcherDraft(draft))
      .filter(Boolean);

    if (cleaned.length === 0) {
      return null;
    }

    return cleaned.length === 1 ? cleaned[0] : cleaned;
  };

  const assignConditionSlot = (entry, slot, matcherOrMatchers) => {
    if (!entry._conditionDrafts || typeof entry._conditionDrafts !== "object") {
      entry._conditionDrafts = {};
    }
    if (Array.isArray(matcherOrMatchers)) {
      entry._conditionDrafts[slot] = matcherOrMatchers;
    }

    const nextConditions = { ...(entry.conditions ?? {}) };
    const normalized = Array.isArray(matcherOrMatchers)
      ? cleanupMatcherDraftList(matcherOrMatchers)
      : matcherOrMatchers;

    if (normalized) {
      nextConditions[slot] = normalized;
    } else {
      delete nextConditions[slot];
    }
    entry.conditions = Object.keys(nextConditions).length > 0 ? nextConditions : null;
  };

  const getConditionDraftListForSlot = (entry, slot) => {
    const drafts = getConditionDraftList(entry, slot);
    return Array.isArray(drafts) ? drafts : [{}];
  };

  const getEntryConditionInlineValue = (entry, slot, field) => {
    return getConditionDraftListForSlot(entry, slot)
      .map((draft) => `${draft?.[field] ?? ""}`.trim())
      .filter(Boolean)
      .join(" || ");
  };

  const setEntryConditionInlineValue = (entry, slot, field, value) => {
    const drafts = getConditionDraftListForSlot(entry, slot).map((draft) => ({ ...draft }));
    const values = `${value ?? ""}`
      .split(/\s*\|\|\s*/g)
      .map((item) => `${item ?? ""}`.trim())
      .filter(Boolean);
    const nextLength = Math.max(drafts.length, values.length, 1);
    while (drafts.length < nextLength) {
      drafts.push({});
    }
    for (let index = 0; index < drafts.length; index += 1) {
      if (values[index]) {
        drafts[index][field] = values[index];
      } else {
        delete drafts[index][field];
      }
    }
    assignConditionSlot(entry, slot, drafts);
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
    button.textContent = uiText(node.label || fallback);

    const startEditing = () => {
      const editor = createCompactInput(node.label || "", {
        type: "text",
        min: 6,
        max: 48,
        className: "cell-input title-editor"
      });
      editor.placeholder = uiText(fallback);
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
    caption.textContent = uiText(labelText);

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

    grid.appendChild(createMatcherField(t("options.fieldSurface"), draft.surface ?? "", null, null, (value) => updateField("surface", value)));
    grid.appendChild(createMatcherField(t("options.fieldBasicCondition"), draft.basic ?? "", null, null, (value) => updateField("basic", value)));
    grid.appendChild(createMatcherField("品詞", draft.pos ?? "", "pos-values", COMMON_POS_VALUES, (value) => updateField("pos", value)));
    grid.appendChild(createMatcherField("蜩∬ｩ・", draft.pos1 ?? "", "pos1-values", COMMON_POS1_VALUES, (value) => updateField("pos1", value)));
    grid.appendChild(createMatcherField("豢ｻ逕ｨ蠖｢", draft.cform ?? "", "cform-values", COMMON_CFORM_VALUES, (value) => updateField("cform", value)));
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
    actions.appendChild(createButton(t("options.buttonAddToken"), "secondary", () => {
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
      empty.textContent = t("options.emptySequence");
      wrap.append(head, empty);
      return wrap;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>${t("options.fieldSurface")}</th>
        <th>${t("options.fieldBasic")}</th>
        <th>${t("options.fieldPos")}</th>
        <th>${t("options.fieldPos1")}</th>
        <th>${t("options.fieldCform")}</th>
        <th>${t("options.fieldCtype")}</th>
        <th>${t("options.fieldActions")}</th>
      </tr>
    `;
    const tbody = document.createElement("tbody");
    tbody.addEventListener("dragover", (event) => {
      if (state.dragPayload?.type === "entry") {
        event.preventDefault();
      }
    });
    tbody.addEventListener("drop", (event) => {
      if (state.dragPayload?.type !== "entry") {
        return;
      }
      event.preventDefault();
      const payload = state.dragPayload;
      if (moveEntryBetweenNodes(payload.entryId, payload.sourceNodeId, node.id)) {
        setFocusedNode(node.id);
        renderApp();
      }
      state.dragPayload = null;
    });

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
      actionTd.appendChild(createButton(t("options.buttonDelete"), "danger", () => {
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

  const renderConditionEditorV2 = (entry, slot, labelText) => {
    const wrap = document.createElement("div");
    wrap.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = labelText;
    const hint = document.createElement("span");
    hint.className = "count";
    hint.textContent = "surface / basic / pos / pos1 / cform / ctype";
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

    grid.appendChild(createMatcherField(t("options.fieldSurface"), draft.surface ?? "", null, null, (value) => updateField("surface", value)));
    grid.appendChild(createMatcherField(t("options.fieldBasicCondition"), draft.basic ?? "", null, null, (value) => updateField("basic", value)));
    grid.appendChild(createMatcherField("品詞", draft.pos ?? "", "pos-values", COMMON_POS_VALUES, (value) => updateField("pos", value)));
    grid.appendChild(createMatcherField("蜩∬ｩ・", draft.pos1 ?? "", "pos1-values", COMMON_POS1_VALUES, (value) => updateField("pos1", value)));
    grid.appendChild(createMatcherField("豢ｻ逕ｨ蠖｢", draft.cform ?? "", "cform-values", COMMON_CFORM_VALUES, (value) => updateField("cform", value)));
    grid.appendChild(createMatcherField("活用型", draft.ctype ?? "", "ctype-values", COMMON_CTYPE_VALUES, (value) => updateField("ctype", value)));

    wrap.append(head, grid);
    return wrap;
  };

  const renderConditionGroupEditor = (entry, slot, labelText) => {
    const wrap = document.createElement("div");
    wrap.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = labelText;
    const hint = document.createElement("span");
    hint.className = "count";
    hint.textContent = "同一行は AND / 複数行は OR";
    head.append(title, hint);

    const drafts = getConditionDraftList(entry, slot);
    const listWrap = document.createElement("div");
    listWrap.style.display = "grid";
    listWrap.style.gap = "6px";

    const syncDrafts = () => {
      assignConditionSlot(entry, slot, drafts);
      renderDiagnostics();
    };

    const appendMatcherGrid = (container, draft) => {
      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gap = "6px";
      grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(92px, 1fr))";

      const updateField = (key, value) => {
        draft[key] = value;
        syncDrafts();
      };

      grid.appendChild(createMatcherField(t("options.fieldSurface"), draft.surface ?? "", null, null, (value) => updateField("surface", value)));
      grid.appendChild(createMatcherField(t("options.fieldBasic"), draft.basic ?? "", null, null, (value) => updateField("basic", value)));
      grid.appendChild(createMatcherField("品詞", draft.pos ?? "", "pos-values", COMMON_POS_VALUES, (value) => updateField("pos", value)));
      grid.appendChild(createMatcherField("蜩∬ｩ・", draft.pos1 ?? "", "pos1-values", COMMON_POS1_VALUES, (value) => updateField("pos1", value)));
      grid.appendChild(createMatcherField("豢ｻ逕ｨ蠖｢", draft.cform ?? "", "cform-values", COMMON_CFORM_VALUES, (value) => updateField("cform", value)));
      grid.appendChild(createMatcherField("活用型", draft.ctype ?? "", "ctype-values", COMMON_CTYPE_VALUES, (value) => updateField("ctype", value)));
      container.appendChild(grid);
    };

    drafts.forEach((draft, matcherIndex) => {
      const matcherWrap = document.createElement("div");
      matcherWrap.className = "panel-block";

      const matcherHead = document.createElement("div");
      matcherHead.className = "panel-head";
      const matcherTitle = document.createElement("h4");
      matcherTitle.textContent = `条件 ${matcherIndex + 1}`;
      const matcherActions = document.createElement("div");
      matcherActions.className = "panel-actions";
      matcherActions.appendChild(createButton("↑", "ghost", () => {
        if (moveItem(drafts, matcherIndex, -1)) {
          syncDrafts();
          renderApp();
        }
      }));
      matcherActions.appendChild(createButton("↓", "ghost", () => {
        if (moveItem(drafts, matcherIndex, 1)) {
          syncDrafts();
          renderApp();
        }
      }));
      matcherActions.appendChild(createButton(t("options.buttonDelete"), "ghost", () => {
        drafts.splice(matcherIndex, 1);
        syncDrafts();
        renderApp();
      }));
      matcherHead.append(matcherTitle, matcherActions);
      matcherWrap.appendChild(matcherHead);
      appendMatcherGrid(matcherWrap, draft);
      listWrap.appendChild(matcherWrap);
    });

    const actions = document.createElement("div");
    actions.className = "panel-actions";
    actions.appendChild(createButton(t("options.buttonAddOrCondition"), "secondary", () => {
      drafts.push({});
      assignConditionSlot(entry, slot, drafts);
      renderApp();
    }));

    wrap.append(head, listWrap, actions);
    return wrap;
  };

  const renderSequenceEditorV2 = (entry) => {
    const wrap = document.createElement("div");
    wrap.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = "sequence";
    const actions = document.createElement("div");
    actions.className = "panel-actions";
    actions.appendChild(createButton(t("options.buttonAddToken"), "secondary", () => {
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
      empty.textContent = t("options.emptySequence");
      wrap.append(head, empty);
      return wrap;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>${t("options.fieldSurface")}</th>
        <th>${t("options.fieldBasic")}</th>
        <th>${t("options.fieldPos")}</th>
        <th>${t("options.fieldPos1")}</th>
        <th>${t("options.fieldCform")}</th>
        <th>${t("options.fieldCtype")}</th>
        <th>${t("options.fieldActions")}</th>
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
      actionTd.appendChild(createButton(t("options.buttonDelete"), "danger", () => {
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

  const renderSequenceEditorV3 = (entry) => {
    const wrap = document.createElement("div");
    wrap.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = "sequence";
    const hint = document.createElement("span");
    hint.className = "count";
    hint.textContent = "完全一致 / OR はカンマ区切り / 値は下に JSON で表示";
    const actions = document.createElement("div");
    actions.className = "panel-actions";
    actions.appendChild(createButton(t("options.buttonAddToken"), "secondary", () => {
      const next = Array.isArray(entry.sequence) ? cloneValue(entry.sequence) : [];
      next.push({ surface: "", pos: "" });
      entry.sequence = next;
      renderApp();
    }));
    head.append(title, hint, actions);

    const sequence = Array.isArray(entry.sequence) ? entry.sequence : [];
    if (sequence.length === 0) {
      const empty = document.createElement("div");
      empty.className = "count";
      empty.textContent = t("options.emptySequenceShort");
      wrap.append(head, empty);
      return wrap;
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area sequence-scroll";
    const table = document.createElement("table");
    table.className = "sequence-table";
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>${t("options.fieldSurface")}</th>
        <th>${t("options.fieldBasic")}</th>
        <th>${t("options.fieldPos")}</th>
        <th>${t("options.fieldPos1")}</th>
        <th>${t("options.fieldCform")}</th>
        <th>${t("options.fieldCtype")}</th>
        <th>${t("options.fieldActions")}</th>
      </tr>
    `;
    const tbody = document.createElement("tbody");
    const preview = document.createElement("pre");
    preview.className = "json-block";
    const syncPreview = () => {
      preview.textContent = JSON.stringify(entry.sequence, null, 2);
    };

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
        syncPreview();
      };

      const appendCell = (node) => {
        const td = document.createElement("td");
        td.appendChild(node);
        row.appendChild(td);
      };

      appendCell(createCompactInput(draft.surface ?? "", {
        min: 6,
        max: 24,
        className: "cell-input sequence-field sequence-surface",
        placeholder: t("options.fieldSurface")
      }));
      row.lastChild.firstChild.addEventListener("input", (event) => updateMatcher("surface", event.currentTarget.value));

      appendCell(createCompactInput(draft.basic ?? "", {
        min: 6,
        max: 24,
        className: "cell-input sequence-field sequence-basic",
        placeholder: t("options.fieldBasic")
      }));
      row.lastChild.firstChild.addEventListener("input", (event) => updateMatcher("basic", event.currentTarget.value));

      const posInput = createCompactInput(draft.pos ?? "", {
        min: 6,
        max: 18,
        className: "cell-input sequence-field sequence-pos",
        placeholder: t("options.fieldPos")
      });
      ensureDatalist("pos-values", COMMON_POS_VALUES);
      posInput.setAttribute("list", "pos-values");
      posInput.addEventListener("input", (event) => updateMatcher("pos", event.currentTarget.value));
      appendCell(posInput);

      const pos1Input = createCompactInput(draft.pos1 ?? "", {
        min: 6,
        max: 18,
        className: "cell-input sequence-field sequence-pos1",
        placeholder: t("options.fieldPos1")
      });
      ensureDatalist("pos1-values", COMMON_POS1_VALUES);
      pos1Input.setAttribute("list", "pos1-values");
      pos1Input.addEventListener("input", (event) => updateMatcher("pos1", event.currentTarget.value));
      appendCell(pos1Input);

      const cformInput = createCompactInput(draft.cform ?? "", {
        min: 6,
        max: 18,
        className: "cell-input sequence-field sequence-cform",
        placeholder: t("options.fieldCform")
      });
      ensureDatalist("cform-values", COMMON_CFORM_VALUES);
      cformInput.setAttribute("list", "cform-values");
      cformInput.addEventListener("input", (event) => updateMatcher("cform", event.currentTarget.value));
      appendCell(cformInput);

      const ctypeInput = createCompactInput(draft.ctype ?? "", {
        min: 6,
        max: 24,
        className: "cell-input sequence-field sequence-ctype",
        placeholder: t("options.fieldCtype")
      });
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
      actionTd.appendChild(createButton(t("options.buttonDelete"), "danger", () => {
        const next = cloneValue(sequence);
        next.splice(matcherIndex, 1);
        entry.sequence = next.length > 0 ? next : null;
        renderApp();
      }));
      row.appendChild(actionTd);

      tbody.appendChild(row);
    });

    syncPreview();
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    wrap.append(head, tableWrap, preview);
    return wrap;
  };

  const renderBulkImportPanel = (node, effectiveKind) => {
    const panel = document.createElement("div");
    panel.className = "panel-block";
    const tableUi = getTableUiState(node.id);

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = t("options.bulkImportTitle");
    const hint = document.createElement("span");
    hint.className = "count";
    hint.textContent = "変更前/変更後/優先/有効/正規/原形一致/current.* / sequence を入力できます";
    head.append(title, hint);

    const body = document.createElement("div");
    body.style.display = "grid";
    body.style.gap = "6px";

    const delimiterRow = document.createElement("div");
    delimiterRow.className = "simple-row";
    const delimiterLabel = document.createElement("strong");
    delimiterLabel.textContent = "区切り文字";
    const delimiterInput = createCompactInput(getTableBulkDelimiter(node.id), {
      min: 2,
      max: 6,
      className: "cell-input compact",
      placeholder: ",",
      title: "未入力ならカンマ、\\t でタブ"
    });
    delimiterInput.addEventListener("input", () => {
      setTableBulkDelimiter(node.id, delimiterInput.value);
      tableUi.bulkImportDelimiter = delimiterInput.value;
    });
    const delimiterHint = document.createElement("span");
    delimiterHint.className = "count";
    delimiterHint.textContent = "未入力なら , / \\t でタブ / @delimiter があればそちらを優先";
    delimiterRow.append(delimiterLabel, delimiterInput, delimiterHint);

    const textarea = document.createElement("textarea");
    textarea.rows = 8;
    textarea.placeholder = [
      "from,to,priority,current.pos,sequence",
      "かわいい,可愛い,90,形容詞,",
      "きもち,気持ち,90,名詞,\"き{basic=くる,き;pos=動,助動;cform=連用,基本} もち{basic=もち;pos=名}\""
    ].join("\n");
    textarea.value = `${node.bulkImportText ?? ""}`;
    textarea.addEventListener("input", () => {
      node.bulkImportText = textarea.value;
    });

    const actions = document.createElement("div");
    actions.className = "panel-actions";
    actions.appendChild(createButton(t("options.buttonAddBulk"), "primary", () => {
      const importedEntries = parseBulkImportEntries(textarea.value, effectiveKind, tableUi.bulkImportDelimiter);
      if (importedEntries.length === 0) {
        setStatus("一括登録できる行がありません。", "error");
        return;
      }
      node.entries.push(...importedEntries);
      node.bulkImportText = "";
      node.bulkImportOpen = false;
      renderApp();
      setStatus(`${importedEntries.length} 件を一括登録しました。`, "success");
    }));
    actions.appendChild(createButton(t("options.buttonClearInput"), "ghost", () => {
      node.bulkImportText = "";
      renderApp();
    }));

    body.append(delimiterRow, textarea, actions);
    panel.append(head, body);
    return panel;
  };

  const clearEntryConditionSlot = (entry, slot) => {
    if (entry._conditionDrafts && typeof entry._conditionDrafts === "object") {
      delete entry._conditionDrafts[slot];
    }
    const nextConditions = { ...(entry.conditions ?? {}) };
    delete nextConditions[slot];
    entry.conditions = Object.keys(nextConditions).length > 0 ? nextConditions : null;
  };

  const getSelectedEntriesForNode = (node) => {
    return (Array.isArray(node?.entries) ? node.entries : []).filter((entry) => entry?.selected === true);
  };

  const applyCurrentConditionDraftToEntries = (entries, draft) => {
    for (const entry of entries) {
      for (const field of CURRENT_CONDITION_FIELDS) {
        const value = `${draft?.[field] ?? ""}`.trim();
        if (!value) {
          continue;
        }
        setEntryConditionInlineValue(entry, "current", field, value);
      }
    }
  };

  const clearCurrentConditionFromEntries = (entries) => {
    for (const entry of entries) {
      clearEntryConditionSlot(entry, "current");
    }
  };

  const getEntrySortValue = (entry, key) => {
    switch (key) {
      case "enabled":
        return entry.enabled !== false ? 1 : 0;
      case "regex":
        return entry.regex === true ? 1 : 0;
      case "basic_match":
        return entry.match_target === "basic_form" ? 1 : 0;
      case "from":
        return `${entry.from ?? ""}`.trim().toLocaleLowerCase("ja");
      case "to":
        return `${entry.to ?? ""}`.trim().toLocaleLowerCase("ja");
      case "priority":
        return Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 0;
      default:
        if (key.startsWith("current.")) {
          return getEntryConditionInlineValue(entry, "current", key.slice("current.".length)).toLocaleLowerCase("ja");
        }
        return "";
    }
  };

  const compareSortValues = (left, right) => {
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return `${left ?? ""}`.localeCompare(`${right ?? ""}`, "ja");
  };

  const cycleSortDirection = (nodeId, key) => {
    const currentSort = getTableSortState(nodeId);
    if (currentSort.key !== key) {
      setTableSortState(nodeId, key, "asc");
      return;
    }
    if (currentSort.direction === "asc") {
      setTableSortState(nodeId, key, "desc");
      return;
    }
    if (currentSort.direction === "desc") {
      setTableSortState(nodeId, null, null);
      return;
    }
    setTableSortState(nodeId, key, "asc");
  };

  const getSortedEntriesForNode = (node) => {
    const sortState = getTableSortState(node.id);
    const entries = Array.isArray(node?.entries) ? node.entries : [];
    if (!sortState?.key || !sortState?.direction) {
      return [...entries];
    }
    return [...entries]
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => {
        const compared = compareSortValues(
          getEntrySortValue(left.entry, sortState.key),
          getEntrySortValue(right.entry, sortState.key)
        );
        if (compared !== 0) {
          return sortState.direction === "desc" ? -compared : compared;
        }
        return left.index - right.index;
      })
      .map(({ entry }) => entry);
  };

  const createSortHeaderButton = (nodeId, key, label) => {
    const sortState = getTableSortState(nodeId);
    const marker = sortState.key === key
      ? (sortState.direction === "asc" ? " ↑" : sortState.direction === "desc" ? " ↓" : "")
      : "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.textContent = `${label}${marker}`;
    button.addEventListener("click", () => {
      cycleSortDirection(nodeId, key);
      renderApp();
    });
    return button;
  };

  const composeEntrySearchValue = (entry) => {
    return [
      entry.regex ? "regex" : "plain",
      entry.from,
      entry.to,
      ...CURRENT_CONDITION_FIELDS.map((field) => getEntryConditionInlineValue(entry, "current", field))
    ].join(" ");
  };

  const refreshEntryRowEffects = (nodeId, sortKey) => {
    const currentSort = getTableSortState(nodeId);
    if (currentSort?.key === sortKey) {
      renderApp();
      return;
    }
    renderDiagnostics();
  };

  const renderSelectedCurrentConditionBar = (node) => {
    const selectedEntries = getSelectedEntriesForNode(node);
    if (selectedEntries.length === 0) {
      return null;
    }

    const draft = getTableCurrentBulkDraft(node.id);
    const wrap = document.createElement("div");
    wrap.className = "panel-block";
    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = `選択中 ${selectedEntries.length} 件`;
    const hint = document.createElement("span");
    hint.className = "count";
    hint.textContent = "非空欄の値だけ現条件へ一括反映";
    head.append(title, hint);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gap = "6px";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(110px, 1fr))";

    const fieldLabels = {
      surface: "現.surface",
      basic: "現.basic",
      pos: "現.pos",
      pos1: "現.pos1",
      cform: "現.cform",
      ctype: "現.ctype"
    };

    for (const field of CURRENT_CONDITION_FIELDS) {
      const input = createCompactInput(draft[field] ?? "", {
        min: 6,
        max: 20,
        placeholder: fieldLabels[field],
        title: fieldLabels[field]
      });
      input.addEventListener("input", () => {
        updateTableCurrentBulkDraft(node.id, field, input.value);
      });
      const fieldWrap = document.createElement("label");
      fieldWrap.className = "toggle";
      fieldWrap.style.flexDirection = "column";
      fieldWrap.style.alignItems = "stretch";
      fieldWrap.style.gap = "4px";
      const caption = document.createElement("span");
      caption.textContent = fieldLabels[field];
      fieldWrap.append(caption, input);
      grid.appendChild(fieldWrap);
    }

    const actions = document.createElement("div");
    actions.className = "panel-actions";
    actions.appendChild(createButton("現条件を適用", "secondary", () => {
      applyCurrentConditionDraftToEntries(selectedEntries, getTableCurrentBulkDraft(node.id));
      renderApp();
    }));
    actions.appendChild(createButton("現条件を全消去", "ghost", () => {
      clearCurrentConditionFromEntries(selectedEntries);
      resetTableCurrentBulkDraft(node.id);
      renderApp();
    }));

    wrap.append(head, grid, actions);
    return wrap;
  };

  const renderEntryTable = (node, effectiveKind) => {
    const wrapper = document.createElement("div");
    wrapper.className = "panel-block";

    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("h4");
    title.textContent = t("options.itemTitle");
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
        <th class="check-col"></th>
        <th class="check-col">${t("options.fieldEnabled")}</th>
        <th class="check-col">${t("options.fieldRegex")}</th>
        <th class="check-col">${t("options.fieldBasicMatch")}</th>
        <th>${t("options.fieldFrom")}</th>
        <th>${t("options.fieldTo")}</th>
        <th>${t("options.fieldPriority")}</th>
        <th>${t("options.fieldActions")}</th>
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
      row.addEventListener("click", () => setFocusedNode(node.id));
      row.addEventListener("dragover", (event) => {
        if (state.dragPayload?.type === "entry") {
          event.preventDefault();
        }
      });
      row.addEventListener("drop", (event) => {
        if (state.dragPayload?.type !== "entry") {
          return;
        }
        event.preventDefault();
        const payload = state.dragPayload;
        if (moveEntryBetweenNodes(payload.entryId, payload.sourceNodeId, node.id, entryIndex)) {
          setFocusedNode(node.id);
          renderApp();
        }
        state.dragPayload = null;
      });

      const dragTd = document.createElement("td");
      dragTd.className = "check-col";
      const dragHandle = createButton("⋮⋮", "ghost", () => {});
      dragHandle.type = "button";
      dragHandle.title = t("options.dragEntries");
      dragHandle.draggable = true;
      dragHandle.addEventListener("dragstart", (event) => {
        state.dragPayload = {
          type: "entry",
          entryId: entry.id,
          sourceNodeId: node.id
        };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.id);
        setFocusedNode(node.id);
      });
      dragHandle.addEventListener("dragend", () => {
        state.dragPayload = null;
      });
      dragTd.appendChild(dragHandle);

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
        entry.from_options = normalizeFromOptions(fromInput.value);
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
      detailButton.textContent = entry.metaOpen ? "閉じる" : "条件";
      detailButton.title = entry.metaOpen ? "条件を閉じる" : "条件を開く";
      if (effectiveKind !== "token-rules") {
        detailButton.disabled = true;
        detailButton.title = t("options.detailUnavailable");
      }
      actionTd.appendChild(detailButton);
      actionTd.appendChild(createButton(t("options.buttonDelete"), "danger row-delete", () => {
        node.entries.splice(entryIndex, 1);
        renderApp();
      }));

      row.append(dragTd, checkTd, enabledTd, regexTd, basicTd, fromTd, toTd, priorityTd, actionTd);
      tbody.appendChild(row);

      if (effectiveKind === "token-rules" && entry.metaOpen) {
        const detailRow = document.createElement("tr");
        const detailCell = document.createElement("td");
        detailCell.colSpan = 9;

        const detailWrap = document.createElement("div");
        detailWrap.className = "panel-block";

        const detailHead = document.createElement("div");
        detailHead.className = "panel-head";
        const detailTitle = document.createElement("h4");
        detailTitle.textContent = t("options.detailsTitle");
        const detailHint = document.createElement("span");
        detailHint.className = "count";
        detailHint.textContent = t("options.detailHint");
        detailHead.append(detailTitle, detailHint);

        const detailGrid = document.createElement("div");
        detailGrid.style.display = "grid";
        detailGrid.style.gap = "6px";
        detailGrid.appendChild(renderConditionEditor(entry, "prev", `${t("options.previous")})`));
        detailGrid.appendChild(renderConditionEditor(entry, "current", t("options.current")));
        detailGrid.appendChild(renderConditionEditor(entry, "next", `${t("options.next")})`));
        detailGrid.appendChild(renderSequenceEditor(entry));

        detailTitle.textContent = t("options.detailsTitle");
        detailHint.textContent = t("options.detailHint");
        detailGrid.replaceChildren(
          renderConditionGroupEditor(entry, "prev", t("options.previous")),
          renderConditionGroupEditor(entry, "current", t("options.current")),
          renderConditionGroupEditor(entry, "next", t("options.next")),
          renderSequenceEditorV3(entry)
        );
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

  const renderEntryTableV2 = (node, effectiveKind) => {
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
    wrapper.appendChild(head);

    const selectedBar = renderSelectedCurrentConditionBar(node);
    if (selectedBar) {
      wrapper.appendChild(selectedBar);
    }

    const tableWrap = document.createElement("div");
    tableWrap.className = "scroll-area";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const appendHeaderCell = (content, className = "") => {
      const th = document.createElement("th");
      if (className) {
        th.className = className;
      }
      if (typeof content === "string") {
        th.textContent = content;
      } else if (content) {
        th.appendChild(content);
      }
      headerRow.appendChild(th);
      return th;
    };

    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.setAttribute("aria-label", "全選択");
    appendHeaderCell(selectAll, "check-col");
    appendHeaderCell("", "check-col");
    appendHeaderCell(createSortHeaderButton(node.id, "enabled", "有効"), "check-col");
    appendHeaderCell(createSortHeaderButton(node.id, "regex", "正規"), "check-col");
    appendHeaderCell(createSortHeaderButton(node.id, "basic_match", "原形一致"), "check-col");
    appendHeaderCell(createSortHeaderButton(node.id, "from", "変更前"));
    appendHeaderCell(createSortHeaderButton(node.id, "to", "変更後"));
    appendHeaderCell(createSortHeaderButton(node.id, "priority", "優先"));
    appendHeaderCell(createSortHeaderButton(node.id, "current.surface", "現.surface"));
    appendHeaderCell(createSortHeaderButton(node.id, "current.basic", "現.basic"));
    appendHeaderCell(createSortHeaderButton(node.id, "current.pos", "現.pos"));
    appendHeaderCell(createSortHeaderButton(node.id, "current.pos1", "現.pos1"));
    appendHeaderCell(createSortHeaderButton(node.id, "current.cform", "現.cform"));
    appendHeaderCell(createSortHeaderButton(node.id, "current.ctype", "現.ctype"));
    appendHeaderCell("操作");
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");
    const sortedEntries = getSortedEntriesForNode(node);
    sortedEntries.forEach((entry) => {
      const entryIndex = node.entries.indexOf(entry);
      const row = document.createElement("tr");
      row.id = `entry-${entry.id}`;
      row.dataset.searchValue = composeEntrySearchValue(entry);
      row.addEventListener("click", () => setFocusedNode(node.id));
      row.addEventListener("dragover", (event) => {
        if (state.dragPayload?.type === "entry") {
          event.preventDefault();
        }
      });
      row.addEventListener("drop", (event) => {
        if (state.dragPayload?.type !== "entry") {
          return;
        }
        event.preventDefault();
        const payload = state.dragPayload;
        if (moveEntryBetweenNodes(payload.entryId, payload.sourceNodeId, node.id, entryIndex)) {
          setFocusedNode(node.id);
          renderApp();
        }
        state.dragPayload = null;
      });

      const dragTd = document.createElement("td");
      dragTd.className = "check-col";
      const dragHandle = createButton("⋮⋮", "ghost", () => {});
      dragHandle.type = "button";
      dragHandle.title = "項目を移動";
      dragHandle.draggable = true;
      dragHandle.addEventListener("dragstart", (event) => {
        state.dragPayload = { type: "entry", entryId: entry.id, sourceNodeId: node.id };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.id);
        setFocusedNode(node.id);
      });
      dragHandle.addEventListener("dragend", () => {
        state.dragPayload = null;
      });
      dragTd.appendChild(dragHandle);

      const checkTd = document.createElement("td");
      checkTd.className = "check-col";
      const rowCheckbox = document.createElement("input");
      rowCheckbox.type = "checkbox";
      rowCheckbox.checked = entry.selected === true;
      rowCheckbox.addEventListener("change", () => {
        entry.selected = rowCheckbox.checked;
        renderApp();
      });
      checkTd.appendChild(rowCheckbox);

      const createBooleanCell = (checked, onChange) => {
        const td = document.createElement("td");
        td.className = "check-col";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.addEventListener("change", onChange);
        td.appendChild(checkbox);
        return { td, checkbox };
      };

      const enabledCell = createBooleanCell(entry.enabled !== false, () => {
        entry.enabled = enabledCell.checkbox.checked;
        refreshEntryRowEffects(node.id, "enabled");
      });

      const regexCell = createBooleanCell(entry.regex === true, () => {
        entry.regex = regexCell.checkbox.checked;
        row.dataset.searchValue = composeEntrySearchValue(entry);
        refreshEntryRowEffects(node.id, "regex");
      });

      const basicCell = createBooleanCell(
        effectiveKind === "token-rules" && entry.match_target === "basic_form",
        () => {
          entry.match_target = basicCell.checkbox.checked ? "basic_form" : null;
          refreshEntryRowEffects(node.id, "basic_match");
        }
      );
      basicCell.checkbox.disabled = effectiveKind !== "token-rules";
      basicCell.checkbox.title = effectiveKind === "token-rules"
        ? "変更前を辞書形 basic_form に対して一致させる"
        : "dictionary-rules では使用しません";

      const createTextCell = (value, options, onInput) => {
        const td = document.createElement("td");
        const input = createCompactInput(value, options);
        input.addEventListener("input", () => onInput(input.value));
        td.appendChild(input);
        return td;
      };

      const fromTd = createTextCell(entry.from, { min: 2, max: 24 }, (value) => {
        entry.from = value;
        entry.from_options = normalizeFromOptions(value);
        row.dataset.searchValue = composeEntrySearchValue(entry);
        refreshEntryRowEffects(node.id, "from");
      });

      const toTd = createTextCell(entry.to, { min: 2, max: 24 }, (value) => {
        entry.to = value;
        row.dataset.searchValue = composeEntrySearchValue(entry);
        refreshEntryRowEffects(node.id, "to");
      });

      const priorityTd = createTextCell(String(entry.priority ?? 90), {
        type: "number",
        min: 3,
        max: 6,
        className: "cell-input compact"
      }, (value) => {
        entry.priority = Number(value) || 0;
        refreshEntryRowEffects(node.id, "priority");
      });

      const currentFieldCell = (field, label) => createTextCell(
        getEntryConditionInlineValue(entry, "current", field),
        { min: 6, max: 20, placeholder: label, title: label },
        (value) => {
          setEntryConditionInlineValue(entry, "current", field, value);
          row.dataset.searchValue = composeEntrySearchValue(entry);
          refreshEntryRowEffects(node.id, `current.${field}`);
        }
      );

      const actionTd = document.createElement("td");
      actionTd.className = "action-col";
      const detailButton = createButton(entry.metaOpen ? "閉じる" : "条件", "ghost", () => {
        entry.metaOpen = !entry.metaOpen;
        renderApp();
      });
      detailButton.title = entry.metaOpen ? "条件を閉じる" : "条件を開く";
      if (effectiveKind !== "token-rules") {
        detailButton.disabled = true;
        detailButton.title = "dictionary-rules では条件・sequence を使いません";
      }
      actionTd.appendChild(detailButton);
      actionTd.appendChild(createButton("削除", "danger row-delete", () => {
        node.entries.splice(entryIndex, 1);
        renderApp();
      }));

      row.append(
        checkTd,
        dragTd,
        enabledCell.td,
        regexCell.td,
        basicCell.td,
        fromTd,
        toTd,
        priorityTd,
        currentFieldCell("surface", "現.surface"),
        currentFieldCell("basic", "現.basic"),
        currentFieldCell("pos", "現.pos"),
        currentFieldCell("pos1", "現.pos1"),
        currentFieldCell("cform", "現.cform"),
        currentFieldCell("ctype", "現.ctype"),
        actionTd
      );
      tbody.appendChild(row);

      if (effectiveKind === "token-rules" && entry.metaOpen) {
        const detailRow = document.createElement("tr");
        const detailCell = document.createElement("td");
        detailCell.colSpan = 15;

        const detailWrap = document.createElement("div");
        detailWrap.className = "panel-block";
        const detailHead = document.createElement("div");
        detailHead.className = "panel-head";
        const detailTitle = document.createElement("h4");
        detailTitle.textContent = "条件";
        const detailHint = document.createElement("span");
        detailHint.className = "count";
        detailHint.textContent = "前条件・現条件・後条件・sequence を編集";
        detailHead.append(detailTitle, detailHint);

        const detailGrid = document.createElement("div");
        detailGrid.style.display = "grid";
        detailGrid.style.gap = "6px";
        detailGrid.replaceChildren(
          renderConditionGroupEditor(entry, "prev", "前"),
          renderConditionGroupEditor(entry, "current", "現"),
          renderConditionGroupEditor(entry, "next", "後"),
          renderSequenceEditorV3(entry)
        );
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
    wrapper.appendChild(tableWrap);
    return wrapper;
  };

  const renderNodeSection = ({ node, parentChildren, index, depth = 0, isRoot = false, inheritedKind = null }) => {
    const card = document.createElement("section");
    card.className = isRoot ? "bundle-card" : "group-card";
    card.id = `node-${node.id}`;
    card.dataset.focused = state.focusedNodeId === node.id ? "true" : "false";
    const effectiveKind = isRoot
      ? (node.kind ?? "dictionary-rules")
      : (inheritedKind ?? node.kind ?? "dictionary-rules");

    const header = document.createElement("div");
    header.className = isRoot ? "bundle-head" : "group-head";
    header.addEventListener("click", () => setFocusedNode(node.id));
    header.addEventListener("dragover", (event) => {
      if (state.dragPayload?.type === "node") {
        event.preventDefault();
      }
    });
    header.addEventListener("drop", (event) => {
      if (state.dragPayload?.type !== "node") {
        return;
      }
      event.preventDefault();
      const payload = state.dragPayload;
      if (payload.nodeId === node.id || isNodeAncestorOf(payload.nodeId, node.id)) {
        state.dragPayload = null;
        return;
      }
      if (moveNodeBetweenParents(payload.nodeId, parentChildren, index)) {
        setFocusedNode(node.id);
        renderApp();
      }
      state.dragPayload = null;
    });

    const titleWrap = document.createElement("div");
    titleWrap.className = isRoot ? "bundle-title" : "group-title";
      const dragHandle = createButton("⋮⋮", "ghost", () => {});
    dragHandle.type = "button";
    dragHandle.title = t("options.dragNodes");
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", (event) => {
      state.dragPayload = { type: "node", nodeId: node.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.id);
      setFocusedNode(node.id);
    });
    dragHandle.addEventListener("dragend", () => {
      state.dragPayload = null;
    });
    titleWrap.appendChild(dragHandle);
    const collapseToggle = createButton(
      isNodeCollapsed(node.id) ? "▸" : "▾",
      "ghost",
      () => {
        setNodeCollapsed(node.id, !isNodeCollapsed(node.id));
        renderApp();
      }
    );
    collapseToggle.title = isNodeCollapsed(node.id) ? t("options.buttonExpand") : t("options.buttonCollapse");
    titleWrap.appendChild(collapseToggle);
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

    const selectedLabel = document.createElement("label");
    selectedLabel.className = "toggle";
    const selectedCheckbox = document.createElement("input");
    selectedCheckbox.type = "checkbox";
    selectedCheckbox.checked = node.selected === true;
    selectedCheckbox.addEventListener("change", () => {
      node.selected = selectedCheckbox.checked;
      renderDiagnostics();
    });
    selectedLabel.append(selectedCheckbox, document.createTextNode("選択"));
    actions.appendChild(selectedLabel);

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "toggle";
    const enabledCheckbox = document.createElement("input");
    enabledCheckbox.type = "checkbox";
    enabledCheckbox.checked = node.enabled !== false;
    enabledCheckbox.addEventListener("change", () => {
      node.enabled = enabledCheckbox.checked;
      renderDiagnostics();
    });
    enabledLabel.append(enabledCheckbox, document.createTextNode(t("options.fieldEnabled")));
    actions.appendChild(enabledLabel);

    actions.appendChild(createButton(node.bulkImportOpen === true ? "一括登録を閉じる" : t("options.bulkImportTitle"), "secondary", () => {
      node.bulkImportOpen = node.bulkImportOpen !== true;
      renderApp();
    }));
    actions.appendChild(createButton(t("options.buttonCopySelection"), "ghost", () => {
      copyCurrentSelection(false);
    }));
    actions.appendChild(createButton(t("options.buttonCutSelection"), "ghost", () => {
      copyCurrentSelection(true);
    }));
    actions.appendChild(createButton(t("options.buttonPasteHere"), "secondary", () => {
      pasteClipboardIntoNode(node.id);
    }));

    if (isRoot) {
      const kindSelect = document.createElement("select");
      kindSelect.title = t("options.bundleKindTitle");
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
    actions.appendChild(createButton(t("options.buttonAddGroup"), "secondary", () => {
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
    actions.appendChild(createButton(t("options.buttonAddEntry"), "secondary", () => {
      node.entries.push({
        id: createEntryId(),
        from: "",
        from_options: [],
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
    actions.appendChild(createButton(t("options.buttonDeleteSelection"), "danger", () => {
      if (!deleteCurrentSelection()) {
        node.entries = deleteSelectedRows(node.entries);
        renderApp();
      }
    }));

    if (isRoot) {
      actions.appendChild(createButton(t("options.buttonResetRoot"), "ghost", () => {
        resetRoot(node.id);
      }));
      if (!findBaseRoot(node.id)) {
        actions.appendChild(createButton(t("options.buttonDeleteBundle"), "warn", () => {
          parentChildren.splice(index, 1);
          renderApp();
        }));
      }
    } else {
      actions.appendChild(createButton(t("options.buttonDeleteGroup"), "warn", () => {
        parentChildren.splice(index, 1);
        renderApp();
      }));
    }

    header.append(titleWrap, actions);
    card.appendChild(header);

    if (isNodeCollapsed(node.id)) {
      return card;
    }

    if (node.bulkImportOpen === true) {
      card.appendChild(renderBulkImportPanel(node, effectiveKind));
    }

    if (node.entries.length > 0 || node.children.length === 0) {
      card.appendChild(renderEntryTableV2(node, effectiveKind));
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

    element.scrollIntoView({ block: "nearest" });
  };

  const createJumpButton = (label, target) => {
    return createButton(label, "ghost", () => {
      jumpToDiagnosticTarget(target);
    });
  };

  const createDiagnosticIssueId = (kind, parts) => {
    return `${kind}:${parts.map((part) => `${part ?? ""}`).join("|")}`;
  };

  const createDismissButton = (issueId, issueLabel) => {
    const button = createButton("×", "ghost", () => {
      dismissDiagnostic(issueId, issueLabel);
      renderDiagnostics();
    });
    button.title = t("options.diagnosticsDismissTitle");
    button.setAttribute("aria-label", `${issueLabel} を非表示`);
    return button;
  };

  const renderIssueCard = (title, issues, emptyText, getIssueId, getIssueLabel, renderRow) => {
    const card = document.createElement("section");
    card.className = "diagnostics-card";
    const visibleIssues = issues.filter((issue) => !isDiagnosticDismissed(getIssueId(issue)));

    const heading = document.createElement("h2");
    heading.textContent = title;
    card.appendChild(heading);

    const summary = document.createElement("p");
    summary.className = "diag-summary";
    summary.textContent = visibleIssues.length === 0 ? emptyText : `${visibleIssues.length} 件の問題があります。`;
    card.appendChild(summary);

    if (visibleIssues.length === 0) {
      return card;
    }

    const list = document.createElement("div");
    list.className = "diag-list";
    for (const issue of visibleIssues) {
      const issueId = getIssueId(issue);
      const issueLabel = getIssueLabel(issue);
      const row = renderRow(issue);
      const dismissWrap = document.createElement("div");
      dismissWrap.className = "panel-actions";
      dismissWrap.style.justifyContent = "flex-end";
      dismissWrap.appendChild(createDismissButton(issueId, issueLabel));
      row.appendChild(dismissWrap);
      list.appendChild(row);
    }
    card.appendChild(list);
    return card;
  };

  const renderDismissedDiagnosticsCard = () => {
    const dismissedEntries = Object.entries(getDismissedDiagnostics());
    if (dismissedEntries.length === 0) {
      return null;
    }

    const card = document.createElement("section");
    card.className = "diagnostics-card";

    const heading = document.createElement("h2");
    heading.textContent = t("options.dismissedDiagnosticsTitle");
    card.appendChild(heading);

    const summary = document.createElement("p");
    summary.className = "diag-summary";
    summary.textContent = `${dismissedEntries.length} 件を非表示中です。`;
    card.appendChild(summary);

    const actions = document.createElement("div");
    actions.className = "panel-actions";
    const list = document.createElement("div");
    list.className = "diag-list";
    list.hidden = state.dismissedDiagnosticsCollapsed !== false;
    const toggleButton = createButton(
      state.dismissedDiagnosticsCollapsed === false ? t("options.buttonCollapse") : t("options.buttonExpand"),
      "ghost",
      () => {
        state.dismissedDiagnosticsCollapsed = !(state.dismissedDiagnosticsCollapsed === false);
        saveDiagnosticUiState();
        list.hidden = state.dismissedDiagnosticsCollapsed !== false;
        toggleButton.textContent = state.dismissedDiagnosticsCollapsed === false ? t("options.buttonCollapse") : t("options.buttonExpand");
      }
    );
    actions.appendChild(toggleButton);
    actions.appendChild(createButton(t("options.diagnosticsRestoreAll"), "secondary", () => {
      restoreAllDiagnostics();
      renderDiagnostics();
    }));
    card.appendChild(actions);
    for (const [issueId, label] of dismissedEntries) {
      const item = document.createElement("div");
      item.className = "diag-item";
      const itemHeading = document.createElement("h3");
      itemHeading.textContent = label;
      const itemActions = document.createElement("div");
      itemActions.className = "panel-actions";
      itemActions.appendChild(createButton(t("options.diagnosticsRestore"), "ghost", () => {
        restoreDiagnostic(issueId);
        renderDiagnostics();
      }));
      item.append(itemHeading, itemActions);
      list.appendChild(item);
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
      ([entryKey, occurrences]) => createDiagnosticIssueId("duplicate-from", [
        entryKey,
        ...occurrences.map((occurrence) => `${occurrence.pathText}->${occurrence.to}`)
      ]),
      ([entryKey]) => `重複した変更前: ${entryKey}`,
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
          line.appendChild(createJumpButton(t("options.jumpTarget"), occurrence));
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
      ({ longer, shorter }) => createDiagnosticIssueId("overlap", [
        longer.pathText,
        longer.from,
        shorter.pathText,
        shorter.from
      ]),
      ({ longer, shorter }) => `包含: ${longer.from} ⊃ ${shorter.from}`,
      ({ longer, shorter }) => {
        const item = document.createElement("div");
        item.className = "diag-item";
        const heading = document.createElement("h3");
        heading.textContent = `${longer.from} ⊃ ${shorter.from}`;
        const body = document.createElement("div");
        body.className = "diag-occurrence";

        const longerLine = document.createElement("div");
        longerLine.appendChild(createJumpButton(t("options.jumpLonger"), longer));
        longerLine.append(` ${longer.pathText} -> ${longer.to}`);

        const shorterLine = document.createElement("div");
        shorterLine.appendChild(createJumpButton(t("options.jumpShorter"), shorter));
        shorterLine.append(` ${shorter.pathText} -> ${shorter.to}`);

        body.append(longerLine, shorterLine);
        item.append(heading, body);
        return item;
      }
    ));

    diagnosticsRoot.appendChild(renderIssueCard(
      "重複したグループ名",
      diagnostics.duplicateNodeLabelIssues,
      "競合はありません。",
      ([labelKey, paths]) => createDiagnosticIssueId("duplicate-group", [labelKey, ...paths]),
      ([, paths]) => `重複したグループ名: ${paths[0].split(" / ").slice(-1)[0]}`,
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

    const dismissedCard = renderDismissedDiagnosticsCard();
    if (dismissedCard) {
      diagnosticsRoot.appendChild(dismissedCard);
    }
  };

  const renderTokenizerResult = (tokens) => {
    tokenizerResult.textContent = "";
    tokens.forEach((token, index) => {
      const row = document.createElement("tr");
      const indexTd = document.createElement("td");
      indexTd.textContent = `${index + 1}`;
      row.appendChild(indexTd);

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

      const actionTd = document.createElement("td");
      actionTd.className = "action-col";
      actionTd.appendChild(createButton(t("options.tokenizerAdd"), "secondary", () => {
        const targetNode = getPreferredPasteTargetNode() ?? state.roots[0] ?? null;
        if (!targetNode) {
          setStatus(t("options.tokenizerNoTarget"), "error");
          return;
        }

        const currentCondition = {};
        const conditionPairs = [
          ["surface", token.surface_form],
          ["basic", token.basic_form],
          ["pos", token.pos],
          ["pos1", token.pos_detail_1],
          ["pos2", token.pos_detail_2],
          ["pos3", token.pos_detail_3],
          ["ctype", token.conjugated_type],
          ["cform", token.conjugated_form],
          ["reading", token.reading]
        ];
        for (const [key, value] of conditionPairs) {
          const normalizedValue = `${value ?? ""}`.trim();
          if (normalizedValue) {
            currentCondition[key] = normalizedValue;
          }
        }

        const entry = normalizeEntryFromObject({
          from: `${token.surface_form ?? ""}`.trim(),
          to: `${token.surface_form ?? ""}`.trim(),
          priority: 90,
          enabled: true,
          regex: false,
          match_target: token.basic_form && token.basic_form !== token.surface_form ? "basic_form" : null,
          conditions: Object.keys(currentCondition).length > 0
            ? { current: [currentCondition] }
            : null
        }, 90);

        if (!entry || !entry.from) {
          setStatus(t("options.tokenizerInvalid"), "error");
          return;
        }

        entry.metaOpen = true;
        targetNode.entries.push(entry);
        setFocusedNode(targetNode.id);
        state.activeTab = "bundles";
        renderApp();
        setStatus(`「${entry.from}」を ${targetNode.label || "Group"} に追加しました。`, "success");
      }));
      row.appendChild(actionTd);

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
    setStatus(`形態素解析で ${tokens.length} 件を解析しました。`, "success");
  };

  const renderTabState = () => {
    const bundlesActive = state.activeTab === "bundles";
    const diagnosticsActive = state.activeTab === "diagnostics";
    const tokenizerActive = state.activeTab === "tokenizer";
    const hotkeysActive = state.activeTab === "hotkeys";
    const sitesActive = state.activeTab === "sites";
    panelBundles.hidden = !bundlesActive;
    panelDiagnostics.hidden = !diagnosticsActive;
    panelTokenizer.hidden = !tokenizerActive;
    panelHotkeys.hidden = !hotkeysActive;
    panelSites.hidden = !sitesActive;
    tabBundlesButton.setAttribute("aria-selected", bundlesActive ? "true" : "false");
    tabDiagnosticsButton.setAttribute("aria-selected", diagnosticsActive ? "true" : "false");
    tabTokenizerButton.setAttribute("aria-selected", tokenizerActive ? "true" : "false");
    tabHotkeysButton.setAttribute("aria-selected", hotkeysActive ? "true" : "false");
    tabSitesButton.setAttribute("aria-selected", sitesActive ? "true" : "false");
    tabBundlesButton.className = bundlesActive ? "tab-button secondary" : "tab-button ghost";
    tabDiagnosticsButton.className = diagnosticsActive ? "tab-button secondary" : "tab-button ghost";
    tabTokenizerButton.className = tokenizerActive ? "tab-button secondary" : "tab-button ghost";
    tabHotkeysButton.className = hotkeysActive ? "tab-button secondary" : "tab-button ghost";
    tabSitesButton.className = sitesActive ? "tab-button secondary" : "tab-button ghost";
  };

  const getNodeTrailById = (nodeId, nodes = state.roots, trail = []) => {
    for (const node of nodes) {
      const nextTrail = [...trail, node];
      if (node.id === nodeId) {
        return nextTrail;
      }
      const nested = getNodeTrailById(nodeId, node.children ?? [], nextTrail);
      if (nested) {
        return nested;
      }
    }
    return null;
  };

  const getNodeById = (nodeId) => findNodeLocation(nodeId)?.node ?? null;

  const renderTreeNode = (node, depth = 0) => {
    const row = document.createElement("div");
    row.className = "explorer-row";
    row.style.paddingLeft = `${depth * 14 + 8}px`;
    row.dataset.selected = state.bundleUi.selectedNodeId === node.id ? "true" : "false";
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      state.dragPayload = { type: "node", nodeId: node.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.id);
    });
    row.addEventListener("dragend", () => {
      state.dragPayload = null;
    });
    row.addEventListener("dragover", (event) => {
      if (state.dragPayload?.type === "node") {
        event.preventDefault();
      }
    });
    row.addEventListener("drop", (event) => {
      if (state.dragPayload?.type !== "node") {
        return;
      }
      event.preventDefault();
      const payload = state.dragPayload;
      const location = findNodeLocation(node.id);
      if (!location || payload.nodeId === node.id || isNodeAncestorOf(payload.nodeId, node.id)) {
        state.dragPayload = null;
        return;
      }
      if (moveNodeBetweenParents(payload.nodeId, location.parentChildren, location.index)) {
        renderApp();
      }
      state.dragPayload = null;
    });

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className = "icon-button";
    expandButton.textContent = hasChildren ? (state.bundleUi.expandedTreeIds?.[node.id] === false ? "▸" : "▾") : "•";
    expandButton.title = hasChildren ? "表示切替" : "leaf";
    expandButton.disabled = !hasChildren;
    expandButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const isExpanded = state.bundleUi.expandedTreeIds?.[node.id] !== false;
      state.bundleUi.expandedTreeIds = {
        ...(state.bundleUi.expandedTreeIds ?? {}),
        [node.id]: isExpanded ? false : true
      };
      if (state.bundleUi.expandedTreeIds[node.id] === true) {
        delete state.bundleUi.expandedTreeIds[node.id];
      }
      saveBundleUiState();
      renderBundles();
    });
    row.appendChild(expandButton);

    const labelButton = document.createElement("button");
    labelButton.type = "button";
    labelButton.className = "tree-label";
    labelButton.textContent = node.label || "Group";
    labelButton.addEventListener("click", () => {
      state.bundleUi.selectedNodeId = node.id;
      saveBundleUiState();
      renderBundles();
    });
    row.appendChild(labelButton);

    const wrap = document.createElement("div");
    wrap.appendChild(row);
    const isExpanded = state.bundleUi.expandedTreeIds?.[node.id] !== false;
    if (hasChildren && isExpanded) {
      const childWrap = document.createElement("div");
      node.children.forEach((child) => {
        childWrap.appendChild(renderTreeNode(child, depth + 1));
      });
      wrap.appendChild(childWrap);
    }
    return wrap;
  };

  const renderBundles = () => {
    bundleRoot.textContent = "";
    const workspace = document.createElement("section");
    workspace.className = "bundle-workspace";

    const left = document.createElement("aside");
    left.className = "bundle-explorer";
    const explorerHead = document.createElement("div");
    explorerHead.className = "workspace-head";
    const explorerTitle = document.createElement("h3");
    explorerTitle.textContent = "Explorer";
    explorerHead.appendChild(explorerTitle);
    left.appendChild(explorerHead);
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "tree-root-button";
    allButton.dataset.selected = state.bundleUi.selectedNodeId === "__all__" ? "true" : "false";
    allButton.textContent = t("options.explorerAll");
    allButton.addEventListener("click", () => {
      state.bundleUi.selectedNodeId = "__all__";
      saveBundleUiState();
      renderBundles();
    });
    left.appendChild(allButton);
    const tree = document.createElement("div");
    tree.className = "explorer-tree";
    state.roots.forEach((root) => {
      tree.appendChild(renderTreeNode(root));
    });
    left.appendChild(tree);

    const right = document.createElement("div");
    right.className = "bundle-grid-shell";

    {
      const controls = document.createElement("div");
      controls.className = "workspace-toolbar";
      const controlsLeft = document.createElement("div");
      controlsLeft.className = "workspace-toolbar-group";

      const search = document.createElement("input");
      search.type = "text";
      search.className = "grid-search";
      search.placeholder = t("options.searchPlaceholder");
      search.value = state.bundleUi.searchText ?? "";
      search.addEventListener("input", () => {
        state.bundleUi.searchText = search.value;
        saveBundleUiState();
        renderBundles();
      });
      controlsLeft.appendChild(search);

      const scopeLabel = document.createElement("span");
      scopeLabel.className = "count";
      if (state.bundleUi.selectedNodeId === "__all__") {
        scopeLabel.textContent = `${state.roots.length} bundles`;
      } else {
        scopeLabel.textContent = getNodeTrailById(state.bundleUi.selectedNodeId)?.map((item) => item.label).join(" / ") ?? "";
      }
      controlsLeft.appendChild(scopeLabel);
      controls.appendChild(controlsLeft);

      const controlsRight = document.createElement("div");
      controlsRight.className = "workspace-toolbar-group";
      if (state.undoAction) {
        controlsRight.appendChild(createButton(`Undo: ${state.undoAction.label}`, "ghost", () => {
          runUndoAction();
        }));
      }
      controls.appendChild(controlsRight);
      right.appendChild(controls);

      const content = document.createElement("div");
      content.className = "bundle-sections";
      const searchText = `${state.bundleUi.searchText ?? ""}`.trim().toLowerCase();

      const appendNodeSection = ({ node, parentChildren, index, isRoot = false, inheritedKind = null }) => {
        const section = renderNodeSection({
          node,
          parentChildren,
          index,
          isRoot,
          inheritedKind
        });
        if (!searchText || `${section.textContent ?? ""}`.toLowerCase().includes(searchText)) {
          content.appendChild(section);
        }
      };

      if (state.bundleUi.selectedNodeId === "__all__") {
        state.roots.forEach((root, index) => {
          appendNodeSection({
            node: root,
            parentChildren: state.roots,
            index,
            isRoot: true
          });
        });
      } else {
        const location = findNodeLocation(state.bundleUi.selectedNodeId);
        if (location) {
          appendNodeSection({
            node: location.node,
            parentChildren: location.parentChildren,
            index: location.index,
            isRoot: !location.parentNode,
            inheritedKind: location.parentNode?.kind ?? null
          });
        }
      }

      if (content.childElementCount === 0) {
        const empty = document.createElement("p");
        empty.className = "diag-summary";
        empty.textContent = searchText
          ? "検索条件に一致する bundle / group / rule はありません。"
          : "表示できる bundle がありません。";
        content.appendChild(empty);
      }

      right.appendChild(content);
      workspace.append(left, right);
      bundleRoot.appendChild(workspace);
      return;
    }

  };

  const renderRuntimeSettings = () => {
    runtimeGlobalEnabledInput.checked = state.runtimeSettings.globalEnabled !== false;
    runtimeSkipEditableInput.checked = state.runtimeSettings.skipEditableInputs === true;
  };

  const renderHotkeys = () => {
    if (!hotkeysRoot) {
      return;
    }

    hotkeysRoot.textContent = "";
    const commands = Array.isArray(state.commands) ? state.commands : [];

    if (commands.length === 0) {
      const empty = document.createElement("p");
      empty.className = "diag-summary";
      empty.textContent = t("options.noCommands");
      hotkeysRoot.appendChild(empty);
      return;
    }

    commands.forEach((command) => {
      const row = document.createElement("div");
      row.className = "simple-row";

      const title = document.createElement("strong");
      title.textContent = command.name || command.description || "command";
      row.appendChild(title);

      const description = document.createElement("span");
      description.className = "diag-summary";
      description.textContent = command.description || "";
      row.appendChild(description);

      const shortcut = document.createElement("span");
      shortcut.className = "shortcut-pill";
      shortcut.textContent = command.shortcut || t("options.noShortcut");
      row.appendChild(shortcut);

      hotkeysRoot.appendChild(row);
    });
  };

  const renderDisabledSites = () => {
    if (!sitesRoot) {
      return;
    }

    sitesRoot.textContent = "";

    const list = [...state.disabledSites.domains];
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "diag-summary";
      empty.textContent = t("options.noDisabledSites");
      sitesRoot.appendChild(empty);
    }

    list.forEach((domain, index) => {
      const row = document.createElement("div");
      row.className = "simple-row";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "domain-input";
      input.value = domain;
      input.addEventListener("change", () => {
        state.disabledSites.domains[index] = input.value.trim().toLowerCase();
      });
      row.appendChild(input);
      row.appendChild(createButton(t("options.buttonDelete"), "danger", () => {
        state.disabledSites.domains.splice(index, 1);
        state.disabledSites = normalizeDisabledSites(state.disabledSites);
        renderDisabledSites();
      }));
      sitesRoot.appendChild(row);
    });

    const addRow = document.createElement("div");
    addRow.className = "simple-row";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "domain-input";
    addInput.placeholder = "example.com";
    addRow.appendChild(addInput);
    addRow.appendChild(createButton(t("options.buttonAdd"), "secondary", () => {
      const domain = addInput.value.trim().toLowerCase();
      if (!domain) {
        return;
      }

      state.disabledSites.domains.push(domain);
      state.disabledSites = normalizeDisabledSites(state.disabledSites);
      renderDisabledSites();
    }));
    sitesRoot.appendChild(addRow);
  };

  const countNodeEntriesDeep = (node) => {
    const ownEntries = Array.isArray(node?.entries) ? node.entries.length : 0;
    const childEntries = Array.isArray(node?.children)
      ? node.children.reduce((total, child) => total + countNodeEntriesDeep(child), 0)
      : 0;
    return ownEntries + childEntries;
  };

  const renderApp = () => {
    renderRuntimeSettings();
    renderBundles();
    renderDiagnostics();
    renderHotkeys();
    renderDisabledSites();
    renderTabState();
    normalizeUiTree(document.body);
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
        throw new Error(`鬮ｫ・ｱ繝ｻ・ｭ鬮ｴ雜｣・ｽ・ｼ驍ｵ・ｺ繝ｻ・ｫ髯樊ｻゑｽｽ・ｱ髫ｰ・ｨ陷会ｽｱ繝ｻ・ｰ驍ｵ・ｺ繝ｻ・ｾ驍ｵ・ｺ陷会ｽｱ隨ｳ繝ｻ ${yamlError.message}`);
      }
    }

    const importedRoots = normalizeImportedRoots(parsed);
    state.roots = importedRoots;
    state.runtimeSettings = extractRuntimeSettings(parsed);
    state.disabledSites = extractDisabledSites(parsed);
    state.popupBundleId = extractPopupBundleId(parsed);
    ensurePopupBundleRoot(state.roots);
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

    const [storedPayload, storedDiagnosticUiState, storedBundleUiState] = await Promise.all([
      storageGet(STORAGE_KEY),
      storageGet(DIAGNOSTIC_UI_STATE_KEY),
      storageGet(BUNDLE_UI_STATE_KEY)
    ]);
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
    state.runtimeSettings = extractRuntimeSettings(storedPayload);
    state.disabledSites = extractDisabledSites(storedPayload);
    state.popupBundleId = extractPopupBundleId(storedPayload);
    ensurePopupBundleRoot(state.roots);
    state.commands = await getAllCommands();
    state.dismissedDiagnostics = storedDiagnosticUiState?.dismissedDiagnostics && typeof storedDiagnosticUiState.dismissedDiagnostics === "object"
      ? storedDiagnosticUiState.dismissedDiagnostics
      : {};
    state.dismissedDiagnosticsCollapsed = storedDiagnosticUiState?.collapsed !== false;
    state.collapsedNodes = storedDiagnosticUiState?.collapsedNodes && typeof storedDiagnosticUiState.collapsedNodes === "object"
      ? storedDiagnosticUiState.collapsedNodes
      : {};
    state.bundleUi = normalizeBundleUiState(storedBundleUiState);
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
      await saveAllAndNotify();
      setStatus("設定を保存しました。現在のタブへ即時反映しました。", "success");
    } catch (error) {
      console.error(error);
      setStatus(`保存に失敗しました: ${error.message}`, "error");
    }
  });

  runtimeSkipEditableInput.addEventListener("change", () => {
    state.runtimeSettings.skipEditableInputs = runtimeSkipEditableInput.checked;
    setStatus("runtime 設定を更新しました。保存すると本文へ反映されます。", "info");
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
    applyDefaultState();
    renderApp();
    setStatus("既定値へ戻しました。", "info");
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
      setStatus(`JSON の書き出しに失敗しました: ${error.message}`, "error");
    }
  });

  exportYamlButton.addEventListener("click", () => {
    try {
      exportSettingsAsYaml();
    } catch (error) {
      console.error(error);
      setStatus(`YAML の書き出しに失敗しました: ${error.message}`, "error");
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

  tabHotkeysButton?.addEventListener("click", () => {
    state.activeTab = "hotkeys";
    renderTabState();
  });

  tabSitesButton?.addEventListener("click", () => {
    state.activeTab = "sites";
    renderTabState();
  });

  runtimeGlobalEnabledInput?.addEventListener("change", () => {
    state.runtimeSettings.globalEnabled = runtimeGlobalEnabledInput.checked;
    setStatus("拡張全体の有効状態を更新しました。保存すると即時反映されます。", "info");
  });

  openShortcutsButton?.addEventListener("click", async () => {
    try {
      await sendRuntimeMessage({ type: MESSAGE_TYPES.OPEN_SHORTCUTS_PAGE });
    } catch (error) {
      console.error(error);
      setStatus(`ショートカット画面を開けませんでした: ${error.message}`, "error");
    }
  });

  addCurrentSiteButton?.addEventListener("click", async () => {
    try {
      const activeTab = await getActiveTab();
      const hostname = activeTab?.url ? new URL(activeTab.url).hostname.toLowerCase() : "";
      if (!hostname) {
        setStatus("現在サイトの取得に失敗しました。", "error");
        return;
      }

      state.disabledSites.domains.push(hostname);
      state.disabledSites = normalizeDisabledSites(state.disabledSites);
      renderDisabledSites();
      setStatus(`${hostname} を無効サイトへ追加しました。保存すると反映されます。`, "info");
    } catch (error) {
      console.error(error);
      setStatus(`現在サイトの追加に失敗しました: ${error.message}`, "error");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (state.activeTab !== "bundles") {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    const key = `${event.key ?? ""}`.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier && key === "c") {
      event.preventDefault();
      copyCurrentSelection(false);
      return;
    }

    if (modifier && key === "x") {
      event.preventDefault();
      copyCurrentSelection(true);
      return;
    }

    if (modifier && key === "v") {
      event.preventDefault();
      pasteClipboardIntoNode();
      return;
    }

    if (key === "delete" || key === "backspace") {
      if (deleteCurrentSelection()) {
        event.preventDefault();
      }
    }
  });

  normalizeUiTree(document.body);

  initialize().catch((error) => {
    console.error(error);
    setStatus(`初期化に失敗しました: ${error.message}`, "error");
  });
})();

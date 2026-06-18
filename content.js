// content.js
// Manifest で lib/json5.min.js → lib/kuromoji.js → content.js の順に読み込む前提。
// そのため、このファイルでは import / script 注入 / top-level await を使わない。

(() => {
  "use strict";

  const DEBUG = false;
  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const TRANSFORM_WORKER_PATH = "transform-worker.js";
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
  const WORKER_BATCH_SIZE = 32;
  const MAX_RUNS_PER_ROOT_BATCH = 24;
  const MUTATION_DEBOUNCE_MS = 120;
  const RECENT_WRITE_TTL_MS = 400;
  const DEBUG_HISTORY_LIMIT = 20;
  const RUNTIME_METRIC_COUNTER_FIELDS = Object.freeze([
    "tokenizeCalls",
    "tokenizeSkipped",
    "textCacheHits",
    "textCacheMisses",
    "textCacheBypasses",
    "tokenCacheHits",
    "tokenCacheMisses",
    "tokenCacheBypasses",
    "processingMsTotal",
    "dictionaryMatches",
    "regexMatches",
    "wildcardMatches",
    "changedRuns",
    "queuedRoots",
    "mutationBatches"
  ]);
  const MESSAGE_TYPES = {
    APPLY_SETTINGS_UPDATE: "APPLY_SETTINGS_UPDATE",
    GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
    GET_TAB_RUNTIME_STATE: "GET_TAB_RUNTIME_STATE",
    GET_RUNTIME_DEBUG_SNAPSHOT: "GET_RUNTIME_DEBUG_SNAPSHOT"
  };
  const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
    skipEditableInputs: false,
    globalEnabled: true,
    ruby: Object.freeze({
      enabled: true,
      hidden: false,
      default_markers: Object.freeze({
        open: "《",
        close: "》"
      })
    })
  });
  const DEFAULT_DISABLED_SITES = Object.freeze({
    domains: []
  });
  const DEFAULT_PAGE_RUBY_SETTINGS = Object.freeze({
    url_overrides: {},
    domain_defaults: {}
  });
  const RUBY_RUN_ATTRIBUTE = "data-jpn-transform-ruby-run";
  const RUBY_SOURCE_ATTRIBUTE = "data-jpn-transform-ruby-source";
  const TransformShared = globalThis.TransformShared;
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
  let nodeStateCache = new WeakMap();
  const runIdByRunAnchor = new WeakMap();
  const pendingWorkerRuns = new Map();
  const pendingRootQueue = new Map();
  const pendingMutationRoots = new Set();
  const composingEditableHosts = new WeakSet();
  let recentWriteRoots = new WeakMap();
  const json5ResourcePromiseCache = new Map();

  let visibleFlushHandle = null;
  let visibleFlushHandleType = null;
  let backgroundFlushHandle = null;
  let backgroundFlushHandleType = null;
  let scrollRefreshScheduled = false;
  let activeTransformStages = [];
  let activeCompiledPlan = null;
  let activeDictionaryOnlyStages = [];
  let activeTokenRules = [];
  let activeStringRules = [];
  let activeTokenizer = null;
  let activeRuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  let activeDisabledSites = { ...DEFAULT_DISABLED_SITES };
  let activePageRubySettings = { ...DEFAULT_PAGE_RUBY_SETTINGS };
  let activePopupBundleId = DEFAULT_POPUP_BUNDLE_ID;
  let activeTabDisabled = false;
  let lastTransformDebug = null;
  let lastRubyDebug = null;
  let activeLoadedBundles = [];
  let activeManifestBundleIds = [];
  let cachedOrderedRuleResourcesPromise = null;
  let tokenizerPromise = null;
  let tokenizerWarmupRevision = 0;
  let runtimeRevision = 0;
  let transformWorker = null;
  let transformWorkerBlobUrl = null;
  let transformWorkerReady = false;
  let transformWorkerFailed = false;
  let transformWorkerConfigurePromise = null;
  let transformWorkerConfigureResolve = null;
  let nextWorkerJobId = 1;
  let nextWorkerRunId = 1;
  let workerBatchQueue = [];
  let workerBatchFlushHandle = null;
  let mutationFlushHandle = null;
  let runtimeMetrics = null;
  let workerStats = {
    enabled: false,
    pendingRuns: 0,
    completedRuns: 0,
    failedBatches: 0,
    lastError: null
  };

  if (!TransformShared) {
    throw new Error("TransformShared が未読込です。manifest.json の content_scripts の順序を確認してください。");
  }

  if (!TransformEngine) {
    throw new Error("TransformEngine が未読込です。manifest.json の content_scripts の順序を確認してください。");
  }

  const log = (...args) => {
    if (DEBUG) {
      console.log("省略変換器:", ...args);
    }
  };

  const createRuntimeMetrics = () => ({
    planVersion: null,
    compileMs: 0,
    tokenizeCalls: 0,
    tokenizeSkipped: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
    textCacheBypasses: 0,
    tokenCacheHits: 0,
    tokenCacheMisses: 0,
    tokenCacheBypasses: 0,
    processingMsTotal: 0,
    dictionaryMatches: 0,
    regexMatches: 0,
    wildcardMatches: 0,
    changedRuns: 0,
    queuedRoots: 0,
    mutationBatches: 0,
    stageTimings: {}
  });

  const resetRuntimeMetrics = (planVersion = null) => {
    runtimeMetrics = createRuntimeMetrics();
    runtimeMetrics.planVersion = planVersion;
    runtimeMetrics.compileMs = Number(activeCompiledPlan?.compileMs) || 0;
  };

  const mergeRuntimeMetrics = (delta) => {
    if (!delta || typeof delta !== "object") {
      return;
    }
    if (!runtimeMetrics) {
      resetRuntimeMetrics(delta.planVersion ?? null);
    }
    if (delta.planVersion) {
      runtimeMetrics.planVersion = delta.planVersion;
    }
    if (Number.isFinite(Number(delta.compileMs))) {
      runtimeMetrics.compileMs = Math.max(
        Number(runtimeMetrics.compileMs) || 0,
        Number(delta.compileMs)
      );
    }
    for (const key of RUNTIME_METRIC_COUNTER_FIELDS) {
      if (Number.isFinite(Number(delta[key]))) {
        runtimeMetrics[key] = (Number(runtimeMetrics[key]) || 0) + Number(delta[key]);
      }
    }
    if (delta.stageTimings && typeof delta.stageTimings === "object") {
      for (const [stageId, value] of Object.entries(delta.stageTimings)) {
        if (!Number.isFinite(Number(value))) {
          continue;
        }
        runtimeMetrics.stageTimings[stageId] = (Number(runtimeMetrics.stageTimings[stageId]) || 0) + Number(value);
      }
    }
  };

  const readNodeValueSafely = (node) => {
    try {
      return typeof node?.nodeValue === "string" ? node.nodeValue : "";
    } catch (error) {
      return "";
    }
  };

  const getRunState = (runAnchor) => {
    return runAnchor ? nodeStateCache.get(runAnchor) ?? null : null;
  };

  const setRunState = (runAnchor, state) => {
    if (!runAnchor || !state) {
      return;
    }
    nodeStateCache.set(runAnchor, state);
  };

  const clearRunState = (runAnchor) => {
    if (!runAnchor) {
      return;
    }
    nodeStateCache.delete(runAnchor);
  };

  const markRecentWriteNode = (node) => {
    if (!node) {
      return;
    }
    recentWriteRoots.set(node, {
      revision: runtimeRevision,
      timestamp: Date.now()
    });
  };

  const markRecentWriteForRun = (textNodes, extraNode = null) => {
    for (const textNode of Array.isArray(textNodes) ? textNodes : []) {
      markRecentWriteNode(textNode);
      markRecentWriteNode(textNode.parentNode);
      markRecentWriteNode(textNode.parentElement);
    }
    if (extraNode) {
      markRecentWriteNode(extraNode);
      markRecentWriteNode(extraNode.parentNode);
      markRecentWriteNode(extraNode.parentElement);
    }
  };

  const wasRecentlyWritten = (node) => {
    let current = node;
    const now = Date.now();
    while (current) {
      const record = recentWriteRoots.get(current);
      if (record && record.revision === runtimeRevision && now - record.timestamp <= RECENT_WRITE_TTL_MS) {
        return true;
      }
      current = current.parentNode ?? null;
    }
    return false;
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
        const fromCandidates = [
          `${rule?.from ?? ""}`.trim(),
          ...(Array.isArray(rule?.from_options) ? rule.from_options.map((value) => `${value ?? ""}`.trim()) : [])
        ].filter(Boolean);
        if (!fromCandidates.some((candidate) => targetSet.has(candidate))) {
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

  const collectActiveRegexRuntimeRules = () => {
    const matches = [];
    for (const stage of activeTransformStages) {
      const stageRules = Array.isArray(stage?.rules) ? stage.rules : [];
      for (const rule of stageRules) {
        if (rule?.regex !== true) {
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

  const collectShadowedRuntimeRules = (targets) => {
    const targetSet = new Set(normalizeDebugTargetList(targets));
    const seen = new Map();
    const conflicts = [];

    for (const stage of activeTransformStages) {
      const stageRules = Array.isArray(stage?.rules) ? stage.rules : [];
      for (const rule of stageRules) {
        if (!rule || rule.enabled === false || rule.regex === true) {
          continue;
        }
        const candidates = [
          `${rule.from ?? ""}`.trim(),
          ...(Array.isArray(rule.from_options) ? rule.from_options.map((value) => `${value ?? ""}`.trim()) : [])
        ].filter(Boolean);
        for (const candidate of new Set(candidates)) {
          if (targetSet.size > 0 && !targetSet.has(candidate)) {
            continue;
          }
          const current = {
            stageId: stage.id,
            stageLabel: stage.label,
            stageOrder: stage.order ?? 0,
            ruleId: rule.id ?? null,
            from: candidate,
            to: rule.to ?? "",
            priority: Number(rule.priority) || 0,
            matchOptions: cloneDebugValue(rule.match_options ?? null)
          };
          const earlier = seen.get(candidate);
          if (earlier) {
            conflicts.push({
              from: candidate,
              earlier,
              later: current,
              reason: "先行stageで変更前文字列が消費されるため、後続ruleは通常到達しません。"
            });
          } else {
            seen.set(candidate, current);
          }
        }
      }
    }

    return conflicts;
  };

  const buildRuntimeDebugSnapshot = (targets) => {
    const manifestIdSet = new Set(activeManifestBundleIds);
    const loadedBundles = Array.isArray(activeLoadedBundles) ? activeLoadedBundles : [];
    const virtualBundleIds = loadedBundles
      .filter((bundle) => bundle?.id && !manifestIdSet.has(bundle.id))
      .map((bundle) => bundle.id);
    const effectiveRuby = TransformShared.resolveEffectiveRubySettings(
      activePageRubySettings,
      activeRuntimeSettings.ruby,
      location.href,
      location.hostname
    );

    return {
      generatedAt: new Date().toISOString(),
      runtimeEnabled: isRuntimeEnabled(),
      popupBundleId: activePopupBundleId,
      tabDisabled: activeTabDisabled === true,
      runtimeSettings: cloneDebugValue(activeRuntimeSettings),
      disabledSites: cloneDebugValue(activeDisabledSites),
      pageRubySettings: cloneDebugValue(activePageRubySettings),
      effectiveRuby,
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
      planVersion: activeCompiledPlan?.planVersion ?? null,
      runtimeMetrics: cloneDebugValue(runtimeMetrics),
      pendingRootCount: pendingRootQueue.size,
      pendingMutationRootCount: pendingMutationRoots.size,
      worker: cloneDebugValue(workerStats),
      matchingRules: collectMatchingRuntimeRules(targets),
      shadowedRules: collectShadowedRuntimeRules(targets),
      regexRules: collectActiveRegexRuntimeRules(),
      lastTransformDebug: cloneDebugValue(lastTransformDebug),
      lastRubyDebug: cloneDebugValue(lastRubyDebug)
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
      globalEnabled: value?.globalEnabled !== false,
      ruby: TransformShared.normalizeRubyRuntimeSettings(value?.ruby)
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

  const normalizePageRubySettings = (value) => {
    return TransformShared.normalizePageRubySettings(value);
  };

  const getEffectiveRubyConfiguration = () => {
    return TransformShared.resolveEffectiveRubySettings(
      activePageRubySettings,
      activeRuntimeSettings.ruby,
      location.href,
      location.hostname
    );
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
      : TransformShared.normalizeReplacementCandidates(rule.to, rule?.regex === true, rule.to);

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

  const isManagedRubyContainer = (node) => {
    return node?.nodeType === Node.ELEMENT_NODE &&
      node.hasAttribute(RUBY_RUN_ATTRIBUTE);
  };

  const collectManagedRubyContainers = (root) => {
    const containers = new Set();
    if (!root) {
      return [];
    }

    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement?.closest?.(`[${RUBY_RUN_ATTRIBUTE}]`);
      if (parent) {
        containers.add(parent);
      }
      return [...containers];
    }

    if (isManagedRubyContainer(root)) {
      containers.add(root);
    }

    if (typeof root.querySelectorAll === "function") {
      root.querySelectorAll(`[${RUBY_RUN_ATTRIBUTE}]`).forEach((element) => {
        containers.add(element);
      });
    }

    return [...containers];
  };

  const restoreManagedRubyContainers = (root) => {
    const containers = collectManagedRubyContainers(root);
    for (const container of containers) {
      const sourceText = container.getAttribute(RUBY_SOURCE_ATTRIBUTE) ?? container.textContent ?? "";
      container.replaceWith(document.createTextNode(sourceText));
    }
    return containers.length;
  };

  const buildRubyRunWrapper = (sourceText, segments, options = {}) => {
    const wrapper = document.createElement("span");
    wrapper.setAttribute(RUBY_RUN_ATTRIBUTE, "1");
    wrapper.setAttribute(RUBY_SOURCE_ATTRIBUTE, sourceText);
    wrapper.style.setProperty("display", "contents", "important");

    const hidden = options.hidden === true;
    for (const segment of segments) {
      if (!segment) {
        continue;
      }

      if (segment.type === "ruby") {
        const ruby = document.createElement("ruby");
        ruby.setAttribute("data-jpn-transform-ruby", "1");
        ruby.style.setProperty("display", "ruby", "important");
        ruby.style.setProperty("ruby-position", "over", "important");
        ruby.style.setProperty("visibility", "visible", "important");
        ruby.style.setProperty("opacity", "1", "important");
        ruby.style.setProperty("font-size", "inherit", "important");
        ruby.style.setProperty("line-height", "inherit", "important");
        const rb = document.createElement("rb");
        rb.textContent = `${segment.base ?? ""}`;
        rb.style.setProperty("display", "ruby-base", "important");
        rb.style.setProperty("visibility", "visible", "important");
        rb.style.setProperty("opacity", "1", "important");
        rb.style.setProperty("font-size", "inherit", "important");
        rb.style.setProperty("line-height", "inherit", "important");
        const rt = document.createElement("rt");
        rt.textContent = `${segment.ruby ?? ""}`;
        if (hidden) {
          rt.style.setProperty("display", "none", "important");
        } else {
          rt.style.setProperty("display", "ruby-text", "important");
          rt.style.setProperty("visibility", "visible", "important");
          rt.style.setProperty("opacity", "1", "important");
          rt.style.setProperty("position", "static", "important");
          rt.style.setProperty("font-size", "0.5em", "important");
          rt.style.setProperty("line-height", "1", "important");
          rt.style.setProperty("width", "auto", "important");
          rt.style.setProperty("height", "auto", "important");
          rt.style.setProperty("overflow", "visible", "important");
          rt.style.setProperty("clip", "auto", "important");
          rt.style.setProperty("clip-path", "none", "important");
          rt.style.setProperty("transform", "none", "important");
        }
        ruby.append(rb, rt);
        wrapper.appendChild(ruby);
        continue;
      }

      wrapper.appendChild(document.createTextNode(`${segment.text ?? ""}`));
    }

    return wrapper;
  };

  const inspectRenderedRubyStyles = (wrapper) => {
    const ruby = wrapper?.querySelector?.("ruby[data-jpn-transform-ruby]");
    const rt = ruby?.querySelector?.("rt");
    if (!ruby || !rt || !ruby.isConnected) {
      return null;
    }
    const rubyStyle = window.getComputedStyle(ruby);
    const rtStyle = window.getComputedStyle(rt);
    return {
      hiddenSetting: activeRuntimeSettings.ruby?.hidden === true,
      ruby: {
        display: rubyStyle.display,
        visibility: rubyStyle.visibility,
        opacity: rubyStyle.opacity
      },
      rt: {
        text: rt.textContent ?? "",
        display: rtStyle.display,
        visibility: rtStyle.visibility,
        opacity: rtStyle.opacity,
        fontSize: rtStyle.fontSize,
        lineHeight: rtStyle.lineHeight
      }
    };
  };

  const getSafeRubyReplacementParent = (textNodes) => {
    if (!Array.isArray(textNodes) || textNodes.length === 0) {
      return null;
    }

    const firstNode = textNodes[0];
    const parent = firstNode?.parentNode;
    if (!parent || textNodes.some((node) => node?.parentNode !== parent)) {
      return null;
    }

    const childNodes = Array.from(parent.childNodes ?? []);
    const indexes = textNodes.map((node) => childNodes.indexOf(node));
    if (indexes.some((index) => index < 0)) {
      return null;
    }

    const start = Math.min(...indexes);
    const end = Math.max(...indexes);
    const nodesInRange = childNodes.slice(start, end + 1);
    if (nodesInRange.length !== textNodes.length) {
      return null;
    }

    for (let index = 0; index < nodesInRange.length; index += 1) {
      if (nodesInRange[index] !== textNodes[index] || nodesInRange[index].nodeType !== Node.TEXT_NODE) {
        return null;
      }
    }

    return parent;
  };

  const replaceTextRunWithRubyWrapper = (textNodes, wrapper) => {
    const parent = getSafeRubyReplacementParent(textNodes);
    if (!parent) {
      return false;
    }

    const firstNode = textNodes[0];
    parent.insertBefore(wrapper, firstNode);
    for (const node of textNodes) {
      node.remove();
    }
    return true;
  };

  const getSafeRubyReplacementRange = (textNodes, expectedText) => {
    if (!Array.isArray(textNodes) || textNodes.length === 0) {
      return null;
    }

    const firstNode = textNodes[0];
    const lastNode = textNodes[textNodes.length - 1];
    if (!firstNode?.isConnected || !lastNode?.isConnected) {
      return null;
    }

    const range = document.createRange();
    range.setStart(firstNode, 0);
    range.setEnd(lastNode, readNodeValueSafely(lastNode).length);
    const fragment = range.cloneContents();
    if ((fragment.textContent ?? "") !== `${expectedText ?? ""}`) {
      return null;
    }

    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const element = walker.currentNode;
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      if (
        SKIP_TAGS.has(element.tagName) ||
        DECORATION_BOUNDARY_TAGS.has(element.tagName) ||
        element.hasAttribute?.("style") ||
        element.hasAttribute?.("class")
      ) {
        return null;
      }
    }

    return range;
  };

  const replaceTextRunRangeWithRubyWrapper = (textNodes, wrapper, expectedText) => {
    const range = getSafeRubyReplacementRange(textNodes, expectedText);
    if (!range) {
      return false;
    }

    range.deleteContents();
    range.insertNode(wrapper);
    return true;
  };

  const inspectFirstNarouRubyPair = (text) => {
    const sourceText = `${text ?? ""}`;
    const openIndex = sourceText.indexOf("《");
    const closeIndex = openIndex >= 0 ? sourceText.indexOf("》", openIndex + 1) : -1;
    if (openIndex < 0 || closeIndex < 0) {
      return null;
    }
    const beforeOpen = sourceText.slice(0, openIndex);
    const barIndex = Math.max(beforeOpen.lastIndexOf("｜"), beforeOpen.lastIndexOf("|"));
    const base = barIndex >= 0 ? beforeOpen.slice(barIndex + 1) : "";
    const ruby = sourceText.slice(openIndex + 1, closeIndex);
    return {
      hasExplicitBar: barIndex >= 0,
      barIndex,
      base,
      ruby,
      limits: TransformShared.inspectRubyPairLimits(base, ruby, {
        maxBaseLength: activeRuntimeSettings.ruby?.max_base_length,
        maxRubyLength: activeRuntimeSettings.ruby?.max_ruby_length
      })
    };
  };

  const recordRubyDebug = (payload) => {
    if (!hasDebugTargets()) {
      return;
    }
    lastRubyDebug = {
      timestamp: new Date().toISOString(),
      revision: runtimeRevision,
      ...payload
    };
  };

  const resolveRubySegmentsForText = (text) => {
    if (activeRuntimeSettings.ruby?.enabled === false) {
      recordRubyDebug({
        decision: "ruby-disabled",
        transformedText: `${text ?? ""}`,
        pair: inspectFirstNarouRubyPair(text)
      });
      return null;
    }

    const effectiveRuby = getEffectiveRubyConfiguration();
    const segments = TransformShared.parseRenderableRubySegments(text, effectiveRuby.markers, {
      maxBaseLength: activeRuntimeSettings.ruby?.max_base_length,
      maxRubyLength: activeRuntimeSettings.ruby?.max_ruby_length,
      allowLooseNarouImplicitBase: true,
      allowLoosePageImplicitBase: false
    });
    const accepted = TransformShared.hasRubySegments(segments);
    if (`${text ?? ""}`.includes("《") || accepted) {
      recordRubyDebug({
        decision: accepted ? "segments-accepted" : "segments-rejected",
        transformedText: `${text ?? ""}`,
        pair: inspectFirstNarouRubyPair(text),
        effectiveMarkers: cloneDebugValue(effectiveRuby.markers),
        markerSource: effectiveRuby.source,
        maxBaseLength: activeRuntimeSettings.ruby?.max_base_length,
        maxRubyLength: activeRuntimeSettings.ruby?.max_ruby_length,
        segments: cloneDebugValue(segments)
      });
    }
    return accepted ? segments : null;
  };

  const applyTransformedRunResult = (textNodes, currentParts, sourceText, transformed, revision) => {
    const firstNode = textNodes[0];
    if (!firstNode?.isConnected) {
      return false;
    }

    const rubySegments = resolveRubySegmentsForText(transformed);
    if (rubySegments) {
      const wrapper = buildRubyRunWrapper(sourceText, rubySegments, {
        hidden: activeRuntimeSettings.ruby?.hidden === true
      });
      if (textNodes.length === 1) {
        firstNode.replaceWith(wrapper);
        markRecentWriteForRun(textNodes, wrapper);
        recordRubyDebug({
          ...(lastRubyDebug ?? {}),
          decision: "dom-applied-single-node",
          sourceText,
          transformedText: transformed,
          textNodeCount: 1,
          renderedStyles: inspectRenderedRubyStyles(wrapper)
        });
        setRunState(firstNode, {
          sourceText,
          transformedText: transformed,
          revision
        });
        return true;
      }
      if (replaceTextRunWithRubyWrapper(textNodes, wrapper)) {
        markRecentWriteForRun(textNodes, wrapper);
        recordRubyDebug({
          ...(lastRubyDebug ?? {}),
          decision: "dom-applied-shared-parent",
          sourceText,
          transformedText: transformed,
          textNodeCount: textNodes.length,
          renderedStyles: inspectRenderedRubyStyles(wrapper)
        });
        setRunState(firstNode, {
          sourceText,
          transformedText: transformed,
          revision
        });
        return true;
      }
      if (replaceTextRunRangeWithRubyWrapper(textNodes, wrapper, currentParts.join(""))) {
        markRecentWriteForRun(textNodes, wrapper);
        recordRubyDebug({
          ...(lastRubyDebug ?? {}),
          decision: "dom-applied-range",
          sourceText,
          transformedText: transformed,
          textNodeCount: textNodes.length,
          renderedStyles: inspectRenderedRubyStyles(wrapper)
        });
        setRunState(firstNode, {
          sourceText,
          transformedText: transformed,
          revision
        });
        return true;
      }
      recordRubyDebug({
        ...(lastRubyDebug ?? {}),
        decision: "dom-replacement-rejected",
        sourceText,
        transformedText: transformed,
        textNodeCount: textNodes.length
      });
    }

    if (transformed === currentParts.join("")) {
      setRunState(firstNode, {
        sourceText,
        transformedText: transformed,
        revision
      });
      return false;
    }

    redistributeTransformedText(textNodes, currentParts, transformed);
    markRecentWriteForRun(textNodes);
    setRunState(firstNode, {
      sourceText,
      transformedText: transformed,
      revision
    });
    return true;
  };

  const isSkippableTextNode = (node) => {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return true;
    }

    const parent = node.parentElement;
    if (!parent) {
      return true;
    }

    if (parent.closest?.(`[${RUBY_RUN_ATTRIBUTE}]`)) {
      return true;
    }

    if (parent.closest?.("ruby")) {
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

  const createRunWalker = (root) => {
    if (!root) {
      return null;
    }

    const initialNode = root.nodeType === Node.DOCUMENT_NODE ? root.body : root;
    if (!initialNode) {
      return null;
    }

    const stack = [{
      node: initialNode,
      childIndex: -1,
      entered: false,
      isRoot: true,
      boundary: false
    }];
    let currentRun = [];

    const flushRun = () => {
      if (currentRun.length === 0) {
        return null;
      }
      const run = currentRun;
      currentRun = [];
      return run;
    };

    return {
      nextRun() {
        while (stack.length > 0) {
          const frame = stack[stack.length - 1];
          const node = frame.node;

          if (!frame.entered) {
            frame.entered = true;

            if (node.nodeType === Node.TEXT_NODE) {
              stack.pop();
              if (!isSkippableTextNode(node)) {
                currentRun.push(node);
              }
              continue;
            }

            if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
              stack.pop();
              continue;
            }

            if (node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(node.tagName)) {
              stack.pop();
              continue;
            }

            frame.boundary = node.nodeType === Node.ELEMENT_NODE && !frame.isRoot && isRunBoundaryElement(node);
            if (frame.boundary) {
              const runBeforeBoundary = flushRun();
              if (runBeforeBoundary) {
                return runBeforeBoundary;
              }
            }
          }

          if (frame.childIndex + 1 < node.childNodes.length) {
            frame.childIndex += 1;
            stack.push({
              node: node.childNodes[frame.childIndex],
              childIndex: -1,
              entered: false,
              isRoot: false,
              boundary: false
            });
            continue;
          }

          stack.pop();
          if (frame.boundary) {
            const runAfterBoundary = flushRun();
            if (runAfterBoundary) {
              return runAfterBoundary;
            }
          }
        }

        return flushRun();
      }
    };
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

    for (const child of body.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!isSkippableTextNode(child)) {
          roots.set(body, body);
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

      roots.set(child, child);
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

  const loadRuntimeConfiguration = (storedValue = {}) => {
    return {
      runtimeSettings: normalizeRuntimeSettings(storedValue?.runtime_settings),
      disabledSites: normalizeDisabledSites(storedValue?.disabled_sites),
      popupBundleId: `${storedValue?.popup_bundle_id ?? DEFAULT_POPUP_BUNDLE_ID}`.trim() || DEFAULT_POPUP_BUNDLE_ID,
      pageRubySettings: normalizePageRubySettings(storedValue?.page_ruby_settings)
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

  const loadOrderedRules = (resources, storedValue = {}) => {
    const { bundleManifest, bundleFiles, manifestBundleIds } = resources;
    const bundleOverrides = TransformEngine.normalizeBundleOverridesPayload(storedValue);

    const loaded = TransformEngine.loadStagesFromDefinitions(bundleManifest, bundleFiles, bundleOverrides);
    log("隱ｭ霎ｼ ordered bundles", loaded.bundles);
    log("隱ｭ霎ｼ transform stages", loaded.stages);
    return {
      ...loaded,
      manifestBundleIds
    };
  };

  const canUseWorkerForTransform = () => {
    return !DEBUG &&
      !hasDebugTargets() &&
      transformWorker &&
      transformWorkerReady &&
      !transformWorkerFailed;
  };

  const resolveTransformWorkerConfigure = (value) => {
    if (typeof transformWorkerConfigureResolve === "function") {
      transformWorkerConfigureResolve(value);
    }
    transformWorkerConfigureResolve = null;
    transformWorkerConfigurePromise = null;
  };

  const revokeTransformWorkerBlobUrl = () => {
    if (!transformWorkerBlobUrl) {
      return;
    }
    try {
      globalThis.URL?.revokeObjectURL?.(transformWorkerBlobUrl);
    } catch (error) {
      // Best effort cleanup only.
    }
    transformWorkerBlobUrl = null;
  };

  const attachTransformWorkerHandlers = (worker) => {
    worker.onmessage = handleTransformWorkerMessage;
    worker.onerror = (event) => {
      markTransformWorkerFailed(new Error(event?.message ?? "transform worker error"));
    };
    worker.onmessageerror = () => {
      markTransformWorkerFailed(new Error("transform worker message error"));
    };
  };

  const createBlobBootstrappedWorker = () => {
    if (typeof Blob !== "function" || !globalThis.URL?.createObjectURL) {
      throw new Error("Blob worker bootstrap is not available.");
    }
    const extensionBaseUrl = chrome.runtime.getURL("");
    const workerScriptUrl = chrome.runtime.getURL(TRANSFORM_WORKER_PATH);
    const bootstrapSource = [
      `self.__jpnTransformExtensionBase = ${JSON.stringify(extensionBaseUrl)};`,
      `importScripts(${JSON.stringify(workerScriptUrl)});`
    ].join("\n");
    const blobUrl = globalThis.URL.createObjectURL(new Blob([bootstrapSource], { type: "application/javascript" }));
    try {
      const worker = new Worker(blobUrl);
      transformWorkerBlobUrl = blobUrl;
      return worker;
    } catch (error) {
      try {
        globalThis.URL.revokeObjectURL(blobUrl);
      } catch (revokeError) {
        // Best effort cleanup only.
      }
      throw error;
    }
  };

  const markTransformWorkerFailed = (error) => {
    const message = error?.message ?? `${error ?? "unknown worker error"}`;
    transformWorkerFailed = true;
    transformWorkerReady = false;
    workerStats.enabled = false;
    workerStats.lastError = message;
    workerStats.failedBatches += 1;

    if (transformWorker) {
      try {
        transformWorker.terminate();
      } catch (terminateError) {
        // Ignore terminate errors; the fallback path below is authoritative.
      }
    }
    transformWorker = null;
    revokeTransformWorkerBlobUrl();
    workerBatchQueue = [];
    if (workerBatchFlushHandle !== null) {
      window.clearTimeout(workerBatchFlushHandle);
      workerBatchFlushHandle = null;
    }
    pendingWorkerRuns.clear();
    resolveTransformWorkerConfigure(false);
    console.warn("省略変換器: Worker 変換を無効化し main thread fallback に切替", message);
    if (isRuntimeEnabled()) {
      pendingRootQueue.clear();
      cancelRootFlushes();
      queueProcessableRoots(collectDocumentProcessingRoots(), { priority: "visible", restoreFirst: true });
    }
  };

  const getOrCreateRunId = (runAnchor) => {
    const existing = runIdByRunAnchor.get(runAnchor);
    if (existing) {
      return existing;
    }
    const runId = nextWorkerRunId++;
    runIdByRunAnchor.set(runAnchor, runId);
    return runId;
  };

  const applyWorkerTransformResult = (result, revision) => {
    const state = pendingWorkerRuns.get(result?.runId);
    if (!state) {
      return false;
    }
    pendingWorkerRuns.delete(result.runId);
    workerStats.pendingRuns = Math.max(workerStats.pendingRuns - 1, 0);

    if (state.revision !== revision || revision !== runtimeRevision) {
      recordRubyDebug({
        decision: "worker-result-stale",
        workerRevision: revision,
        stateRevision: state.revision,
        runtimeRevision
      });
      return false;
    }

    const textNodes = state.textNodes.filter((node) => node?.isConnected && !isSkippableTextNode(node));
    if (textNodes.length === 0) {
      recordRubyDebug({
        decision: "worker-target-disconnected",
        workerRevision: revision
      });
      return false;
    }

    const runAnchor = textNodes[0];
    const currentParts = textNodes.map((node) => readNodeValueSafely(node));
    const current = currentParts.join("");
    if (current !== state.sourceText) {
      recordRubyDebug({
        decision: "worker-source-changed",
        sourceText: state.sourceText,
        currentText: current,
        workerRevision: revision
      });
      return false;
    }

    const transformed = `${result.transformedText ?? ""}`;
    originalTextByRunAnchor.set(runAnchor, state.sourceText);
    workerStats.completedRuns += 1;
    mergeRuntimeMetrics(result?.metrics);
    const changed = applyTransformedRunResult(textNodes, currentParts, state.sourceText, transformed, revision);
    if (changed) {
      mergeRuntimeMetrics({ changedRuns: 1 });
    }
    return changed;
  };

  const handleTransformWorkerMessage = (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "CONFIGURED") {
      if (Number(message.revision) === runtimeRevision) {
        transformWorkerReady = true;
        workerStats.enabled = true;
        workerStats.lastError = null;
        resolveTransformWorkerConfigure(true);
      }
      return;
    }

    if (message.type === "RESULTS") {
      if (message.stale === true || Number(message.revision) !== runtimeRevision) {
        return;
      }

      let changedCount = 0;
      for (const result of Array.isArray(message.results) ? message.results : []) {
        if (applyWorkerTransformResult(result, Number(message.revision))) {
          changedCount += 1;
        }
      }
      if (changedCount > 0) {
        log("Worker 更新 textRun 数", changedCount);
      }
      return;
    }

    if (message.type === "INIT_ERROR" || message.type === "TOKENIZER_ERROR" || message.type === "BATCH_ERROR") {
      markTransformWorkerFailed(new Error(message.message ?? message.type));
    }
  };

  const ensureTransformWorker = () => {
    if (transformWorkerFailed) {
      return false;
    }

    if (transformWorker) {
      return true;
    }

    if (typeof Worker !== "function" || !chrome?.runtime?.getURL) {
      transformWorkerFailed = true;
      workerStats.lastError = "Worker is not available.";
      return false;
    }

    try {
      try {
        transformWorker = new Worker(chrome.runtime.getURL(TRANSFORM_WORKER_PATH));
      } catch (directError) {
        transformWorker = createBlobBootstrappedWorker();
      }
      attachTransformWorkerHandlers(transformWorker);
      return true;
    } catch (error) {
      markTransformWorkerFailed(error);
      return false;
    }
  };

  const configureTransformWorker = async () => {
    if (!ensureTransformWorker()) {
      return false;
    }

    transformWorkerReady = false;
    workerStats.enabled = false;
    workerStats.pendingRuns = 0;
    pendingWorkerRuns.clear();
    workerBatchQueue = [];

    transformWorkerConfigurePromise = new Promise((resolve) => {
      transformWorkerConfigureResolve = resolve;
    });

    try {
      transformWorker.postMessage({
        type: "CONFIGURE",
        revision: runtimeRevision,
        stages: activeTransformStages,
        dictPath: chrome.runtime.getURL(DICT_PATH)
      });
    } catch (error) {
      markTransformWorkerFailed(error);
      return false;
    }

    return transformWorkerConfigurePromise;
  };

  const flushWorkerBatchQueue = () => {
    workerBatchFlushHandle = null;
    if (!canUseWorkerForTransform() || workerBatchQueue.length === 0) {
      return;
    }

    while (workerBatchQueue.length > 0) {
      const runs = workerBatchQueue.splice(0, WORKER_BATCH_SIZE);
      const jobId = nextWorkerJobId++;
      try {
        transformWorker.postMessage({
          type: "TRANSFORM_BATCH",
          jobId,
          revision: runtimeRevision,
          runs
        });
      } catch (error) {
        markTransformWorkerFailed(error);
        return;
      }
    }
  };

  const scheduleWorkerBatchFlush = () => {
    if (workerBatchFlushHandle !== null) {
      return;
    }
    workerBatchFlushHandle = window.setTimeout(flushWorkerBatchQueue, 0);
  };

  const enqueueWorkerTransformRun = (textNodes, currentParts, sourceText, runAnchor) => {
    if (!canUseWorkerForTransform()) {
      return false;
    }

    const runId = getOrCreateRunId(runAnchor);
    const pending = pendingWorkerRuns.get(runId);
    if (pending && pending.revision === runtimeRevision && pending.sourceText === sourceText) {
      return true;
    }

    pendingWorkerRuns.set(runId, {
      revision: runtimeRevision,
      sourceText,
      textNodes: [...textNodes]
    });
    workerStats.pendingRuns = pendingWorkerRuns.size;
    workerBatchQueue.push({
      runId,
      text: sourceText
    });
    scheduleWorkerBatchFlush();
    return true;
  };

  const transformTextWithStages = (text) => {
    const effectiveStages = getEffectiveTransformStages();
    const effectivePlan = effectiveStages === activeTransformStages
      ? activeCompiledPlan
      : TransformEngine.compileRuntimePlan(effectiveStages, { revision: runtimeRevision });
    if (!DEBUG && !hasDebugTargets()) {
      return effectivePlan
        ? TransformEngine.transformTextWithPlan(text, effectivePlan, activeTokenizer, { metrics: runtimeMetrics })
        : TransformEngine.transformTextWithStages(text, effectiveStages, activeTokenizer, { metrics: runtimeMetrics });
    }

    const events = [];
    const transformed = effectivePlan
      ? TransformEngine.transformTextWithPlan(
        text,
        effectivePlan,
        activeTokenizer,
        {
          debugCollector: (event) => events.push(event),
          metrics: runtimeMetrics
        }
      )
      : TransformEngine.transformTextWithStages(
        text,
        effectiveStages,
        activeTokenizer,
        {
          debugCollector: (event) => events.push(event),
          metrics: runtimeMetrics
        }
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
      clearRunState(runAnchor);
      return false;
    }

    redistributeTransformedText(textNodes, currentParts, original);
    markRecentWriteForRun(textNodes);
    clearRunState(runAnchor);
    return true;
  };

  const restoreDocumentRuns = (root) => {
    restoreManagedRubyContainers(root);
    const runWalker = createRunWalker(root);
    let run = runWalker?.nextRun() ?? null;
    while (run) {
      restoreTextRun(run);
      run = runWalker.nextRun();
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
    const runState = getRunState(runAnchor);
    const lastProcessed = runState?.transformedText;
    if (runState?.revision === runtimeRevision && current === lastProcessed) {
      return false;
    }
    const storedOriginal = originalTextByRunAnchor.get(runAnchor);
    const sourceText = lastProcessed !== undefined && current === lastProcessed && typeof storedOriginal === "string"
      ? storedOriginal
      : current;
    originalTextByRunAnchor.set(runAnchor, sourceText);

    if (enqueueWorkerTransformRun(textNodes, currentParts, sourceText, runAnchor)) {
      return true;
    }

    const transformed = transformTextWithStages(sourceText);
    const changed = applyTransformedRunResult(textNodes, currentParts, sourceText, transformed, runtimeRevision);
    if (changed) {
      mergeRuntimeMetrics({ changedRuns: 1 });
    }

    if (DEBUG) {
      log("textRun 更新", {
        original: sourceText,
        transformed,
        nodeCount: textNodes.length,
        debugEvents: Array.isArray(lastTransformDebug?.events) ? lastTransformDebug.events : []
      });
    }

    return changed;
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

  const shouldWarmMainThreadTokenizer = () => {
    return runtimeRequiresTokenizer() && (
      DEBUG ||
      hasDebugTargets() ||
      !transformWorkerReady ||
      transformWorkerFailed
    );
  };

  const recompileActiveRuntimePlan = () => {
    runtimeRevision += 1;
    activeCompiledPlan = TransformEngine.compileRuntimePlan(activeTransformStages, {
      revision: runtimeRevision
    });
    resetRuntimeMetrics(activeCompiledPlan?.planVersion ?? null);
  };

  const resetRuntimeProcessingState = () => {
    nodeStateCache = new WeakMap();
    recentWriteRoots = new WeakMap();
    pendingRootQueue.clear();
    pendingMutationRoots.clear();
    cancelMutationFlush();
    cancelRootFlushes();
  };

  const warmMainThreadTokenizer = ({ reapply = false } = {}) => {
    if (!shouldWarmMainThreadTokenizer()) {
      activeTokenizer = null;
      return;
    }

    const tokenizerRevision = ++tokenizerWarmupRevision;
    getTokenizer().then((tokenizer) => {
      if (tokenizerRevision !== tokenizerWarmupRevision) {
        return;
      }

      activeTokenizer = tokenizer;
      publishRuntimeDebugSnapshot(getDebugTargetsFromDocument());
      if (reapply && isRuntimeEnabled()) {
        recompileActiveRuntimePlan();
        resetRuntimeProcessingState();
        queueProcessableRoots(collectDocumentProcessingRoots(), { priority: "visible", restoreFirst: true });
      }
    }).catch((error) => {
      if (tokenizerRevision !== tokenizerWarmupRevision) {
        return;
      }

      console.error("tokenizer warmup failed", error);
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

  const cancelMutationFlush = () => {
    if (mutationFlushHandle === null) {
      return;
    }
    window.clearTimeout(mutationFlushHandle);
    mutationFlushHandle = null;
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

  const processTextRoot = (root, options = {}) => {
    const entry = options.entry ?? {};
    const restoreRuns = entry.restoreFirst === true || options.restoreFirst === true;
    const deadline = Number.isFinite(options.deadline) ? options.deadline : Infinity;
    const maxRuns = Number.isFinite(options.maxRuns)
      ? options.maxRuns
      : MAX_RUNS_PER_ROOT_BATCH;
    if (restoreRuns && entry.managedRubyRestored !== true) {
      restoreManagedRubyContainers(root);
      entry.runWalker = null;
      entry.done = false;
      entry.managedRubyRestored = true;
    }
    const runWalker = entry.runWalker ?? createRunWalker(root);
    entry.runWalker = runWalker;
    let changedCount = 0;
    let processedCount = 0;

    while (runWalker && processedCount < maxRuns && performance.now() < deadline) {
      const textRun = runWalker.nextRun();
      if (!textRun) {
        entry.done = true;
        break;
      }
      if (textRun.length === 0) {
        continue;
      }

      if (restoreRuns) {
        restoreTextRun(textRun);
      }

      if (processTextRun(textRun)) {
        changedCount++;
      }
      processedCount += 1;
    }

    return {
      changedCount,
      done: entry.done === true || !runWalker
    };
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
      const result = processTextRoot(root, {
        entry,
        deadline,
        maxRuns: MAX_RUNS_PER_ROOT_BATCH
      });
      changedCount += result.changedCount;
      if (!result.done && root.isConnected) {
        pendingRootQueue.set(root, entry);
      }

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
      if (!existing || existing.revision !== runtimeRevision || nextPriority < existing.priority) {
        pendingRootQueue.set(root, {
          priority: nextPriority,
          restoreFirst: restoreFirst === true,
          managedRubyRestored: false,
          revision: runtimeRevision,
          runWalker: null,
          done: false
        });
      } else if (restoreFirst === true) {
        existing.restoreFirst = true;
        existing.managedRubyRestored = false;
        existing.runWalker = null;
        existing.done = false;
      }
    }
    mergeRuntimeMetrics({ queuedRoots: pendingRootQueue.size });

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
    if (host.isConnected) {
      queueProcessableRoots([host], { ...options, priority: "visible" });
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

  const nodeContains = (parent, child) => {
    if (!parent || !child) {
      return false;
    }
    if (parent === child) {
      return true;
    }
    if (parent.nodeType === Node.TEXT_NODE) {
      return false;
    }
    if (typeof parent.contains === "function") {
      const target = child.nodeType === Node.TEXT_NODE ? child.parentNode : child;
      return Boolean(target) && parent.contains(target);
    }
    return false;
  };

  const collapseRoots = (roots) => {
    const collapsed = [];
    for (const root of roots) {
      if (!root || !root.isConnected) {
        continue;
      }
      let skip = false;
      for (let index = collapsed.length - 1; index >= 0; index -= 1) {
        const existing = collapsed[index];
        if (nodeContains(existing, root)) {
          skip = true;
          break;
        }
        if (nodeContains(root, existing)) {
          collapsed.splice(index, 1);
        }
      }
      if (!skip) {
        collapsed.push(root);
      }
    }
    return collapsed;
  };

  const scheduleMutationRootFlush = () => {
    if (mutationFlushHandle !== null) {
      return;
    }
    mutationFlushHandle = window.setTimeout(() => {
      mutationFlushHandle = null;
      if (!isRuntimeEnabled() || pendingMutationRoots.size === 0) {
        pendingMutationRoots.clear();
        return;
      }

      const roots = [];
      for (const candidate of pendingMutationRoots) {
        roots.push(...collectProcessableRoots(candidate));
      }
      pendingMutationRoots.clear();
      const collapsed = collapseRoots(roots);
      if (collapsed.length === 0) {
        return;
      }
      mergeRuntimeMetrics({
        mutationBatches: 1,
        queuedRoots: collapsed.length
      });
      queueProcessableRoots(collapsed);
    }, MUTATION_DEBOUNCE_MS);
  };

  const observeDynamicContent = () => {
    const observer = new MutationObserver((mutations) => {
      if (!isRuntimeEnabled()) {
        return;
      }

      for (const mutation of mutations) {
        if (wasRecentlyWritten(mutation.target)) {
          continue;
        }
        if (mutation.type === "characterData") {
          pendingMutationRoots.add(mutation.target);
          continue;
        }

        for (const addedNode of mutation.addedNodes) {
          if (!wasRecentlyWritten(addedNode)) {
            pendingMutationRoots.add(addedNode);
          }
        }
      }
      scheduleMutationRootFlush();
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
            warmMainThreadTokenizer();
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
    const [storedValue, ruleResources, tabState] = await Promise.all([
      loadStoredSettingsPayload(),
      loadOrderedRuleResources(),
      loadTabRuntimeState()
    ]);
    const runtimeConfiguration = loadRuntimeConfiguration(storedValue);
    const loaded = loadOrderedRules(ruleResources, storedValue);
    activeRuntimeSettings = runtimeConfiguration.runtimeSettings;
    activeDisabledSites = runtimeConfiguration.disabledSites;
    activePageRubySettings = runtimeConfiguration.pageRubySettings;
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
    runtimeRevision += 1;
    activeCompiledPlan = TransformEngine.compileRuntimePlan(activeTransformStages, {
      revision: runtimeRevision
    });
    nodeStateCache = new WeakMap();
    recentWriteRoots = new WeakMap();
    pendingMutationRoots.clear();
    cancelMutationFlush();
    resetRuntimeMetrics(activeCompiledPlan?.planVersion ?? null);
    const workerConfigured = await configureTransformWorker();
    activeTokenizer = null;
    if ((!workerConfigured && runtimeRequiresTokenizer()) || shouldWarmMainThreadTokenizer()) {
      warmMainThreadTokenizer({ reapply });
    }
    publishRuntimeDebugSnapshot(getDebugTargetsFromDocument());

    if (!reapply) {
      return;
    }

    if (!isRuntimeEnabled()) {
      pendingRootQueue.clear();
      pendingMutationRoots.clear();
      cancelMutationFlush();
      cancelRootFlushes();
      restoreDocumentRuns(document.body);
      return;
    }

    pendingRootQueue.clear();
    pendingMutationRoots.clear();
    cancelMutationFlush();
    cancelRootFlushes();
    queueProcessableRoots(collectDocumentProcessingRoots(), { restoreFirst: true });
  };

  const handleRuntimeMessage = (message, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_PAGE_CONTEXT) {
      const effectiveRuby = getEffectiveRubyConfiguration();
      sendResponse({
        ok: true,
        url: location.href,
        hostname: location.hostname,
        selectionText: getCurrentSelectionText(),
        globalEnabled: activeRuntimeSettings.globalEnabled !== false,
        siteDisabled: isCurrentSiteDisabled(),
        tabDisabled: activeTabDisabled === true,
        effectiveEnabled: isRuntimeEnabled(),
        popupBundleId: activePopupBundleId,
        ruby: {
          enabled: activeRuntimeSettings.ruby?.enabled !== false,
          hidden: activeRuntimeSettings.ruby?.hidden === true,
          markers: effectiveRuby.markers,
          source: effectiveRuby.source,
          maxBaseLength: activeRuntimeSettings.ruby?.max_base_length,
          maxRubyLength: activeRuntimeSettings.ruby?.max_ruby_length
        }
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

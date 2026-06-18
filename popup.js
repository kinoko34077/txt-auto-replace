(() => {
  "use strict";

  const STORAGE_KEY = "bundleOverrideSettingsV1";
  const DEFAULT_POPUP_BUNDLE_ID = "popup-quick-replacements";
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
  const DEFAULT_PAGE_RUBY_SETTINGS = Object.freeze({
    url_overrides: {},
    domain_defaults: {}
  });
  const MESSAGE_TYPES = {
    APPLY_SETTINGS_UPDATE: "APPLY_SETTINGS_UPDATE",
    GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
    TOGGLE_CURRENT_TAB: "TOGGLE_CURRENT_TAB"
  };
  const TransformShared = globalThis.TransformShared;

  const state = {
    payload: {},
    activeTab: null,
    pageContext: null
  };

  const pageContextNode = document.getElementById("page-context");
  const selectionPreviewNode = document.getElementById("selection-preview");
  const statusNode = document.getElementById("status");
  const globalEnabledInput = document.getElementById("global-enabled");
  const toggleSiteButton = document.getElementById("toggle-site");
  const toggleTabButton = document.getElementById("toggle-tab");
  const openOptionsButton = document.getElementById("open-options");
  const rubyContextNode = document.getElementById("ruby-context");
  const rubyOpenInput = document.getElementById("ruby-open");
  const rubyCloseInput = document.getElementById("ruby-close");
  const saveRubyMarkersButton = document.getElementById("save-ruby-markers");
  const entryFromInput = document.getElementById("entry-from");
  const entryToInput = document.getElementById("entry-to");
  const entryPriorityInput = document.getElementById("entry-priority");
  const entryEnabledInput = document.getElementById("entry-enabled");
  const entryRegexInput = document.getElementById("entry-regex");
  const entryBasicInput = document.getElementById("entry-basic");
  const addEntryButton = document.getElementById("add-entry");
  const popupEntriesNode = document.getElementById("popup-entries");

  const setStatus = (message, type = "info") => {
    statusNode.textContent = message;
    statusNode.dataset.type = type;
  };

  const cloneValue = (value) => JSON.parse(JSON.stringify(value));

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

  const queryActiveTab = async () => {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    return tabs[0] ?? null;
  };

  const sendMessageToActiveTab = async (message) => {
    if (!state.activeTab?.id) {
      return null;
    }

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(state.activeTab.id, message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          resolve(null);
          return;
        }

        resolve(response ?? null);
      });
    });
  };

  const normalizeRuntimeSettings = (value) => {
    return {
      skipEditableInputs: value?.skipEditableInputs === true,
      globalEnabled: value?.globalEnabled !== false,
      ruby: TransformShared.normalizeRubyRuntimeSettings(value?.ruby)
    };
  };

  const normalizePageRubySettings = (value) => {
    return TransformShared.normalizePageRubySettings(value);
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

  const createPopupBundleRoot = () => {
    return {
      id: DEFAULT_POPUP_BUNDLE_ID,
      label: "Popup 追加語彙",
      kind: "token-rules",
      enabled: true,
      order: 57,
      rules: [],
      children: []
    };
  };

  const normalizePayload = (payload) => {
    const nextPayload = payload && typeof payload === "object" ? cloneValue(payload) : {};
    nextPayload.schema_version = 3;
    nextPayload.runtime_settings = normalizeRuntimeSettings(nextPayload.runtime_settings);
    nextPayload.disabled_sites = normalizeDisabledSites(nextPayload.disabled_sites);
    nextPayload.page_ruby_settings = normalizePageRubySettings(nextPayload.page_ruby_settings);
    nextPayload.popup_bundle_id = `${nextPayload.popup_bundle_id ?? DEFAULT_POPUP_BUNDLE_ID}`.trim() || DEFAULT_POPUP_BUNDLE_ID;
    nextPayload.roots = Array.isArray(nextPayload.roots) ? nextPayload.roots : [];

    let popupRoot = nextPayload.roots.find((root) => root?.id === nextPayload.popup_bundle_id);
    if (!popupRoot) {
      popupRoot = createPopupBundleRoot();
      nextPayload.roots.push(popupRoot);
    }

    popupRoot.label = popupRoot.label || "Popup 追加語彙";
    popupRoot.kind = popupRoot.kind || "token-rules";
    popupRoot.enabled = popupRoot.enabled !== false;
    popupRoot.order = Number.isFinite(popupRoot.order) ? popupRoot.order : 57;
    popupRoot.rules = Array.isArray(popupRoot.rules)
      ? popupRoot.rules
      : Array.isArray(popupRoot.entries)
        ? popupRoot.entries
        : [];

    return nextPayload;
  };

  const getPopupRoot = () => {
    return state.payload.roots.find((root) => root?.id === state.payload.popup_bundle_id);
  };

  const splitFromCandidates = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => `${entry ?? ""}`.trim())
        .filter(Boolean);
    }

    return `${value ?? ""}`
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  };

  const getVisiblePopupRuleItems = () => {
    const popupRoot = getPopupRoot();
    const rules = Array.isArray(popupRoot?.rules) ? popupRoot.rules : [];
    const selectionText = `${state.pageContext?.selectionText ?? ""}`.trim();
    if (!selectionText) {
      return [];
    }

    return rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => splitFromCandidates(rule?.from_options ?? rule?.from).includes(selectionText));
  };

  const savePayload = async () => {
    await storageSet({
      [STORAGE_KEY]: state.payload
    });
    await sendRuntimeMessage({
      type: MESSAGE_TYPES.APPLY_SETTINGS_UPDATE,
      tabId: state.activeTab?.id ?? null
    });
  };

  const getEffectivePageRubyContext = () => {
    return TransformShared.resolveEffectiveRubySettings(
      state.payload.page_ruby_settings ?? DEFAULT_PAGE_RUBY_SETTINGS,
      state.payload.runtime_settings?.ruby ?? DEFAULT_RUNTIME_SETTINGS.ruby,
      `${state.pageContext?.url ?? state.activeTab?.url ?? ""}`,
      `${state.pageContext?.hostname ?? ""}`
    );
  };

  const renderPageContext = () => {
    const hostname = state.pageContext?.hostname || "unknown";
    const url = state.pageContext?.url || state.activeTab?.url || "";
    pageContextNode.textContent = `${hostname}\n${url}`;
    globalEnabledInput.checked = state.payload.runtime_settings.globalEnabled !== false;
    toggleSiteButton.textContent = state.pageContext?.siteDisabled ? "現在サイトを再有効化" : "現在サイトを無効化";
    toggleTabButton.textContent = state.pageContext?.tabDisabled ? "このタブだけ一時有効" : "このタブだけ一時無効";
    selectionPreviewNode.textContent = state.pageContext?.selectionText
      ? `選択文字列: ${state.pageContext.selectionText}`
      : "選択文字列はありません。";
    if (state.pageContext?.selectionText && !entryFromInput.value) {
      entryFromInput.value = state.pageContext.selectionText;
    }

    const ruby = getEffectivePageRubyContext();
    rubyOpenInput.value = ruby.markers?.open ?? "《";
    rubyCloseInput.value = ruby.markers?.close ?? "》";
    rubyContextNode.textContent = `現在: ${rubyOpenInput.value}${rubyCloseInput.value} / 継承元: ${ruby.source ?? "default"}`;
  };

  const saveCurrentPageRubyMarkers = async () => {
    const url = `${state.pageContext?.url ?? state.activeTab?.url ?? ""}`.trim();
    const hostname = `${state.pageContext?.hostname ?? ""}`.trim().toLowerCase();
    if (!url || !hostname) {
      setStatus("現在ページの URL を取得できません。", "error");
      return;
    }

    const markers = TransformShared.normalizeRubyMarkers({
      open: rubyOpenInput.value,
      close: rubyCloseInput.value
    });
    rubyOpenInput.value = markers.open;
    rubyCloseInput.value = markers.close;

    state.payload.page_ruby_settings = normalizePageRubySettings(state.payload.page_ruby_settings);
    state.payload.page_ruby_settings.url_overrides[url] = { ...markers };
    state.payload.page_ruby_settings.domain_defaults[hostname] = { ...markers };

    await savePayload();
    setStatus("ページ別ルビ記号を保存しました。", "success");
    await reloadState();
  };

  const renderEntries = () => {
    popupEntriesNode.textContent = "";
    const visibleRuleItems = getVisiblePopupRuleItems();
    const selectionText = `${state.pageContext?.selectionText ?? ""}`.trim();

    if (!selectionText || visibleRuleItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = !selectionText
        ? "選択文字列があると、その文字列に一致する Popup 辞書だけ表示します。"
        : "選択文字列に一致する Popup 辞書はありません。";
      popupEntriesNode.appendChild(empty);
      return;
      empty.textContent = "Popup 追加語彙はまだありません。";
      popupEntriesNode.appendChild(empty);
      return;
    }

    visibleRuleItems.forEach(({ rule, index }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry";

      const row1 = document.createElement("div");
      row1.className = "row";
      const fromInput = document.createElement("input");
      fromInput.type = "text";
      fromInput.className = "grow";
      fromInput.value = `${rule.from ?? ""}`;
      const toInput = document.createElement("input");
      toInput.type = "text";
      toInput.className = "grow";
      toInput.value = `${rule.to ?? ""}`;
      row1.append(fromInput, toInput);

      const row2 = document.createElement("div");
      row2.className = "row";
      const priorityInput = document.createElement("input");
      priorityInput.type = "number";
      priorityInput.className = "compact";
      priorityInput.value = `${Number.isFinite(rule.priority) ? rule.priority : Number(rule.priority) || 90}`;
      const enabledLabel = document.createElement("label");
      enabledLabel.className = "toggle";
      const enabledInput = document.createElement("input");
      enabledInput.type = "checkbox";
      enabledInput.checked = rule.enabled !== false;
      enabledLabel.append(enabledInput, document.createTextNode("有効"));
      const regexLabel = document.createElement("label");
      regexLabel.className = "toggle";
      const regexInput = document.createElement("input");
      regexInput.type = "checkbox";
      regexInput.checked = rule.regex === true;
      regexLabel.append(regexInput, document.createTextNode("正規表現"));
      const basicLabel = document.createElement("label");
      basicLabel.className = "toggle";
      const basicInput = document.createElement("input");
      basicInput.type = "checkbox";
      basicInput.checked = rule.match_target === "basic_form";
      basicLabel.append(basicInput, document.createTextNode("原形一致"));
      row2.append(priorityInput, enabledLabel, regexLabel, basicLabel);

      const row3 = document.createElement("div");
      row3.className = "row";
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = "更新";
      saveButton.addEventListener("click", async () => {
        popupRoot.rules[index] = {
          ...popupRoot.rules[index],
          from: fromInput.value.trim(),
          to: toInput.value.trim(),
          priority: Number.isFinite(Number(priorityInput.value)) ? Number(priorityInput.value) : 90,
          enabled: enabledInput.checked,
          regex: regexInput.checked,
          match_target: basicInput.checked ? "basic_form" : null
        };
        await savePayload();
        setStatus("Popup 語彙を更新しました。", "success");
        await reloadState();
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", async () => {
        popupRoot.rules.splice(index, 1);
        await savePayload();
        setStatus("Popup 語彙を削除しました。", "success");
        await reloadState();
      });
      row3.append(saveButton, deleteButton);

      wrapper.append(row1, row2, row3);
      popupEntriesNode.appendChild(wrapper);
    });
  };

  const reloadState = async () => {
    state.activeTab = await queryActiveTab();
    state.payload = normalizePayload(await storageGet(STORAGE_KEY));
    state.pageContext = await sendMessageToActiveTab({
      type: "GET_PAGE_CONTEXT"
    });
    renderPageContext();
    renderEntries();
  };

  const bindStorageSync = () => {
    if (!chrome?.storage?.onChanged) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) {
        return;
      }

      reloadState().catch((error) => {
        console.error(error);
        setStatus(`popup 同期に失敗しました: ${error.message}`, "error");
      });
    });
  };

  addEntryButton.addEventListener("click", async () => {
    const from = entryFromInput.value.trim();
    const to = entryToInput.value.trim();
    if (!from || !to) {
      setStatus("置換前と置換後の両方を入力してください。", "error");
      return;
    }

    const popupRoot = getPopupRoot();
    popupRoot.rules.push({
      id: `popup-${Date.now().toString(36)}`,
      from,
      to,
      priority: Number.isFinite(Number(entryPriorityInput.value)) ? Number(entryPriorityInput.value) : 90,
      enabled: entryEnabledInput.checked,
      regex: entryRegexInput.checked,
      match_target: entryBasicInput.checked ? "basic_form" : null
    });

    await savePayload();
    entryToInput.value = "";
    setStatus("Popup 語彙を追加しました。", "success");
    await reloadState();
  });

  globalEnabledInput.addEventListener("change", async () => {
    state.payload.runtime_settings.globalEnabled = globalEnabledInput.checked;
    await savePayload();
    setStatus("拡張全体の有効状態を更新しました。", "success");
    await reloadState();
  });

  toggleSiteButton.addEventListener("click", async () => {
    const hostname = `${state.pageContext?.hostname ?? ""}`.trim().toLowerCase();
    if (!hostname) {
      setStatus("現在サイトを取得できませんでした。", "error");
      return;
    }

    const domains = new Set(state.payload.disabled_sites.domains);
    if (domains.has(hostname)) {
      domains.delete(hostname);
    } else {
      domains.add(hostname);
    }
    state.payload.disabled_sites.domains = [...domains];
    await savePayload();
    setStatus("現在サイトの有効状態を更新しました。", "success");
    await reloadState();
  });

  toggleTabButton.addEventListener("click", async () => {
    try {
      await sendRuntimeMessage({
        type: MESSAGE_TYPES.TOGGLE_CURRENT_TAB
      });
      setStatus("このタブの一時有効状態を更新しました。", "success");
      await reloadState();
    } catch (error) {
      console.error(error);
      setStatus(`このタブの切替に失敗しました: ${error.message}`, "error");
    }
  });

  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  saveRubyMarkersButton.addEventListener("click", async () => {
    try {
      await saveCurrentPageRubyMarkers();
    } catch (error) {
      console.error(error);
      setStatus(`ルビ記号の保存に失敗しました: ${error.message}`, "error");
    }
  });

  bindStorageSync();
  reloadState().catch((error) => {
    console.error(error);
    setStatus(`popup 初期化に失敗しました: ${error.message}`, "error");
  });
})();

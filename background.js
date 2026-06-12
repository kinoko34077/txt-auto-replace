"use strict";

const STORAGE_KEY = "bundleOverrideSettingsV1";
const TAB_STATE_KEY = "tabRuntimeStateV1";
const MESSAGE_TYPES = {
  APPLY_SETTINGS_UPDATE: "APPLY_SETTINGS_UPDATE",
  GET_TAB_RUNTIME_STATE: "GET_TAB_RUNTIME_STATE",
  OPEN_SHORTCUTS_PAGE: "OPEN_SHORTCUTS_PAGE",
  TOGGLE_CURRENT_TAB: "TOGGLE_CURRENT_TAB"
};

const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
  skipEditableInputs: false,
  globalEnabled: true
});

const storageLocalGet = async (key) => {
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

const storageLocalSet = async (payload) => {
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

const storageSessionGet = async (key) => {
  const storageArea = chrome.storage.session ?? chrome.storage.local;
  return new Promise((resolve, reject) => {
    storageArea.get([key], (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(result?.[key]);
    });
  });
};

const storageSessionSet = async (payload) => {
  const storageArea = chrome.storage.session ?? chrome.storage.local;
  return new Promise((resolve, reject) => {
    storageArea.set(payload, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
};

const queryTabs = async (queryInfo) => {
  return chrome.tabs.query(queryInfo);
};

const sendMessageToTab = async (tabId, message) => {
  if (!tabId) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    return null;
  }
};

const normalizeRuntimeSettings = (value) => {
  return {
    skipEditableInputs: value?.skipEditableInputs === true,
    globalEnabled: value?.globalEnabled !== false
  };
};

const getStoredPayload = async () => {
  const payload = await storageLocalGet(STORAGE_KEY);
  return payload && typeof payload === "object" ? payload : {};
};

const updateStoredPayload = async (updater) => {
  const payload = await getStoredPayload();
  const nextPayload = await updater(payload);
  await storageLocalSet({
    [STORAGE_KEY]: nextPayload
  });
  return nextPayload;
};

const getTabStateMap = async () => {
  const map = await storageSessionGet(TAB_STATE_KEY);
  return map && typeof map === "object" ? map : {};
};

const setTabStateMap = async (map) => {
  await storageSessionSet({
    [TAB_STATE_KEY]: map
  });
};

const getCurrentTab = async () => {
  const tabs = await queryTabs({
    active: true,
    currentWindow: true
  });
  return tabs[0] ?? null;
};

const broadcastRuntimeUpdate = async (targetTabId = null) => {
  const tabs = targetTabId
    ? [{ id: targetTabId }]
    : await queryTabs({});

  const targets = tabs.filter((tab) => typeof tab?.id === "number");
  const results = await Promise.all(
    targets.map((tab) => sendMessageToTab(tab.id, { type: MESSAGE_TYPES.APPLY_SETTINGS_UPDATE }))
  );

  return {
    ok: true,
    notified: results.filter(Boolean).length,
    failed: results.filter((result) => !result).length
  };
};

const toggleCurrentTabDisabled = async () => {
  const currentTab = await getCurrentTab();
  if (!currentTab?.id) {
    return { ok: false };
  }

  const tabStateMap = await getTabStateMap();
  const nextDisabled = tabStateMap[currentTab.id] !== true;
  tabStateMap[currentTab.id] = nextDisabled;
  await setTabStateMap(tabStateMap);
  await broadcastRuntimeUpdate(currentTab.id);

  return {
    ok: true,
    tabId: currentTab.id,
    tabDisabled: nextDisabled
  };
};

const toggleGlobalExtension = async () => {
  const nextPayload = await updateStoredPayload((payload) => {
    const runtimeSettings = normalizeRuntimeSettings(payload.runtime_settings);
    return {
      ...payload,
      runtime_settings: {
        ...runtimeSettings,
        globalEnabled: runtimeSettings.globalEnabled === false
      }
    };
  });

  await broadcastRuntimeUpdate();
  return {
    ok: true,
    globalEnabled: normalizeRuntimeSettings(nextPayload.runtime_settings).globalEnabled
  };
};

const getTabRuntimeState = async (tabId) => {
  if (!tabId) {
    return { tabDisabled: false };
  }

  const tabStateMap = await getTabStateMap();
  return {
    tabDisabled: tabStateMap[tabId] === true
  };
};

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "toggle-current-tab") {
      await toggleCurrentTabDisabled();
      return;
    }

    if (command === "toggle-global-extension") {
      await toggleGlobalExtension();
    }
  } catch (error) {
    console.error("background command failed", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false });
      return;
    }

    if (message.type === MESSAGE_TYPES.GET_TAB_RUNTIME_STATE) {
      const tabId = message.tabId ?? sender?.tab?.id ?? null;
      sendResponse({
        ok: true,
        ...(await getTabRuntimeState(tabId))
      });
      return;
    }

    if (message.type === MESSAGE_TYPES.APPLY_SETTINGS_UPDATE) {
      sendResponse(await broadcastRuntimeUpdate(message.tabId ?? null));
      return;
    }

    if (message.type === MESSAGE_TYPES.OPEN_SHORTCUTS_PAGE) {
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MESSAGE_TYPES.TOGGLE_CURRENT_TAB) {
      sendResponse(await toggleCurrentTabDisabled());
      return;
    }

    sendResponse({ ok: false });
  })().catch((error) => {
    console.error("background message failed", error);
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : `${error}`
    });
  });

  return true;
});

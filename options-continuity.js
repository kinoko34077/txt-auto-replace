(() => {
  "use strict";

  const saveAllButton = document.getElementById("save-all");
  const statusNode = document.getElementById("status");
  if (!saveAllButton || !statusNode) return;

  let workingRevision = 0;
  let savedRevision = 0;
  let importIntentPending = false;

  const saveStateNode = document.createElement("span");
  saveStateNode.id = "save-state";
  saveStateNode.className = "chip";
  saveStateNode.setAttribute("role", "status");
  saveStateNode.setAttribute("aria-live", "polite");
  saveAllButton.insertAdjacentElement("afterend", saveStateNode);

  const isDirty = () => workingRevision !== savedRevision;

  const refreshDirtyState = () => {
    const dirty = isDirty();
    saveStateNode.textContent = dirty ? "未保存の変更あり" : "保存済み";
    saveStateNode.dataset.dirty = dirty ? "true" : "false";
    saveAllButton.dataset.dirty = dirty ? "true" : "false";
    saveAllButton.title = dirty ? "未保存の変更を保存します" : "現在の設定は保存済みです";
  };

  const markDirty = () => {
    workingRevision += 1;
    refreshDirtyState();
  };

  const markSaved = () => {
    savedRevision = workingRevision;
    refreshDirtyState();
  };

  const NON_PERSISTENT_IDS = new Set([
    "tokenizer-input",
    "tokenizer-run",
    "open-shortcuts",
    "export-json",
    "export-yaml",
    "import-settings",
    "tab-bundles",
    "tab-ruby",
    "tab-katakana-long-vowel",
    "tab-stage4",
    "tab-diagnostics",
    "tab-tokenizer",
    "tab-hotkeys",
    "tab-sites"
  ]);

  const isTransientSelectionControl = (target) => {
    if (!(target instanceof Element) || target.tagName !== "INPUT" || target.type !== "checkbox") {
      return false;
    }
    if (target.getAttribute("aria-label") === "全選択") {
      return true;
    }
    if (target.closest(".explorer-row")) {
      return true;
    }
    const toggleLabel = target.closest("label.toggle");
    if (/^(node)?選択$/.test(`${toggleLabel?.textContent ?? ""}`.trim())) {
      return true;
    }
    const checkCell = target.closest("td.check-col");
    return Boolean(checkCell && checkCell.parentElement?.firstElementChild === checkCell);
  };

  const isPersistentControl = (target) => {
    if (!(target instanceof Element)) return false;
    if (NON_PERSISTENT_IDS.has(target.id)) return false;
    if (isTransientSelectionControl(target)) return false;
    if (target.closest("#panel-tokenizer")) return false;
    if (target.classList.contains("grid-search")) return false;
    return Boolean(target.closest("#panel-bundles, #panel-ruby, #panel-katakana-long-vowel, #panel-stage4, #panel-sites, .toolbar, .panel-block"));
  };

  const historyControlSignature = () => {
    const undoButton = document.getElementById("undo-button");
    const redoButton = document.getElementById("redo-button");
    return [
      undoButton?.disabled === true ? "1" : "0",
      undoButton?.textContent ?? "",
      redoButton?.disabled === true ? "1" : "0",
      redoButton?.textContent ?? ""
    ].join("|");
  };

  const markDirtyIfHistoryChanged = (beforeSignature) => {
    queueMicrotask(() => {
      if (historyControlSignature() !== beforeSignature) {
        markDirty();
      }
    });
  };

  document.addEventListener("input", (event) => {
    if (isPersistentControl(event.target)) markDirty();
  }, true);

  document.addEventListener("change", (event) => {
    if (isPersistentControl(event.target)) markDirty();
  }, true);

  document.addEventListener("drop", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("#panel-bundles")) return;
    markDirtyIfHistoryChanged(historyControlSignature());
  }, true);

  document.addEventListener("keydown", (event) => {
    const panelBundles = document.getElementById("panel-bundles");
    if (!panelBundles || panelBundles.hidden) return;

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
    const trackedShortcut =
      (modifier && ["z", "y", "x", "v"].includes(key)) ||
      key === "delete" ||
      key === "backspace";
    if (!trackedShortcut) return;

    markDirtyIfHistoryChanged(historyControlSignature());
  }, true);

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;

    if (button.id === "import-settings") {
      importIntentPending = true;
      return;
    }
    if (NON_PERSISTENT_IDS.has(button.id)) return;
    if (button.classList.contains("tab-button") || button.classList.contains("title-button") || button.classList.contains("tree-label") || button.classList.contains("tree-root-button")) return;

    const explicitMutationIds = new Set([
      "undo-button",
      "redo-button",
      "add-bundle",
      "reload-defaults",
      "add-current-site"
    ]);
    const mutationText = /追加|削除|複製|切り取り|貼り付け|移動|既定値へ戻す|適用|反映|有効化|無効化|dictionary-rules|token-rules/;
    if (explicitMutationIds.has(button.id) || mutationText.test(button.textContent ?? "")) {
      queueMicrotask(markDirty);
    }
  }, true);

  const statusObserver = new MutationObserver(() => {
    const message = statusNode.textContent ?? "";
    const statusType = statusNode.dataset.type ?? "";

    if ((statusType === "success" || statusType === "warning") && /設定(?:を|は)保存しました/.test(message)) {
      importIntentPending = false;
      markSaved();
      return;
    }

    if (importIntentPending && statusType === "success" && /を読み込みました/.test(message)) {
      importIntentPending = false;
      markDirty();
      return;
    }

    if (statusType === "error") {
      importIntentPending = false;
    }
  });
  statusObserver.observe(statusNode, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["data-type"] });

  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  refreshDirtyState();
})();

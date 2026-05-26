(() => {
  "use strict";

  const TRANSFORM_BUNDLES_PATH = "transform-bundles.json5";
  const STORAGE_KEY = "bundleOverrideSettingsV1";
  const EDITABLE_BUNDLE_IDS = new Set([
    "legacy-kanji",
    "general-character-replacements",
    "homophone-kanji"
  ]);

  const state = {
    bundleOrder: [],
    baseById: {},
    currentById: {}
  };

  const bundleRoot = document.getElementById("bundle-root");
  const statusNode = document.getElementById("status");
  const saveAllButton = document.getElementById("save-all");
  const reloadDefaultsButton = document.getElementById("reload-defaults");

  const setStatus = (message, type = "info") => {
    statusNode.textContent = message;
    statusNode.dataset.type = type;
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

  const clonePhraseRules = (rules) => {
    return (Array.isArray(rules) ? rules : []).map((rule) => ({
      from: rule?.from ?? "",
      to: rule?.to ?? "",
      priority: Number.isFinite(rule?.priority) ? rule.priority : Number(rule?.priority) || 0,
      enabled: rule?.enabled !== false
    }));
  };

  const cloneCharacterRows = (characterMap) => {
    return Object.entries(characterMap || {})
      .map(([from, to]) => ({ from, to }))
      .sort((left, right) => left.from.localeCompare(right.from, "ja"));
  };

  const normalizeDefinition = (bundle, definition) => {
    if (!definition || definition.kind !== "dictionary-rules") {
      throw new Error(`${bundle.id} は dictionary-rules ではありません`);
    }

    return {
      id: bundle.id,
      label: bundle.label ?? bundle.id,
      path: bundle.path,
      enabled: bundle.enabled !== false,
      kind: definition.kind,
      phrase_rules: Array.isArray(definition.phrase_rules) ? definition.phrase_rules : [],
      character_map_priority: Number.isFinite(definition.character_map_priority)
        ? definition.character_map_priority
        : Number(definition.character_map_priority) || 10,
      character_map: (
        definition.character_map &&
        typeof definition.character_map === "object" &&
        !Array.isArray(definition.character_map)
      ) ? { ...definition.character_map } : {}
    };
  };

  const normalizeStoredOverride = (override) => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return null;
    }

    return {
      enabled: typeof override.enabled === "boolean" ? override.enabled : null,
      phrase_rules: Array.isArray(override.phrase_rules) ? override.phrase_rules : null,
      character_map_priority: Number.isFinite(override.character_map_priority)
        ? override.character_map_priority
        : Number(override.character_map_priority) || null,
      character_map: (
        override.character_map &&
        typeof override.character_map === "object" &&
        !Array.isArray(override.character_map)
      ) ? { ...override.character_map } : null
    };
  };

  const buildBundleState = (baseDefinition, override) => {
    const mergedPhraseRules = override?.phrase_rules ?? baseDefinition.phrase_rules;
    const mergedCharacterMap = override?.character_map ?? baseDefinition.character_map;

    return {
      id: baseDefinition.id,
      label: baseDefinition.label,
      enabled: override?.enabled ?? baseDefinition.enabled,
      character_map_priority: override?.character_map_priority ?? baseDefinition.character_map_priority,
      phraseRules: clonePhraseRules(mergedPhraseRules),
      characterRows: cloneCharacterRows(mergedCharacterMap)
    };
  };

  const loadStoredOverrides = async () => {
    const stored = await storageGet(STORAGE_KEY);
    const bundles = stored?.bundles;

    if (!bundles || typeof bundles !== "object" || Array.isArray(bundles)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(bundles)
        .filter(([bundleId]) => EDITABLE_BUNDLE_IDS.has(bundleId))
        .map(([bundleId, override]) => [bundleId, normalizeStoredOverride(override)])
        .filter(([, override]) => override)
    );
  };

  const buildStoragePayload = () => {
    const bundles = {};

    for (const bundleId of state.bundleOrder) {
      const bundleState = state.currentById[bundleId];
      if (!bundleState) {
        continue;
      }

      const characterMap = {};
      for (const row of bundleState.characterRows) {
        const from = `${row.from ?? ""}`.trim();
        const to = `${row.to ?? ""}`.trim();
        if (!from || !to || from === to) {
          continue;
        }

        characterMap[from] = to;
      }

      const phraseRules = bundleState.phraseRules
        .map((rule) => ({
          from: `${rule.from ?? ""}`.trim(),
          to: `${rule.to ?? ""}`.trim(),
          priority: Number.isFinite(rule.priority) ? rule.priority : Number(rule.priority) || 0,
          enabled: rule.enabled !== false
        }))
        .filter((rule) => rule.from && rule.to);

      bundles[bundleId] = {
        enabled: bundleState.enabled !== false,
        phrase_rules: phraseRules,
        character_map_priority: bundleState.character_map_priority,
        character_map: characterMap
      };
    }

    return {
      [STORAGE_KEY]: {
        bundles
      }
    };
  };

  const saveAll = async () => {
    const storagePayload = buildStoragePayload();
    await storageSet(storagePayload);

    for (const bundleId of state.bundleOrder) {
      const currentBundle = state.currentById[bundleId];
      currentBundle.characterRows = cloneCharacterRows(storagePayload[STORAGE_KEY].bundles[bundleId].character_map);
      currentBundle.phraseRules = clonePhraseRules(storagePayload[STORAGE_KEY].bundles[bundleId].phrase_rules);
    }

    renderBundles();
    setStatus("設定を保存しました。変換対象のタブを再読み込みしてください。", "success");
  };

  const saveSingleBundle = async (bundleId) => {
    const storagePayload = buildStoragePayload();
    await storageSet(storagePayload);

    const payload = storagePayload[STORAGE_KEY].bundles[bundleId];
    state.currentById[bundleId].characterRows = cloneCharacterRows(payload.character_map);
    state.currentById[bundleId].phraseRules = clonePhraseRules(payload.phrase_rules);

    renderBundles();
    setStatus(`${state.currentById[bundleId].label} を保存しました。`, "success");
  };

  const resetBundle = (bundleId) => {
    const baseDefinition = state.baseById[bundleId];
    state.currentById[bundleId] = buildBundleState(baseDefinition, null);
    renderBundles();
    setStatus(`${baseDefinition.label} を既定値に戻しました。保存すると反映されます。`);
  };

  const createButton = (label, className, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const bindFilter = (section, bundleId) => {
    const searchInput = section.querySelector("[data-role='search']");
    const applyFilter = () => {
      const term = searchInput.value.trim();
      const rows = section.querySelectorAll("[data-search-value]");

      for (const row of rows) {
        const value = row.dataset.searchValue || "";
        row.classList.toggle("hidden-row", Boolean(term) && !value.includes(term));
      }
    };

    searchInput.addEventListener("input", applyFilter);
    applyFilter();

    const enabledToggle = section.querySelector("[data-role='enabled']");
    enabledToggle.checked = state.currentById[bundleId].enabled !== false;
    enabledToggle.addEventListener("change", () => {
      state.currentById[bundleId].enabled = enabledToggle.checked;
    });
  };

  const renderCharacterRows = (tbody, bundleId) => {
    tbody.textContent = "";
    const bundleState = state.currentById[bundleId];

    bundleState.characterRows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");

      const fromTd = document.createElement("td");
      const fromInput = document.createElement("input");
      fromInput.type = "text";
      fromInput.className = "compact";
      fromInput.value = row.from;
      fromInput.addEventListener("input", () => {
        bundleState.characterRows[rowIndex].from = fromInput.value;
        tr.dataset.searchValue = `${fromInput.value} ${toInput.value}`;
      });
      fromTd.appendChild(fromInput);

      const toTd = document.createElement("td");
      const toInput = document.createElement("input");
      toInput.type = "text";
      toInput.className = "compact";
      toInput.value = row.to;
      toInput.addEventListener("input", () => {
        bundleState.characterRows[rowIndex].to = toInput.value;
        tr.dataset.searchValue = `${fromInput.value} ${toInput.value}`;
      });
      toTd.appendChild(toInput);

      const actionTd = document.createElement("td");
      actionTd.appendChild(createButton("削除", "danger row-delete", () => {
        bundleState.characterRows.splice(rowIndex, 1);
        renderBundles();
      }));

      tr.dataset.searchValue = `${row.from} ${row.to}`;
      tr.append(fromTd, toTd, actionTd);
      tbody.appendChild(tr);
    });
  };

  const renderPhraseRows = (tbody, bundleId) => {
    tbody.textContent = "";
    const bundleState = state.currentById[bundleId];

    bundleState.phraseRules.forEach((rule, ruleIndex) => {
      const tr = document.createElement("tr");

      const fromTd = document.createElement("td");
      const fromInput = document.createElement("input");
      fromInput.type = "text";
      fromInput.value = rule.from;
      fromInput.addEventListener("input", () => {
        bundleState.phraseRules[ruleIndex].from = fromInput.value;
        tr.dataset.searchValue = `${fromInput.value} ${toInput.value}`;
      });
      fromTd.appendChild(fromInput);

      const toTd = document.createElement("td");
      const toInput = document.createElement("input");
      toInput.type = "text";
      toInput.value = rule.to;
      toInput.addEventListener("input", () => {
        bundleState.phraseRules[ruleIndex].to = toInput.value;
        tr.dataset.searchValue = `${fromInput.value} ${toInput.value}`;
      });
      toTd.appendChild(toInput);

      const priorityTd = document.createElement("td");
      const priorityInput = document.createElement("input");
      priorityInput.type = "number";
      priorityInput.value = String(rule.priority);
      priorityInput.addEventListener("input", () => {
        bundleState.phraseRules[ruleIndex].priority = Number(priorityInput.value) || 0;
      });
      priorityTd.appendChild(priorityInput);

      const actionTd = document.createElement("td");
      actionTd.appendChild(createButton("削除", "danger row-delete", () => {
        bundleState.phraseRules.splice(ruleIndex, 1);
        renderBundles();
      }));

      tr.dataset.searchValue = `${rule.from} ${rule.to}`;
      tr.append(fromTd, toTd, priorityTd, actionTd);
      tbody.appendChild(tr);
    });
  };

  const createSection = (bundleId) => {
    const bundleState = state.currentById[bundleId];
    const section = document.createElement("section");
    section.className = "bundle-card";
    section.dataset.bundleId = bundleId;

    const charCount = bundleState.characterRows.length;
    const phraseCount = bundleState.phraseRules.length;

    section.innerHTML = `
      <div class="bundle-head">
        <div class="bundle-title">
          <h2>${bundleState.label}</h2>
          <span class="chip">${bundleId}</span>
        </div>
        <label class="toggle">
          <input data-role="enabled" type="checkbox">
          この箱を有効にする
        </label>
      </div>
      <div class="bundle-body">
        <div class="control-row">
          <div class="search-row">
            <input data-role="search" class="search-input" type="text" placeholder="文字・熟語で絞り込み">
            <span class="count">単漢字 ${charCount} 件 / 熟語 ${phraseCount} 件</span>
          </div>
          <div class="bundle-actions">
            <button data-role="add-char" class="secondary" type="button">単漢字を追加</button>
            <button data-role="add-phrase" class="secondary" type="button">熟語を追加</button>
            <button data-role="reset" class="ghost" type="button">既定へ戻す</button>
            <button data-role="save" class="primary" type="button">この箱を保存</button>
          </div>
        </div>
        <div class="panel-block">
          <h3>単漢字置換</h3>
          <p class="hint">1 文字ずつの置換です。旧字参照外のものは一般単漢字置換へ置き、危険なものは熟語や条件付きルールへ逃がしてください。</p>
          <div class="scroll-area">
            <table>
              <thead>
                <tr>
                  <th>変換前</th>
                  <th>変換後</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody data-role="char-body"></tbody>
            </table>
          </div>
        </div>
        <div class="panel-block">
          <h3>固定熟語置換</h3>
          <p class="hint"><code>奇跡 → 奇蹟</code> のような固定熟語です。優先度が高いほど先に適用されます。</p>
          <div class="scroll-area">
            <table>
              <thead>
                <tr>
                  <th>変換前</th>
                  <th>変換後</th>
                  <th>priority</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody data-role="phrase-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    section.querySelector("[data-role='add-char']").addEventListener("click", () => {
      state.currentById[bundleId].characterRows.push({ from: "", to: "" });
      renderBundles();
    });

    section.querySelector("[data-role='add-phrase']").addEventListener("click", () => {
      state.currentById[bundleId].phraseRules.push({ from: "", to: "", priority: 90, enabled: true });
      renderBundles();
    });

    section.querySelector("[data-role='reset']").addEventListener("click", () => {
      resetBundle(bundleId);
    });

    section.querySelector("[data-role='save']").addEventListener("click", async () => {
      try {
        await saveSingleBundle(bundleId);
      } catch (error) {
        console.error(error);
        setStatus(`保存に失敗しました: ${error.message}`, "error");
      }
    });

    renderCharacterRows(section.querySelector("[data-role='char-body']"), bundleId);
    renderPhraseRows(section.querySelector("[data-role='phrase-body']"), bundleId);
    bindFilter(section, bundleId);

    return section;
  };

  const renderBundles = () => {
    bundleRoot.textContent = "";
    for (const bundleId of state.bundleOrder) {
      bundleRoot.appendChild(createSection(bundleId));
    }
  };

  const initialize = async () => {
    const bundleManifest = await loadJson5Resource(TRANSFORM_BUNDLES_PATH);
    const editableBundles = (bundleManifest.bundles || [])
      .filter((bundle) => EDITABLE_BUNDLE_IDS.has(bundle.id))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

    const storedOverrides = await loadStoredOverrides();

    state.bundleOrder = editableBundles.map((bundle) => bundle.id);

    for (const bundle of editableBundles) {
      const definition = normalizeDefinition(bundle, await loadJson5Resource(bundle.path));
      state.baseById[bundle.id] = definition;
      state.currentById[bundle.id] = buildBundleState(definition, storedOverrides[bundle.id]);
    }

    renderBundles();
    setStatus("既定値と保存済み設定を読込しました。");
  };

  saveAllButton.addEventListener("click", async () => {
    try {
      await saveAll();
    } catch (error) {
      console.error(error);
      setStatus(`保存に失敗しました: ${error.message}`, "error");
    }
  });

  reloadDefaultsButton.addEventListener("click", async () => {
    try {
      await initialize();
    } catch (error) {
      console.error(error);
      setStatus(`再読込に失敗しました: ${error.message}`, "error");
    }
  });

  initialize().catch((error) => {
    console.error(error);
    setStatus(`設定画面の初期化に失敗しました: ${error.message}`, "error");
  });
})();

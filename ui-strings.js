(() => {
  "use strict";

  const ja = {
    options: {
      popupBundleLabel: "Popup 置換対象",
      invalidImportedRoots: "読み込みデータから roots を復元できません",
      invalidSequenceArray: "sequence は配列で指定してください",
      searchPlaceholder: "検索",
      emptySequence: "sequence は未設定です。",
      emptySequenceShort: "sequence は未設定",
      sequenceTitle: "sequence",
      bulkImportTitle: "一括登録",
      bulkImportHint: "変更前,変更後[,優先度,有効,正規表現,原形一致]",
      bulkImportExample: "例:\nかわいい,可愛い,90,true,false,true\nすごい,凄い,90,true",
      itemTitle: "項目",
      detailsTitle: "条件",
      detailHint: "前条件・現条件・後条件・sequence を編集",
      dismissedDiagnosticsTitle: "非表示の診断",
      noCommands: "利用可能なコマンドがありません。",
      noShortcut: "未設定",
      noDisabledSites: "無効化しているドメインはありません。",
      noVisibleBundle: "表示できる bundle がありません。",
      noSearchResult: "検索条件に一致する bundle / group / rule はありません。",
      explorerAll: "全体",
      explorerTitle: "Explorer",
      buttonMove: "移動",
      buttonDelete: "削除",
      buttonAdd: "追加",
      buttonAddToken: "Token追加",
      buttonAddOrCondition: "OR 条件追加",
      buttonAddBulk: "一括追加",
      buttonClearInput: "入力クリア",
      buttonCopySelection: "選択コピー",
      buttonCutSelection: "選択切り取り",
      buttonPasteHere: "ここへ貼り付け",
      buttonAddGroup: "子箱追加",
      buttonAddEntry: "項目追加",
      buttonDeleteSelection: "選択削除",
      buttonResetRoot: "初期化",
      buttonDeleteBundle: "Bundle削除",
      buttonDeleteGroup: "Group削除",
      buttonCollapse: "折りたたむ",
      buttonExpand: "展開",
      buttonShow: "表示",
      buttonHide: "非表示",
      buttonClose: "閉じる",
      buttonCondition: "条件",
      buttonDismiss: "×",
      dragEntries: "項目を移動",
      dragNodes: "箱を移動",
      bundleKindTitle: "Bundle の種別変更",
      detailOpenTitle: "条件を開く",
      detailCloseTitle: "条件を閉じる",
      detailUnavailable: "dictionary-rules では条件・sequence を使いません",
      jumpLonger: "長い側へ移動",
      jumpShorter: "短い側へ移動",
      jumpTarget: "移動",
      tokenizerAdd: "解析結果を追加",
      tokenizerNoTarget: "追加先の箱がありません。先に Bundle を作成してください。",
      tokenizerInvalid: "解析結果から項目を生成できませんでした。",
      diagnosticsRestoreAll: "すべて再表示",
      diagnosticsRestore: "再表示",
      diagnosticsDismissTitle: "この診断を非表示",
      previous: "前",
      current: "現",
      next: "後",
      fieldSurface: "表層",
      fieldBasic: "原形",
      fieldBasicCondition: "原形条件",
      fieldPos: "品詞",
      fieldPos1: "品詞1",
      fieldCform: "活用形",
      fieldCtype: "活用型",
      fieldEnabled: "有効",
      fieldRegex: "正規",
      fieldBasicMatch: "原形一致",
      fieldFrom: "変更前",
      fieldTo: "変更後",
      fieldPriority: "優先",
      fieldActions: "操作"
    }
  };

  const literalMap = new Map([
    ["Popup 霑ｽ蜉蟇ｾ雎｡", ja.options.popupBundleLabel],
    ["隱ｭ縺ｿ霎ｼ繧薙□繝・・繧ｿ縺九ｉ roots 繧呈ｧ狗ｯ峨〒縺阪∪縺帙ｓ", ja.options.invalidImportedRoots],
    ["sequence 縺ｯ驟榊・縺ｧ謖・ｮ壹＠縺ｦ縺上□縺輔＞", ja.options.invalidSequenceArray],
    ["讀懃ｴ｢", ja.options.searchPlaceholder],
    ["sequence 縺ｯ譛ｪ險ｭ螳壹〒縺吶・", ja.options.emptySequence],
    ["sequence 縺ｯ譛ｪ險ｭ螳壹〒縺・", ja.options.emptySequenceShort],
    ["荳諡ｬ逋ｻ骭ｲ", ja.options.bulkImportTitle],
    ["荳諡ｬ霑ｽ蜉", ja.options.buttonAddBulk],
    ["蜈･蜉帙け繝ｪ繧｢", ja.options.buttonClearInput],
    ["鬆・岼", ja.options.itemTitle],
    ["譚｡莉ｶ", ja.options.detailsTitle],
    ["蜑榊ｾ梧擅莉ｶ繝ｻ迴ｾ譚｡莉ｶ繝ｻsequence 繧堤ｷｨ髮・", ja.options.detailHint],
    ["髱櫁｡ｨ遉ｺ縺ｮ險ｺ譁ｭ", ja.options.dismissedDiagnosticsTitle],
    ["蛻ｩ逕ｨ蜿ｯ閭ｽ縺ｪ繧ｳ繝槭Φ繝峨′縺ゅｊ縺ｾ縺帙ｓ縲・", ja.options.noCommands],
    ["譛ｪ蜑ｲ蠖・", ja.options.noShortcut],
    ["辟｡蜉ｹ蛹悶＠縺ｦ縺・ｋ繝峨Γ繧､繝ｳ縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲・", ja.options.noDisabledSites],
    ["陦ｨ遉ｺ縺ｧ縺阪ｋ bundle 縺後≠繧翫∪縺帙ｓ縲・", ja.options.noVisibleBundle],
    ["讀懃ｴ｢譚｡莉ｶ縺ｫ荳閾ｴ縺吶ｋ bundle / group / rule 縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲・", ja.options.noSearchResult],
    ["蜈ｨ菴・", ja.options.explorerAll],
    ["Explorer", ja.options.explorerTitle],
    ["蜑企勁", ja.options.buttonDelete],
    ["霑ｽ蜉", ja.options.buttonAdd],
    ["Token霑ｽ蜉", ja.options.buttonAddToken],
    ["OR 譚｡莉ｶ霑ｽ蜉", ja.options.buttonAddOrCondition],
    ["驕ｸ謚槭さ繝斐・", ja.options.buttonCopySelection],
    ["驕ｸ謚槫・蜿悶ｊ", ja.options.buttonCutSelection],
    ["縺薙％縺ｸ雋ｼ莉倥￠", ja.options.buttonPasteHere],
    ["蟄千ｮｱ霑ｽ蜉", ja.options.buttonAddGroup],
    ["陦瑚ｿｽ蜉", ja.options.buttonAddEntry],
    ["驕ｸ謚槫炎髯､", ja.options.buttonDeleteSelection],
    ["蛻晄悄蛹・", ja.options.buttonResetRoot],
    ["Bundle蜑企勁", ja.options.buttonDeleteBundle],
    ["邂ｱ蜑企勁", ja.options.buttonDeleteGroup],
    ["螻暮幕", ja.options.buttonExpand],
    ["謚倥ｊ逡ｳ繧", ja.options.buttonCollapse],
    ["隱ｭ縺ｿ霎ｼ縺ｿ繧・ｽｯ・ｧ邵ｺ荳岩味邵ｺ霈費ｼ・", "設定を読み込みました。"],
    ["險ｭ螳壹ｒ菫晏ｭ倥＠縲∫樟蝨ｨ縺ｮ繧ｿ繝悶∈蜊ｳ譎ょ渚譏縺励∪縺励◆縲・", "設定を保存しました。現在のタブへ即時反映しました。"],
    ["險ｭ螳壹ｒ菫晏ｭ倥＠縺ｾ縺励◆縲ょｯｾ雎｡繧ｿ繝悶ｒ蜀崎ｪｭ縺ｿ霎ｼ縺ｿ縺励※縺上□縺輔＞縲・", "設定を保存しました。表示タブを再読み込みしてください。"],
    ["譌｢螳壼､縺ｸ謌ｻ縺励∪縺励◆縲・", "既定値へ戻しました。"],
    ["Bundle 繧定ｿｽ蜉縺励∪縺励◆縲・", "Bundle を追加しました。"],
    ["JSON 繧呈嶌縺榊・縺励∪縺励◆縲・", "JSON を書き出しました。"],
    ["YAML 繧呈嶌縺榊・縺励∪縺励◆縲・", "YAML を書き出しました。"],
    ["runtime 險ｭ螳壹ｒ譖ｴ譁ｰ縺励∪縺励◆縲ゆｿ晏ｭ倥☆繧九→諡｡蠑ｵ譛ｬ菴薙∈蜿肴丐縺輔ｌ縺ｾ縺吶・", "runtime 設定を更新しました。保存すると本文へ反映されます。"],
    ["諡｡蠑ｵ蜈ｨ菴薙・譛牙柑迥ｶ諷九ｒ譖ｴ譁ｰ縺励∪縺励◆縲ゆｿ晏ｭ倥☆繧九→蜊ｳ譎ょ渚譏縺輔ｌ縺ｾ縺吶・", "拡張全体の有効状態を更新しました。保存すると即時反映されます。"],
    ["迴ｾ蝨ｨ繧ｵ繧､繝医・蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆縲・", "現在サイトの取得に失敗しました。"],
    ["荳諡ｬ逋ｻ骭ｲ縺ｧ縺阪ｋ陦後′縺ゅｊ縺ｾ縺帙ｓ縲・", "一括登録できる行がありません。"],
    ["dictionary-rules 縺ｧ縺ｯ譚｡莉ｶ繝ｻsequence 繧剃ｽｿ縺・∪縺帙ｓ", ja.options.detailUnavailable]
  ]);

  const patternResolvers = [
    [/^token (\d+) 莉ｶ \/ 驕ｸ謚・(\d+) 莉ｶ$/, (_, count, selected) => `token ${count} 件 / 選択 ${selected} 件`],
    [/^dictionary (\d+) 莉ｶ \/ 驕ｸ謚・(\d+) 莉ｶ$/, (_, count, selected) => `dictionary ${count} 件 / 選択 ${selected} 件`],
    [/^鬆・岼 (\d+)$/, (_, count) => `項目 ${count}`],
    [/^蟄千ｮｱ (\d+)$/, (_, count) => `子箱 ${count}`],
    [/^譚｡莉ｶ (\d+)$/, (_, count) => `条件 ${count}`],
    [/^驥崎､・＠縺溷､画峩蜑・ (.+)$/, (_, entryKey) => `重複した変更前: ${entryKey}`],
    [/^驥崎､・＠縺溘げ繝ｫ繝ｼ繝怜錐: (.+)$/, (_, label) => `重複したグループ名: ${label}`],
    [/^蛹・性: (.+) 竓・(.+)$/, (_, longer, shorter) => `包含: ${longer} ⊃ ${shorter}`],
    [/^蠖｢諷狗ｴ隗｣譫舌↓螟ｱ謨励＠縺ｾ縺励◆: (.+)$/, (_, message) => `形態素解析に失敗しました: ${message}`],
    [/^菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆: (.+)$/, (_, message) => `保存に失敗しました: ${message}`],
    [/^JSON 譖ｸ縺榊・縺励↓螟ｱ謨励＠縺ｾ縺励◆: (.+)$/, (_, message) => `JSON の書き出しに失敗しました: ${message}`],
    [/^YAML 譖ｸ縺榊・縺励↓螟ｱ謨励＠縺ｾ縺励◆: (.+)$/, (_, message) => `YAML の書き出しに失敗しました: ${message}`],
    [/^繧ｷ繝ｧ繝ｼ繝医き繝・ヨ逕ｻ髱｢繧帝幕縺代∪縺帙ｓ縺ｧ縺励◆: (.+)$/, (_, message) => `ショートカット画面を開けませんでした: ${message}`],
    [/^迴ｾ蝨ｨ繧ｵ繧､繝医・霑ｽ蜉縺ｫ螟ｱ謨励＠縺ｾ縺励◆: (.+)$/, (_, message) => `現在サイトの追加に失敗しました: ${message}`],
    [/^蛻晄悄蛹悶↓螟ｱ謨励＠縺ｾ縺励◆: (.+)$/, (_, message) => `初期化に失敗しました: ${message}`]
  ];

  const format = (text, params = {}) => {
    let output = `${text ?? ""}`;
    for (const [key, value] of Object.entries(params)) {
      output = output.replaceAll(`{${key}}`, `${value ?? ""}`);
    }
    return output;
  };

  const get = (path, params = {}) => {
    const keys = `${path ?? ""}`.split(".");
    let current = ja;
    for (const key of keys) {
      if (!key) {
        continue;
      }
      current = current?.[key];
      if (current === undefined) {
        return format(path, params);
      }
    }
    return typeof current === "string" ? format(current, params) : current;
  };

  const resolve = (value, params = {}) => {
    if (typeof value !== "string") {
      return value;
    }
    const exact = literalMap.get(value);
    if (exact) {
      return format(exact, params);
    }
    for (const [pattern, resolver] of patternResolvers) {
      const match = value.match(pattern);
      if (match) {
        return format(resolver(...match), params);
      }
    }
    return format(value, params);
  };

  globalThis.ExtensionUiStrings = {
    ja,
    get,
    resolve,
    format
  };
})();

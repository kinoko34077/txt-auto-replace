# template: ui_repair_prompt

## 既存UI修正プロンプト
```txt
以下の既存UIを、UI/UXプロトコルパックに従って修正してください。
まずコード変更せず、問題を分類してください。

確認観点:
- 巨大ボタン化していないか
- 長文ボタンが常時表示されていないか
- Primary/Secondary/Row/Dangerが混ざっていないか
- 情報密度が低すぎる/高すぎるか
- tableでよい箇所をcard化していないか
- tooltip/aria-label/visible label/focus/contrastが不足していないか
- 配置理由を説明できるか

出力:
1. 問題一覧
2. 修正方針
3. 変更対象ファイル
4. 差分実装
5. 検収結果
```

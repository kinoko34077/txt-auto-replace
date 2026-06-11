# 06_ACCESSIBILITY_CHECKLIST: アクセシビリティ検収

## 1. 基準
本チェックリストはWCAG 2.2 AA相当を目標とする。完全な法的適合証明ではなく、AI実装時に最低限の崩壊を防ぐための検収用である。

## 2. 必須チェック
|項目|確認内容|NG例|
|---|---|---|
|Keyboard|Tabで主要操作へ到達できるか|クリック必須の隠し操作|
|Focus visible|フォーカス位置が見えるか|outline: noneのみ|
|Label|inputにvisible labelがあるか|placeholderだけ|
|Name/Role/Value|button, input, dialog等が機械可読か|div onclickだけ|
|Icon button|tooltipとaria-labelがあるか|ゴミ箱アイコンだけ|
|Contrast|本文4.5:1、非テキスト3:1目安|薄灰色文字、薄い境界|
|Target size|最低24px、タッチ主体なら44px目安|小さすぎるクリック領域|
|Error|エラー箇所と理由が分かるか|赤枠だけ|
|Status|保存中/完了/失敗が伝わるか|視覚だけ、読み上げ不可|
|Reflow|狭幅や拡大時に破綻しないか|横スクロール必須のフォーム|

## 3. 実装ルール
- `<button>` を使える場所で `<div role="button">` に逃げない。
- icon-only buttonには `aria-label` を付ける。
- decorative iconには `aria-hidden="true"` を付ける。
- dialogはfocus trap、escape close、初期focus、aria-modalを考慮する。
- error messageは対象inputと関連付ける。
- loadingやsave statusは `role="status"` またはaria-liveを検討する。

## 4. 完了報告
検収結果は「OK/修正/未確認」で出す。未確認が残る場合は、なぜ未確認かを明記する。

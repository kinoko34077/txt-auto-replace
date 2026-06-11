# reference: UI/UX調査ダイジェスト

## 1. 位置づけ
この文書は根拠資料の要約であり、実装時の最上位命令ではない。AIはまず `00_START_HERE.md` を読み、必要に応じて本資料を参照する。

## 2. 横断的に一致する原則
- 一画面の主目的を絞る。
- 視覚階層はサイズ、余白、色、近接、グルーピングで作る。
- Primary / Secondary / Tertiary / Row / Danger を分離する。
- icon-onlyは既知の補助操作に限定し、tooltipとaria-labelを補う。
- placeholderをlabel代替にしない。
- tableは比較・一覧・編集に強く、cardは少数概要や視覚選択に向く。
- progressive disclosureで低頻度・上級機能を退避する。
- レスポンシブは単純縮小ではなく、面構成を再編成する。
- Design Tokenで余白・文字・色・状態を意味単位で管理する。
- WCAG 2.2 AA相当のラベル、focus、contrast、target size、status messageを最低限確認する。

## 3. 参照した代表的系統
- W3C WCAG 2.2: アクセシビリティ達成基準。
- Apple Human Interface Guidelines: プラットフォーム文脈、toolbar、split view、semantic color。
- Material Design: action hierarchy、adaptive layout、button/icon button、design tokens。
- Microsoft Fluent 2: toolbar、button、spacing、accessibility。
- IBM Carbon: data table、productive density、2x grid、tokens。
- Atlassian Design System: icon button、tooltip、page layout、density。
- GOV.UK Design System: form、visible label、error summary、button hierarchy。
- Nielsen Norman Group: usability heuristics、visual hierarchy、icon usability、progressive disclosure。
- Baymard Institute: form usability、placeholder/inline label、checkout complexity。

## 4. AIコーディングへの変換
調査知識はそのまま渡しても使いづらい。AI実装では、調査結果を「禁止事項」「既定値」「質問発火条件」「検収項目」に変換する必要がある。本パックではその変換済み成果を `01`〜`07` の運用ファイルに配置している。

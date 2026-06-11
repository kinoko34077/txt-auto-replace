# 05_LAYOUT_RULES: レイアウト規約

## 1. 基本配置原則
|領域|置くもの|置かないもの|
|---|---|---|
|上部|画面名、状態、検索、表示切替、主要操作|低頻度設定、危険操作の密集|
|左|ナビ、カテゴリ、ファイル/プロジェクト選択|行内操作、詳細編集|
|中央|主データ、主編集領域、表、キャンバス|補助説明、巨大ボタン群|
|右|選択項目の詳細、プロパティ、補助設定|全体ナビ、主一覧|
|下部|必要時のみ保存バー、進捗、ステータス|大量ボタン、常時広告的説明|
|行右端|編集、複製、削除、詳細等の行操作|グローバル操作|

## 2. 画面型
### 2.1 管理一覧型
- Header: タイトル、検索、filter、primary add/export。
- Main: table/data grid。
- Row end: edit/copy/delete/menu。
- Right panel: 選択行詳細。
- 避ける: 全項目card化、各cardに巨大ボタン。

### 2.2 制作エディタ型
- Header/Toolbar: 保存、undo/redo、表示切替、実行。
- Left: asset/layer/file tree。
- Main: canvas/editor/timeline。
- Right: inspector/properties。
- Bottom: timeline/log/status必要時。
- 避ける: 操作説明の常時表示、主作業領域を狭める過大パネル。

### 2.3 設定画面型
- Left: 設定カテゴリ。
- Main: sectioned form。
- Right: help/detailsは必要時だけ。
- Primary: 保存または適用。
- Danger: danger zoneとして分離。
- 避ける: 全設定をaccordionに隠す、保存ボタンを複数置く。

### 2.4 ダッシュボード型
- Header: 期間、filter、refresh、export。
- Main: summary cards + charts + table。
- Chart: 比較目的なら凡例・軸・単位明記。
- 避ける: 装飾グラフ優先でデータ表を消す。

## 3. レスポンシブ方針
- 縮小ではなく再配置する。
- 優先順位は Main > Primary Action > Search/Filter > Navigation > Details > Low Frequency Actions。
- 狭幅時、left sidebarはdrawer/collapse、right panelはbottom sheet/detail pageへ退避する。
- tableは列優先度を持ち、低優先列を隠すか詳細へ逃がす。
- toolbarはoverflow menuを使い、二段折返しを避ける。

## 4. 密度方針
|密度|用途|特徴|
|---|---|---|
|compact|業務、管理、編集、常用|行高小、余白少、情報量多|
|normal|一般SaaS、初見と常用の中間|標準余白、文言や説明を少し許容|
|spacious|LP、オンボーディング、タッチ中心|大きめ余白、説明多め|

既定はcompact。タッチ中心や一般ユーザー向けでない限り、spaciousを既定にしない。

## 5. 視線導線
- 画面タイトル→状態/検索→主データ→選択詳細→行操作の順で自然に追えるようにする。
- ボタンや装飾が主データより目立たないようにする。
- 強調色は主操作、選択状態、警告など意味を持つ箇所に限定する。

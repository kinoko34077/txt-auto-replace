# 04_COMPONENT_RULES: コンポーネント規約

## 1. Button
|種類|用途|表示|禁止|
|---|---|---|---|
|Primary|画面の主操作|filled/strong、短語|複数配置、長文、補助操作への使用|
|Secondary|主操作の補助|outlined/text|Primaryと同じ強さにしない|
|Tertiary|低頻度補助|text/menu|常時大きく表示しない|
|Icon Button|既知の補助操作|icon + tooltip + aria-label|主操作、意味不明操作への使用|
|Danger|削除・初期化等|danger style + confirm|通常操作の隣に無造作に置く|

文言は短語を原則とする。保存、追加、編集、複製、削除、出力、取込、実行、停止、更新、戻す、開く、閉じる。説明文はbutton labelではなくtooltip/helper textへ逃がす。

## 2. Toolbar
- 画面タイトル、状態、検索、表示切替、主要操作を置く。
- 操作を論理グループ化する。
- 溢れた操作はoverflow menuへ送る。二段に折り返さない。
- 破壊的操作はtoolbarの通常操作群から離す。
- icon-onlyはtooltip/aria-label必須。

## 3. Table / Data Grid
- 比較・一覧・編集が主目的ならcardではなくtableを優先する。
- 列見出しは1〜2語を基本にする。
- 行内操作は右端に集約する。
- 一括操作は選択時にselection toolbarとして出す。
- 行高はcompactなら28〜36px。
- 詳細は右panelまたはrow expansion。展開内容が窮屈なら別panelへ逃がす。

## 4. Form
- inputには必ずvisible labelを付ける。
- placeholderは補助例だけに使い、label代替にしない。
- helper textとerror textは分離する。
- 関連項目はfieldset/sectionでまとめる。
- 長いフォームはセクション分割またはstep化する。
- 保存/送信はPrimary、キャンセルはSecondary、削除はDangerとして離す。

## 5. Card
- cardは概要把握、少数項目、視覚的選択、メディア表示に使う。
- 高密度な比較、編集、一覧管理には原則使わない。
- card内に強いボタンを複数置かない。
- card gridで情報が欠けるならtable/listへ戻す。

## 6. Modal / Dialog
- 短時間で完結する確認、警告、軽い入力に使う。
- 継続編集や多項目設定には使わない。side panelまたは専用画面を使う。
- destructive confirmationでは、対象名・影響・回復可否を明記する。
- modal内でさらにmodalを開かない。

## 7. Side Panel / Inspector
- 一覧の選択項目詳細、プロパティ編集、補助設定に使う。
- main contentを狭めすぎない。既定幅は280〜360px。
- 狭幅時はcollapse、drawer、別画面へ変える。

## 8. Disclosure / Accordion
- 上級設定、詳細説明、補足情報に使う。
- 「展開する」ボタンではなく、見出し行 + chevron + aria-labelを基本にする。
- 開閉状態を視覚的に明示する。
- 主作業に必要な項目を隠しすぎない。

## 9. Notification / Toast
- 成功通知は控えめにする。
- エラーや保存失敗はtoastだけにせず、関連箇所にも表示する。
- undo可能な削除はtoast + undoが有効。
- 進捗・保存中・完了などはstatus messageとして支援技術へ伝える。

# Text Transform API 移行仕様

## 変更情報

- 版: 1.0
- 日付: 2026-09-07
- 対象: `content.js`、`text-api-client.js`、`manifest.json`

## 目的

標準変換bundleの実行を `kinotch-api` の Text Transform Workerへ寄せ、複数のクライアントで変換仕様を共有する。既存のユーザー編集可能なbundleと、API障害時のローカル処理は維持する。

## 実行条件

API利用は次の条件をすべて満たす場合に限る。

1. デバッグ対象を指定していない。
2. 有効なstageが共通APIで対応するbundle IDだけで構成されている。
3. 有効なstageの定義が同梱された標準定義と一致している。
4. `text-api-client.js` が利用可能である。
5. ユーザーがオプションで外部送信を明示許可している（既定OFF）。
6. **現在のHTTPSサイトのホスト名**が個別に許可されている（完全一致・サブドメインへ自動拡張しない）。
5. API応答の `profile` 順序、`ruleSetVersion`、`ruleSetHash` が同梱標準rule-setの固定identityと一致する。

ユーザーがbundle、Group、Entry、Popup辞書を変更した場合は、変換結果の再現性を優先して既存のローカルWorkerを使用する。

## API契約

- URL: `POST https://api.kinotch.workers.dev/v1/transform/batch`
- 入力: `{ texts: string[], profile: string[] }`
- 出力: `{ texts: string[], profile: string[], engineVersion: string, ruleSetVersion: string, ruleSetHash: string }`
- 順序: 出力 `texts` は入力 `texts` と同じ順序
- 制限: 1 batch 256件以下、合計20万文字以下

## 状態とfallback

標準bundleでも既定はローカルWorkerを利用する。明示的に外部送信を許可し、かつ現在サイトを登録した場合だけAPIを優先する。通信失敗、HTTPエラー、不正なbatch応答、profile/rule-set identity不一致が発生したページではAPIを無効化してローカルWorkerへ切り替える。切り替え時は処理対象rootを再キューし、既に変換済みの文字列を復元してから再実行する。

カスタムbundleでは最初からAPIを使わず、従来どおりローカルWorkerで実行する。デバッグモードも同様にローカル実行とする。

## 遅延・負荷

許可されたページでは、text runを最大256件ずつまとめてAPIへ送る。API側ではTokenizerをWorkerインスタンス内で再利用するため、text runごとの辞書初期化は発生しない。大きなページだけ複数batchへ分割する。

API応答待ちの間もページ自体は操作でき、応答結果を検証してからDOMへ反映する。APIが利用できない場合はローカルWorkerへ切り替えるため、変換不能で停止しない。

## 外部送信範囲

明示的なグローバル許可と個別サイト許可の**両方**がある標準bundleでのみ、変換対象として収集したページ上のtext run本文を外部APIへ送信する。HTML構造、属性、設定保存データ、ユーザー独自rule定義は送信しない。カスタムbundleとデバッグ対象では本文をAPIへ送信しない。

## 受入条件

- 標準bundleでAPIが返した `profile` 順序・`ruleSetVersion`・`ruleSetHash` が同梱identityと一致するときだけ、`texts` が同じrunへ同じ順序で反映される。
- profile/rule-set identity不一致時はDOMへremote結果を適用せず、復元後にローカルWorkerへfallbackする。
- API障害後にローカルWorkerへ切り替わり、ページ変換が継続する。
- カスタムbundle、Popup辞書、デバッグ対象ではAPIへ送信されない。
- 既存のruby DOM処理、MutationObserver、設定反映、Undo/Redoに影響しない。

## 外部送信の選択と変更時の境界（#23）

- 新規・既存設定とも外部API送信は既定OFF。オプションの「外部APIによる文字列変換を許可する」をONにし、対象のHTTPSサイトのホスト名を手入力で明示登録して**保存**した場合のみ外部送信を許可する。オプション画面自身のアクティブタブを誤って対象としないため、自動的に「現在のタブ」から送信先を推定しない。登録解除・OFFで、以後の送信はローカル処理へ戻る。
- 許可対象はホスト名の完全一致で、別サブドメインやHTTP・file・拡張機能ページを暗黙許可しない。特定ドメイン内のページ本文全体が対象になり得るため、メール・社内文書等を含むサイトは安易に許可しない。
- Chrome storageの変更通知を受けたcontent scriptは直ちに新規リモート送信を止め、再読込後にルールを再適用する。**既に送信済みのデータは回収できない**。リモート実行中にOFFへ切り替わった場合、古い応答の適用を避ける。タブ再読込は原則不要。
- 保存されるのは外部送信を許可するフラグとドメイン一覧。サーバー側の記録保持・ログ削除については検証されていないため保証しない。

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

ユーザーがbundle、Group、Entry、Popup辞書を変更した場合は、変換結果の再現性を優先して既存のローカルWorkerを使用する。

## API契約

- URL: `POST https://api.kinotch.workers.dev/v1/transform/batch`
- 入力: `{ texts: string[], profile: string[] }`
- 出力: `{ texts: string[], profile: string[], engineVersion: string }`
- 順序: 出力 `texts` は入力 `texts` と同じ順序
- 制限: 1 batch 256件以下、合計20万文字以下

## 状態とfallback

標準bundleではAPIを優先し、通信失敗、HTTPエラー、不正なbatch応答が発生したページではAPIを無効化してローカルWorkerへ切り替える。切り替え時は処理対象rootを再キューし、既に変換済みの文字列を復元してから再実行する。

カスタムbundleでは最初からAPIを使わず、従来どおりローカルWorkerで実行する。デバッグモードも同様にローカル実行とする。

## 遅延・負荷

通常のページ初期化では、text runを最大256件ずつまとめてAPIへ送る。API側ではTokenizerをWorkerインスタンス内で再利用するため、text runごとの辞書初期化は発生しない。大きなページだけ複数batchへ分割する。

API応答待ちの間もページ自体は操作でき、応答結果を検証してからDOMへ反映する。APIが利用できない場合はローカルWorkerへ切り替えるため、変換不能で停止しない。

## 外部送信範囲

API利用条件を満たす標準bundleでは、変換対象として収集したページ上のtext run本文をWorkerへ送信する。HTML構造、属性、設定保存データ、ユーザー独自rule定義は送信しない。カスタムbundleとデバッグ対象では本文をAPIへ送信しない。

## 受入条件

- 標準bundleでAPIが返した `texts` が同じrunへ同じ順序で反映される。
- API障害後にローカルWorkerへ切り替わり、ページ変換が継続する。
- カスタムbundle、Popup辞書、デバッグ対象ではAPIへ送信されない。
- 既存のruby DOM処理、MutationObserver、設定反映、Undo/Redoに影響しない。

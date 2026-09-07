# 変更履歴

## 2026-09-07

- 標準bundleの変換を `kinotch-api` の Text Transform API batch endpointへ移行。
- API応答が失敗した場合は、既存のローカル変換Workerへ自動fallback。
- ユーザーが編集したbundle、Popup辞書、デバッグ対象では外部APIへ送信せず、従来のローカルWorkerを使用。
- API client、manifest権限、移行仕様・運用文書を追加。

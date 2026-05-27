# grouped dictionary-rules 追補

## 概要

`dictionary-rules` は、従来の `phrase_rules` / `character_map` 直下定義に加えて、`groups` 配列でも管理できる。

## 形式

```js
{
  id: "homophone-kanji",
  label: "同音漢字置換",
  kind: "dictionary-rules",
  groups: [
    {
      id: "kata",
      label: "カタカナ",
      phrase_rules: {
        "ドイツ": ["独逸,独乙", 90, true],
      },
      character_map_priority: 10,
      character_map: {},
    },
  ],
}
```

## 互換

- `groups` が無い場合は、既存の `phrase_rules` / `character_map` を `default` グループとして扱う
- 設定画面の保存形式は `groups` を優先する
- コンテンツスクリプトは `groups` をフラット化して同一バンドル順のまま適用する

## 診断

設定画面の診断タブでは次を表示する。

- 同じ変換前が複数箇所にあるケース
- 同一バンドル内でグループ名が重複しているケース

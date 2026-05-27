# 変換ツリースキーマ v2

## 概要

保存形式は `schema_version: 2` を持つツリー構造とする。  
拡張機能全体を `roots -> children -> entries` の入れ子で扱い、旧字・同音熟語・一般置換は固定カテゴリではなくコンテナとして表す。

## 形式

```js
{
  schema_version: 2,
  roots: [
    {
      id: "homophone-kanji",
      label: "同音漢字置換",
      kind: "container",
      enabled: true,
      order: 50,
      children: [
        {
          id: "kata",
          label: "カタカナ",
          kind: "container",
          enabled: true,
          order: 10,
          character_map_priority: 10,
          entries: [
            {
              id: "phrase-1",
              type: "phrase-rule",
              from: "ドイツ",
              to: "独逸,独乙",
              priority: 90,
              enabled: true,
            },
            {
              id: "char-1",
              type: "character-map",
              from: "A",
              to: "Ａ",
              enabled: true,
            },
          ],
        },
      ],
    },
  ],
}
```

## 意図

- `roots`
  - 変換の大箱。実行順を `order` で持つ
- `children`
  - 箱の中のグループ。記号・カタカナ・英字・弁系熟語などを束ねる
- `entries`
  - 実際の変換項目。将来の属性追加はここに寄せる

## entry type

- `phrase-rule`
  - `from`
  - `to`
  - `priority`
  - `enabled`
- `character-map`
  - `from`
  - `to`
  - `enabled`

`character-map` の優先度は項目ごとではなく、親ノードの `character_map_priority` でまとめて扱う。

## 後方互換

- 旧 `bundles` 形式
- 旧 `groups` 形式
- 旧 `phrase_rules` / `character_map` 直下形式

これらは読込時に v2 ツリーへ正規化する。保存時は常に v2 形式で出力する。

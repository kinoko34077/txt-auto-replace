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
## v3 補足

- 現行保存形式は `schema_version: 3` だが、tree の基本構造は `roots -> children -> entries` のまま維持する。
- `node.kind` は保存上の主種別であり、各 entry の最終的な runtime 到達先そのものではない。
- entry ごとの runtime 到達先は次の判定で決まる。
  - `sequence`
  - `conditions.prev/current/next`
  - `match_target`
  - `type=verb|adjective|literal|compound|renyou`
- 上記を持つ rule は runtime で `token-rules` 側へ受け流れる。
- `regex` rule は node kind が `token-rules` でも dictionary 側に残りうる。
- bulk import では `;タイトル` 行を置くと、その後の行を選択 node 直下の同名子箱へ投入する。同名子箱があれば再利用する。

## Structured dictionary extension (format version 1)

`schema_version: 3` and its executable `roots -> children -> entries` tree remain
the runtime-compatible representation. A payload may additionally contain an
independent `structured_dictionary` object for management tools and richer word
relations. Its absence is valid: the extension derives an initial dictionary from
the executable tree without modifying that tree.

```js
{
  structured_dictionary: {
    format_version: 1,
    words: [{ id: "word-ashita", value: "あした", metadata: {} }],
    relations: [{
      id: "relation-tomorrow",
      sources: ["word-ashita"],
      targets: [{ word_id: "word-asu", default: true, conditions: null }],
      mappings: [],
      type: "replacement", // replacement | candidate | derivation | related | alias
      mode: "automatic", // automatic | default | conditional | manual | unresolved
      enabled: true,
      priority: 0,
      conditions: null,
      metadata: {},
      execution_binding: null
    }],
    metadata: {}
  }
}
```

- Words keep an immutable identifier separate from their visible text.
- A relation may have multiple sources and targets. `mappings` records explicit
  source-to-target pairs and avoids implicitly expanding an unresolved many-to-many
  relation into every combination.
- A target marked `default: true` is the only target that can be compiled from a
  one-to-many relation with `mode: "default"`.
- `derivation`, `related`, `alias`, `manual`, and `unresolved` relations are kept
  for management/export only and are never compiled to executable rules.
- `execution_binding` preserves the node placement, legacy entry IDs, and the
  original runtime attributes such as regex, token conditions, sequence,
  match options, priority, and enabled state. It is the compatibility boundary for
  fields that cannot be expressed directly by a word graph.

### Adapter and round trip rules

- Importing an old tree creates one relation per legacy rule. Rules are merged into
  a multi-source relation only when they share node placement, output, and every
  execution attribute. `from_options` becomes multiple relation sources.
- A legacy rule with multiple candidate outputs is retained as an unresolved
  `candidate` relation with its execution binding. The existing tree remains the
  runtime source, so candidate behavior is not simplified or changed.
- The adapter compiles only enabled `replacement` relations that are automatic
  one-to-one/many-to-one, explicit mappings, or a relation with one default target.
  It never compiles non-replacement relations or unresolved relations.
- If a compiled source conflicts with an existing tree rule at the same target node,
  the adapter excludes that generated rule and reports a diagnostic. Existing rules
  always win; structured data does not overwrite the runtime tree.
- Normal tree editing updates only compatible legacy execution bindings. Divergent
  or missing bound entries leave the relation intact and produce a synchronization
  diagnostic instead of deleting management data.

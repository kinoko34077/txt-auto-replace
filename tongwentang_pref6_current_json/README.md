# tongwentang_pref6_current_json

旧版 `tongwentang_pref6_categorized/` を、現行版の責務単位に寄せて再編した JSON 群。

## 再編方針

- 旧版カテゴリをそのまま維持せず、現行 bundle (`surface-normalization` / `lexical-replacements` / `okurigana-abbreviation` / `official-homophone-restoration` / `homophone-kanji` / `general-character-replacements`) 単位へ寄せた。
- そのまま投入しやすい低リスク項目は `active-candidate`、文脈依存やネタ置換を含む群は `review-needed` として分離した。
- `legacy-kanji` は『ユーザー指定旧字表だけを入れる』現行方針と衝突するため、旧版由来の独立集合は作らず空集合にした。
- 比較対象 `transform-settings (1).json` の roots ツリーに完全一致する `from -> to` は再編先から外し、`存在したもの.json` へ逃がした。

## 出力ファイル

- `10-surface-normalization.json`: 表層正規化 (38 entries)
- `20-lexical-replacements.json`: 語彙置換 (910 entries)
- `30-okurigana-abbreviation.json`: 送り仮名省略 (369 entries)
- `40-legacy-kanji.json`: 旧字変換 (0 entries)
- `50-official-homophone-restoration.json`: 告示・同音書換復元 (2 entries)
- `55-homophone-kanji.json`: 同音漢字置換 (203 entries)
- `60-general-character-replacements.json`: 一般単漢字置換 (49 entries)
- `90-review-needed.json`: 要レビュー保留 (183 entries)
- `存在したもの.json`: 存在したもの (1684 entries)

## 注意

- これは『旧版の意図を現行版の責務へ寄せ直した再編結果』であり、既存 `transforms/*.json5` へ自動投入する前提ではない。
- `pattern_seeds` は、固定句の列挙から抽出した一般化候補であり、runtime 規則化時に品詞条件や後続語条件を別途付与する前提。
- 件数集計と配分は `_META.json` を参照。


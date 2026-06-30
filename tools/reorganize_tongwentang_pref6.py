from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "tongwentang_pref6_categorized"
OUTPUT_DIR = ROOT / "tongwentang_pref6_current_json"
COMPARISON_SETTINGS_PATH = Path(r"C:\Users\kinok\Downloads\transform-settings (1).json")


SOURCE_FILES = {
    "01_punctuation_symbols": "01_punctuation_symbols.json",
    "02_numbers_units": "02_numbers_units.json",
    "03_kanji_single_variants": "03_kanji_single_variants.json",
    "04_kana_idioms_to_ateji": "04_kana_idioms_to_ateji.json",
    "05_okurigana_shortening": "05_okurigana_shortening.json",
    "06_ben_disambiguation": "06_ben_disambiguation.json",
    "07_homophone_restoration_phrases": "07_homophone_restoration_phrases.json",
    "08_kanji_phrase_variants": "08_kanji_phrase_variants.json",
    "09_general_phrases_misc": "09_general_phrases_misc.json",
    "99_unclassified": "99_unclassified.json",
}


SAFE_NUMERIC_LEXICAL = {
    "2分の1",
    "4分の1",
    "4分の3",
    "8分の1",
    "8分の3",
    "8分の5",
    "8分の7",
    "ひとしずく",
    "ひとり",
    "ひとりじめ",
    "ふたり",
    "一つ",
    "パーセント",
}


FULLWIDTH_DIGITS = {str(index): str(index) for index in range(10)}
FULLWIDTH_DIGIT_SOURCES = {chr(ord("０") + index) for index in range(10)}


KATAKANA_TO_HIRAGANA = str.maketrans({
    chr(code): chr(code - 0x60) for code in range(ord("ァ"), ord("ヶ") + 1)
})


def load_source() -> dict[str, dict[str, str]]:
    loaded: dict[str, dict[str, str]] = {}
    for source_id, file_name in SOURCE_FILES.items():
        loaded[source_id] = json.loads((SOURCE_DIR / file_name).read_text(encoding="utf-8"))
    return loaded


def load_existing_replacements() -> dict[tuple[str, str], list[dict[str, str | None]]]:
    mapped: dict[tuple[str, str], list[dict[str, str | None]]] = defaultdict(list)
    settings = json.loads(COMPARISON_SETTINGS_PATH.read_text(encoding="utf-8"))

    def append_entry(node: dict, source_key: str, payload: dict) -> None:
        from_text = payload.get("from")
        to_text = payload.get("to")
        if not from_text or not to_text:
            return
        mapped[(from_text, to_text)].append({
            "file": str(COMPARISON_SETTINGS_PATH),
            "bundle": node.get("root_id"),
            "group": node.get("id"),
            "label": node.get("label"),
            "source_key": source_key,
        })

    def walk(node: dict, root_id: str | None) -> None:
        current_root_id = root_id or node.get("id")
        current_node = dict(node)
        current_node["root_id"] = current_root_id

        for rule in current_node.get("rules", []) or []:
            append_entry(current_node, "rules", rule)
        for entry in current_node.get("entries", []) or []:
            append_entry(current_node, "entries", entry)
        for phrase_rule in current_node.get("phrase_rules", []) or []:
            append_entry(current_node, "phrase_rules", phrase_rule)
        for from_text, to_text in (current_node.get("character_map", {}) or {}).items():
            append_entry(current_node, "character_map", {"from": from_text, "to": to_text})

        for child in current_node.get("children", []) or []:
            walk(child, current_root_id)

    for root in settings.get("roots", []):
        walk(root, root.get("id"))

    return dict(mapped)


def to_hiragana(char: str) -> str:
    return char.translate(KATAKANA_TO_HIRAGANA)


def kana_row_id(text: str) -> str:
    if not text:
        return "other"

    first = to_hiragana(text[0])
    row_map = {
        "a": "あいうえおぁぃぅぇぉ",
        "ka": "かきくけこがぎぐげご",
        "sa": "さしすせそざじずぜぞ",
        "ta": "たちつてとだぢづでどっ",
        "na": "なにぬねの",
        "ha": "はひふへほばびぶべぼぱぴぷぺぽ",
        "ma": "まみむめも",
        "ya": "やゆよゃゅょ",
        "ra": "らりるれろ",
        "wa": "わをんゐゑ",
    }
    for row_id, members in row_map.items():
        if first in members:
            return row_id
    return "other"


def contains_latin(text: str) -> bool:
    return any(("A" <= char <= "Z") or ("a" <= char <= "z") for char in text)


def contains_katakana(text: str) -> bool:
    return any("ァ" <= char <= "ヶ" for char in text)


def is_single_fullwidth_digit_pair(source: str, target: str) -> bool:
    return len(source) == 1 and len(target) == 1 and source in FULLWIDTH_DIGIT_SOURCES and target in FULLWIDTH_DIGITS


def make_entry(source: str, target: str, source_category: str) -> dict[str, str]:
    return {
        "from": source,
        "to": target,
        "source_category": source_category,
    }


def write_json(file_name: str, payload: dict) -> None:
    output_path = OUTPUT_DIR / file_name
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def count_entries(groups: Iterable[dict]) -> int:
    return sum(len(group["entries"]) for group in groups)


def extract_existing_entries(
    files: dict[str, dict],
    existing_replacements: dict[tuple[str, str], list[dict[str, str | None]]],
) -> dict:
    existing_groups = []

    for file_name, payload in files.items():
        retained_groups = []
        extracted_entries = []

        for group in payload["groups"]:
            retained_entries = []
            for entry in group["entries"]:
                match_key = (entry["from"], entry["to"])
                if match_key in existing_replacements:
                    extracted_entry = dict(entry)
                    extracted_entry["reorganized_file"] = file_name
                    extracted_entry["reorganized_group"] = group["id"]
                    extracted_entry["existing_locations"] = existing_replacements[match_key]
                    extracted_entries.append(extracted_entry)
                else:
                    retained_entries.append(entry)

            updated_group = dict(group)
            updated_group["entries"] = retained_entries
            retained_groups.append(updated_group)

        payload["groups"] = retained_groups

        if extracted_entries:
            existing_groups.append({
                "id": payload["id"],
                "label": f"{payload['label']} に既存だったもの",
                "status": "already-present",
                "application_path": payload["target_bundle"],
                "entries": extracted_entries,
            })

    return {
        "id": "already-present",
        "label": "存在したもの",
        "target_bundle": "existing-settings",
        "kind": "reorganized-stage",
        "intent": "比較対象の transform-settings (1).json に既に同一の from -> to が存在していた項目を、再編結果から分離して記録する。",
        "groups": existing_groups,
    }


def build_surface_normalization(source: dict[str, dict[str, str]]) -> dict:
    punctuation_entries = [
        make_entry(key, value, "01_punctuation_symbols")
        for key, value in source["01_punctuation_symbols"].items()
    ]
    fullwidth_latin_entries = [
        make_entry(key, value, "99_unclassified")
        for key, value in source["99_unclassified"].items()
    ]
    fullwidth_digit_entries = [
        make_entry(key, value, "02_numbers_units")
        for key, value in source["02_numbers_units"].items()
        if is_single_fullwidth_digit_pair(key, value)
    ]

    carryover_entries = []
    if " ・ " in source["09_general_phrases_misc"]:
        carryover_entries.append(make_entry(" ・ ", source["09_general_phrases_misc"][" ・ "], "09_general_phrases_misc"))

    groups = [
        {
            "id": "punctuation-symbols",
            "label": "句読点と記号",
            "status": "active-candidate",
            "application_path": "surface-normalization.rules",
            "source_categories": ["01_punctuation_symbols"],
            "entries": punctuation_entries,
        },
        {
            "id": "fullwidth-latin",
            "label": "全角英字の半角化",
            "status": "active-candidate",
            "application_path": "surface-normalization.rules",
            "source_categories": ["99_unclassified"],
            "entries": fullwidth_latin_entries,
        },
        {
            "id": "fullwidth-digits",
            "label": "全角数字の半角化",
            "status": "active-candidate",
            "application_path": "surface-normalization.rules",
            "source_categories": ["02_numbers_units"],
            "entries": fullwidth_digit_entries,
        },
        {
            "id": "surface-carryovers",
            "label": "表層正規化へ寄せられる句読点句",
            "status": "active-candidate",
            "application_path": "surface-normalization.rules",
            "source_categories": ["09_general_phrases_misc"],
            "entries": carryover_entries,
        },
    ]

    return {
        "id": "surface-normalization",
        "label": "表層正規化",
        "target_bundle": "surface-normalization",
        "kind": "reorganized-stage",
        "intent": "句読点・記号・全角ラテン文字のような低リスク正規化を Stage1 へ集約する。",
        "groups": groups,
    }


def build_lexical_replacements(source: dict[str, dict[str, str]]) -> dict:
    numeric_safe_entries = [
        make_entry(key, value, "02_numbers_units")
        for key, value in source["02_numbers_units"].items()
        if key in SAFE_NUMERIC_LEXICAL
    ]

    kana_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for key, value in source["04_kana_idioms_to_ateji"].items():
        kana_groups[kana_row_id(key)].append(make_entry(key, value, "04_kana_idioms_to_ateji"))

    row_labels = {
        "a": "あ行",
        "ka": "か行",
        "sa": "さ行",
        "ta": "た行",
        "na": "な行",
        "ha": "は行",
        "ma": "ま行",
        "ya": "や行",
        "ra": "ら行",
        "wa": "わ行",
        "other": "その他",
    }

    groups = [
        {
            "id": "numeric-symbols-and-counting",
            "label": "数詞・分数・単位の圧縮",
            "status": "active-candidate",
            "application_path": "lexical-replacements.phrase_rules",
            "source_categories": ["02_numbers_units"],
            "entries": numeric_safe_entries,
        }
    ]

    for row_id in ["a", "ka", "sa", "ta", "na", "ha", "ma", "ya", "ra", "wa", "other"]:
        entries = kana_groups.get(row_id, [])
        if not entries:
            continue
        groups.append({
            "id": f"kana-idioms-{row_id}",
            "label": f"かな熟語から当て字 {row_labels[row_id]}",
            "status": "review-needed",
            "application_path": "lexical-replacements.phrase_rules",
            "source_categories": ["04_kana_idioms_to_ateji"],
            "entries": entries,
        })

    carryover_entries = []
    if "こと" in source["09_general_phrases_misc"]:
        carryover_entries.append(make_entry("こと", source["09_general_phrases_misc"]["こと"], "09_general_phrases_misc"))
    if carryover_entries:
        groups.append({
            "id": "legacy-carryovers",
            "label": "現行 lexical に近い既知の句",
            "status": "active-candidate",
            "application_path": "lexical-replacements.phrase_rules",
            "source_categories": ["09_general_phrases_misc"],
            "entries": carryover_entries,
        })

    return {
        "id": "lexical-replacements",
        "label": "語彙置換",
        "target_bundle": "lexical-replacements",
        "kind": "reorganized-stage",
        "intent": "かな熟語や数詞圧縮のような固定句を Stage2 の語彙辞書へ寄せる。",
        "groups": groups,
    }


def build_okurigana_abbreviation(source: dict[str, dict[str, str]]) -> dict:
    honorific_o_entries = []
    honorific_go_entries = []
    mixed_entries = []

    for key, value in source["05_okurigana_shortening"].items():
        if key.startswith("お") and value.startswith("御"):
            honorific_o_entries.append(make_entry(key, value, "05_okurigana_shortening"))
        elif key.startswith("ご") and value.startswith("御"):
            honorific_go_entries.append(make_entry(key, value, "05_okurigana_shortening"))
        else:
            mixed_entries.append(make_entry(key, value, "05_okurigana_shortening"))

    groups = [
        {
            "id": "honorific-o-prefix",
            "label": "お + 名詞 系の御化",
            "status": "active-candidate",
            "application_path": "okurigana-abbreviation.pattern_seeds",
            "source_categories": ["05_okurigana_shortening"],
            "pattern_seed": {
                "source_prefix": "お",
                "target_prefix": "御",
                "note": "固定熟語の列挙から抽出した seed。将来的には後続語種条件つき規則へ一般化する。",
            },
            "entries": honorific_o_entries,
        },
        {
            "id": "honorific-go-prefix",
            "label": "ご + 名詞 系の御化",
            "status": "active-candidate",
            "application_path": "okurigana-abbreviation.pattern_seeds",
            "source_categories": ["05_okurigana_shortening"],
            "pattern_seed": {
                "source_prefix": "ご",
                "target_prefix": "御",
                "note": "固定熟語の列挙から抽出した seed。将来的には漢語接続条件つき規則へ一般化する。",
            },
            "entries": honorific_go_entries,
        },
        {
            "id": "mixed-legacy-shortening",
            "label": "旧版の混在短縮句",
            "status": "review-needed",
            "application_path": "okurigana-abbreviation.phrase_candidates",
            "source_categories": ["05_okurigana_shortening"],
            "entries": mixed_entries,
        },
    ]

    return {
        "id": "okurigana-abbreviation",
        "label": "送り仮名省略",
        "target_bundle": "okurigana-abbreviation",
        "kind": "reorganized-stage",
        "intent": "送り仮名省略の候補から、一般化しやすい敬語接頭辞パターンを seed 化し、残余は Stage4 候補として隔離する。",
        "groups": groups,
    }


def build_legacy_kanji() -> dict:
    return {
        "id": "legacy-kanji",
        "label": "旧字変換",
        "target_bundle": "legacy-kanji",
        "kind": "reorganized-stage",
        "intent": "旧版辞書群からは、現行 Stage5 の『ユーザー指定旧字表』に直接寄せるべき独立集合を確定できなかったため空集合とする。",
        "groups": [],
    }


def classify_kanji_phrase_variant(source_text: str, target_text: str) -> str:
    if source_text == target_text:
        return "noop"
    if contains_latin(source_text) or contains_katakana(source_text) or any(char in source_text for char in "()・"):
        return "mixed-script"
    if len(target_text) < len(source_text):
        return "compressed"
    return "kanji-variant"


def build_official_homophone(source: dict[str, dict[str, str]]) -> dict:
    entries = [
        make_entry(key, value, "07_homophone_restoration_phrases")
        for key, value in source["07_homophone_restoration_phrases"].items()
    ]
    return {
        "id": "official-homophone-restoration",
        "label": "告示・同音書換復元",
        "target_bundle": "official-homophone-restoration",
        "kind": "reorganized-stage",
        "intent": "告示系の固定熟語復元を Stage5.5 相当の公式系辞書へ寄せる。",
        "groups": [
            {
                "id": "official-restoration-phrases",
                "label": "告示系の固定熟語",
                "status": "active-candidate",
                "application_path": "official-homophone-restoration.phrase_rules",
                "source_categories": ["07_homophone_restoration_phrases"],
                "entries": entries,
            }
        ],
    }


def build_homophone_kanji(source: dict[str, dict[str, str]]) -> tuple[dict, list[dict[str, str]]]:
    ben_entries = []
    ben_review_entries = []
    for key, value in source["06_ben_disambiguation"].items():
        entry = make_entry(key, value, "06_ben_disambiguation")
        if key == "弁":
            ben_review_entries.append(entry)
        else:
            ben_entries.append(entry)

    phrase_groups = {
        "kanji-variant": [],
        "compressed": [],
        "mixed-script": [],
    }
    noop_entries = []
    for key, value in source["08_kanji_phrase_variants"].items():
        entry = make_entry(key, value, "08_kanji_phrase_variants")
        variant_class = classify_kanji_phrase_variant(key, value)
        if variant_class == "noop":
            noop_entries.append(entry)
        else:
            phrase_groups[variant_class].append(entry)

    bundle = {
        "id": "homophone-kanji",
        "label": "同音漢字置換",
        "target_bundle": "homophone-kanji",
        "kind": "reorganized-stage",
        "intent": "弁系の語義分岐と、旧版の漢字熟語バリアントを固定熟語辞書として Stage55 へ寄せる。",
        "groups": [
            {
                "id": "ben-disambiguation",
                "label": "弁系の語義分岐",
                "status": "active-candidate",
                "application_path": "homophone-kanji.phrase_rules",
                "source_categories": ["06_ben_disambiguation"],
                "entries": ben_entries,
            },
            {
                "id": "kanji-phrase-variants",
                "label": "漢字熟語の表記差",
                "status": "review-needed",
                "application_path": "homophone-kanji.phrase_rules",
                "source_categories": ["08_kanji_phrase_variants"],
                "entries": phrase_groups["kanji-variant"],
            },
            {
                "id": "compressed-kanji-phrases",
                "label": "字数圧縮を伴う熟語",
                "status": "review-needed",
                "application_path": "homophone-kanji.phrase_rules",
                "source_categories": ["08_kanji_phrase_variants"],
                "entries": phrase_groups["compressed"],
            },
            {
                "id": "mixed-script-variants",
                "label": "カタカナ混在や記号起点の熟語",
                "status": "review-needed",
                "application_path": "homophone-kanji.phrase_rules",
                "source_categories": ["08_kanji_phrase_variants"],
                "entries": phrase_groups["mixed-script"],
            },
        ],
    }

    review_entries = ben_review_entries + noop_entries
    return bundle, review_entries


def build_general_character_replacements(source: dict[str, dict[str, str]]) -> tuple[dict, list[dict[str, str]]]:
    entries = []
    review_entries = []
    for key, value in source["03_kanji_single_variants"].items():
        entry = make_entry(key, value, "03_kanji_single_variants")
        if key == value:
            review_entries.append(entry)
        else:
            entries.append(entry)

    bundle = {
        "id": "general-character-replacements",
        "label": "一般単漢字置換",
        "target_bundle": "general-character-replacements",
        "kind": "reorganized-stage",
        "intent": "単漢字の異体字・旧字候補を、legacy-kanji ではなく一般単漢字辞書へ集約する。",
        "groups": [
            {
                "id": "single-kanji-variants",
                "label": "単漢字の異体字",
                "status": "active-candidate",
                "application_path": "general-character-replacements.character_map",
                "source_categories": ["03_kanji_single_variants"],
                "entries": entries,
            }
        ],
    }
    return bundle, review_entries


def classify_general_misc_entry(source_text: str, target_text: str) -> str:
    if contains_latin(source_text):
        return "latin-and-brand-shorthand"
    if target_text == "":
        return "deletions"
    if any(char in source_text for char in "・() "):
        return "symbol-and-layout-shortcuts"
    if len(source_text) <= 4 and len(target_text) <= 2:
        return "ultra-short-compactions"
    return "substring-and-morphology-shortcuts"


def build_review_needed(
    source: dict[str, dict[str, str]],
    homophone_review_entries: list[dict[str, str]],
    general_review_entries: list[dict[str, str]],
) -> dict:
    aggressive_numeric_entries = [
        make_entry(key, value, "02_numbers_units")
        for key, value in source["02_numbers_units"].items()
        if not is_single_fullwidth_digit_pair(key, value) and key not in SAFE_NUMERIC_LEXICAL
    ]

    misc_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for key, value in source["09_general_phrases_misc"].items():
        if key in {" ・ ", "こと"}:
            continue
        misc_groups[classify_general_misc_entry(key, value)].append(
            make_entry(key, value, "09_general_phrases_misc")
        )

    groups = [
        {
            "id": "aggressive-numeric-compactions",
            "label": "強い数字圧縮",
            "status": "review-needed",
            "application_path": "manual-review",
            "source_categories": ["02_numbers_units"],
            "entries": aggressive_numeric_entries,
        },
        {
            "id": "single-character-noops",
            "label": "自己写像や no-op",
            "status": "review-needed",
            "application_path": "manual-review",
            "source_categories": ["03_kanji_single_variants", "06_ben_disambiguation", "08_kanji_phrase_variants"],
            "entries": general_review_entries + homophone_review_entries,
        },
    ]

    review_labels = {
        "latin-and-brand-shorthand": "ラテン文字・製品名の略称化",
        "deletions": "削除系",
        "symbol-and-layout-shortcuts": "記号・レイアウト系短縮",
        "ultra-short-compactions": "超短縮語",
        "substring-and-morphology-shortcuts": "部分一致と語尾省略系",
    }

    for group_id in [
        "latin-and-brand-shorthand",
        "deletions",
        "symbol-and-layout-shortcuts",
        "ultra-short-compactions",
        "substring-and-morphology-shortcuts",
    ]:
        entries = misc_groups.get(group_id, [])
        if not entries:
            continue
        groups.append({
            "id": group_id,
            "label": review_labels[group_id],
            "status": "review-needed",
            "application_path": "manual-review",
            "source_categories": ["09_general_phrases_misc"],
            "entries": entries,
        })

    return {
        "id": "review-needed",
        "label": "要レビュー保留",
        "target_bundle": "manual-review",
        "kind": "reorganized-stage",
        "intent": "現行版へ直接投入すると誤爆しやすい強圧縮・略称・部分一致ルールを隔離する。",
        "groups": groups,
    }


def build_meta(files: dict[str, dict], source: dict[str, dict[str, str]]) -> dict:
    source_totals = {source_id: len(entries) for source_id, entries in source.items()}
    output_totals = {
        file_name: count_entries(payload["groups"])
        for file_name, payload in files.items()
    }

    source_allocation: Counter[str] = Counter()
    for payload in files.values():
        for group in payload["groups"]:
            for entry in group["entries"]:
                source_allocation[entry["source_category"]] += 1

    unallocated = {
        source_id: source_totals[source_id] - source_allocation.get(source_id, 0)
        for source_id in source_totals
    }

    return {
        "source_directory": SOURCE_DIR.name,
        "output_directory": OUTPUT_DIR.name,
        "generated_on": str(date.today()),
        "total_source_entries": sum(source_totals.values()),
        "total_output_entries": sum(output_totals.values()),
        "source_totals": source_totals,
        "output_totals": output_totals,
        "source_allocation": dict(source_allocation),
        "unallocated": unallocated,
        "notes": [
            "03_kanji_single_variants は 358 件を general-character-replacements へ集約し、自己写像 3 件を review-needed へ送った。",
            "05_okurigana_shortening は honorific の seed と、残余の混在短縮句へ二分した。",
            "09_general_phrases_misc は surface-normalization へ 1 件、lexical-replacements へ 1 件を寄せ、残余を review-needed に隔離した。",
            "比較対象は transform-settings (1).json とし、その roots ツリーに存在する同一置換は各再編ファイルから除外して存在したもの.json へ移した。",
        ],
    }


def build_readme(files: dict[str, dict]) -> str:
    lines = [
        "# tongwentang_pref6_current_json",
        "",
        "旧版 `tongwentang_pref6_categorized/` を、現行版の責務単位に寄せて再編した JSON 群。",
        "",
        "## 再編方針",
        "",
        "- 旧版カテゴリをそのまま維持せず、現行 bundle (`surface-normalization` / `lexical-replacements` / `okurigana-abbreviation` / `official-homophone-restoration` / `homophone-kanji` / `general-character-replacements`) 単位へ寄せた。",
        "- そのまま投入しやすい低リスク項目は `active-candidate`、文脈依存やネタ置換を含む群は `review-needed` として分離した。",
        "- `legacy-kanji` は『ユーザー指定旧字表だけを入れる』現行方針と衝突するため、旧版由来の独立集合は作らず空集合にした。",
        "- 比較対象 `transform-settings (1).json` の roots ツリーに完全一致する `from -> to` は再編先から外し、`存在したもの.json` へ逃がした。",
        "",
        "## 出力ファイル",
        "",
    ]

    ordered_files = [
        "10-surface-normalization.json",
        "20-lexical-replacements.json",
        "30-okurigana-abbreviation.json",
        "40-legacy-kanji.json",
        "50-official-homophone-restoration.json",
        "55-homophone-kanji.json",
        "60-general-character-replacements.json",
        "90-review-needed.json",
        "存在したもの.json",
    ]

    for file_name in ordered_files:
        payload = files[file_name]
        lines.append(f"- `{file_name}`: {payload['label']} ({count_entries(payload['groups'])} entries)")

    lines.extend([
        "",
        "## 注意",
        "",
        "- これは『旧版の意図を現行版の責務へ寄せ直した再編結果』であり、既存 `transforms/*.json5` へ自動投入する前提ではない。",
        "- `pattern_seeds` は、固定句の列挙から抽出した一般化候補であり、runtime 規則化時に品詞条件や後続語条件を別途付与する前提。",
        "- 件数集計と配分は `_META.json` を参照。",
        "",
    ])
    return "\n".join(lines) + "\n"


def main() -> None:
    source = load_source()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    surface = build_surface_normalization(source)
    lexical = build_lexical_replacements(source)
    okurigana = build_okurigana_abbreviation(source)
    legacy = build_legacy_kanji()
    official = build_official_homophone(source)
    homophone, homophone_review_entries = build_homophone_kanji(source)
    general, general_review_entries = build_general_character_replacements(source)
    review = build_review_needed(source, homophone_review_entries, general_review_entries)

    files = {
        "10-surface-normalization.json": surface,
        "20-lexical-replacements.json": lexical,
        "30-okurigana-abbreviation.json": okurigana,
        "40-legacy-kanji.json": legacy,
        "50-official-homophone-restoration.json": official,
        "55-homophone-kanji.json": homophone,
        "60-general-character-replacements.json": general,
        "90-review-needed.json": review,
    }

    existing_replacements = load_existing_replacements()
    already_present = extract_existing_entries(files, existing_replacements)
    files["存在したもの.json"] = already_present

    for file_name, payload in files.items():
        write_json(file_name, payload)

    meta = build_meta(files, source)
    write_json("_META.json", meta)
    (OUTPUT_DIR / "README.md").write_text(build_readme(files), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()

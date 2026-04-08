#!/usr/bin/env python3
"""
Parses NCLEX_Drug_List_Prof_Linda.md into a TypeScript data file.
Output: frontend/src/data/nclex-drugs.ts
"""

import re
from pathlib import Path
from collections import OrderedDict

INPUT = Path(__file__).resolve().parent.parent / "docs" / "NCLEX_Drug_List_Prof_Linda.md"
OUTPUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "nclex-drugs.ts"

SKIP_NAMES = {'Drug', 'Supplement', 'IV Fluid', 'Category', '---'}
SKIP_FOCUS = {'Key NCLEX Focus', 'Key NCLEX Interaction Concern', 'Drug Count', '---'}


def parse_markdown(text: str) -> OrderedDict:
    drugs: OrderedDict[str, dict] = OrderedDict()
    current_category = ""
    current_subcategory = ""

    for line in text.split("\n"):
        line = line.strip()

        cat = re.match(r'^##\s+\d+\.\s+(.+?)(?:\s*\(\d+\s*drugs?\))?$', line)
        if cat:
            current_category = cat.group(1).strip()
            current_subcategory = ""
            continue

        sub = re.match(r'^###\s+(.+)$', line)
        if sub:
            current_subcategory = sub.group(1).strip()
            continue

        row = re.match(r'^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$', line)
        if not row:
            continue

        name = row.group(1).strip()
        focus = row.group(2).strip()

        # Skip headers, separators, summary rows
        if name in SKIP_NAMES or name.startswith('--'):
            continue
        if focus in SKIP_FOCUS or focus.startswith('--'):
            continue
        if '**' in name:
            continue
        if re.match(r'^[\d~*]+$', focus.replace(' ', '')):
            continue

        key = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
        if not key:
            continue
        # JS identifiers can't start with a digit
        if key[0].isdigit():
            key = 'drug_' + key

        # Deduplicate: merge focus from later sections
        if key in drugs:
            if focus not in drugs[key]["nclex_focus"]:
                drugs[key]["nclex_focus"] += "; " + focus
            continue

        drugs[key] = {
            "name": name,
            "category": current_category,
            "subcategory": current_subcategory,
            "nclex_focus": focus,
        }

    return drugs


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def generate_ts(drugs: OrderedDict) -> str:
    count = len(drugs)
    lines = [
        "/**",
        " * NCLEX-RN High-Yield Drug List",
        " * Curated by Prof. Linda T., MSN, RN, CNE",
        f" * {count} drugs across multiple categories",
        " * Auto-generated from docs/NCLEX_Drug_List_Prof_Linda.md",
        " */",
        "",
        "export interface NCLEXDrug {",
        "  name: string",
        "  category: string",
        "  subcategory: string",
        "  nclex_focus: string",
        "}",
        "",
        f"export const nclexDrugsStatic: Record<string, Record<string, unknown>> = {{",
        f"  _meta: {{ name: 'NCLEX High-Yield Drug List (Prof. Linda)', version: 2, count: {count} }},",
    ]

    for key, d in drugs.items():
        lines.append(f"  {key}: {{")
        lines.append(f"    name: '{esc(d['name'])}',")
        lines.append(f"    category: '{esc(d['category'])}',")
        lines.append(f"    subcategory: '{esc(d['subcategory'])}',")
        lines.append(f"    nclex_focus: '{esc(d['nclex_focus'])}',")
        lines.append(f"  }},")

    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def main():
    text = INPUT.read_text(encoding="utf-8")
    drugs = parse_markdown(text)
    ts = generate_ts(drugs)
    OUTPUT.write_text(ts, encoding="utf-8")
    print(f"Parsed {len(drugs)} drugs -> {OUTPUT}")

    cats: dict[str, int] = {}
    for d in drugs.values():
        cats[d['category']] = cats.get(d['category'], 0) + 1
    for cat, c in cats.items():
        print(f"  {cat}: {c}")


if __name__ == "__main__":
    main()

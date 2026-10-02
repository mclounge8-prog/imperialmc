#!/usr/bin/env python3
"""ABC price scale: A ~5%, B ~8%, C ~10%, rounded. Full was→became catalog."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from build import (
    GUEST_SKIP_CATS,
    LOAD,
    catalog,
    lifted,
    load_items,
    md_money,
    nice_round,
)

ROOT = Path(__file__).resolve().parent
A_CUT = 0.70
B_CUT = 0.90
LIFT = {"A": 5, "B": 8, "C": 10}


def assign_abc(items: list[dict]) -> list[dict]:
    guest = [i for i in items if i["guest"]]
    guest.sort(key=lambda x: (-x["revenue"], x["cat"], x["name"]))
    total = sum(i["revenue"] for i in guest) or 1
    cum = 0.0
    band_of: dict[tuple[str, str], str] = {}
    for it in guest:
        prev = cum
        cum += it["revenue"]
        if prev < total * A_CUT:
            band = "A"
        elif prev < total * B_CUT:
            band = "B"
        else:
            band = "C"
        band_of[(it["cat"], it["name"])] = band
    out = []
    for it in items:
        key = (it["cat"], it["name"])
        if not it["guest"]:
            band = "—"
            pct = 0
        else:
            band = band_of[key]
            pct = LIFT[band]
        new = it["current"] if pct == 0 else lifted(it["current"], pct)
        actual = (new / it["current"] - 1) * 100 if it["current"] else 0
        extra_unit = new - it["current"]
        extra_rev = extra_unit * it["qty"]
        out.append(
            {
                **it,
                "venues": ", ".join(it["venues"]) if isinstance(it["venues"], list) else it["venues"],
                "abc": band,
                "pct_target": pct,
                "new": new,
                "actual_pct": round(actual, 2),
                "extra_unit": extra_unit,
                "extra_rev": extra_rev,
                "net_after_load": extra_rev * (1 - LOAD),
            }
        )
    out.sort(key=lambda x: (x["abc"] == "—", x["abc"], -x["revenue"], x["cat"], x["name"]))
    return out


def band_totals(rows: list[dict]) -> dict:
    out = {}
    for band in ("A", "B", "C", "—"):
        use = [r for r in rows if r["abc"] == band]
        old = sum(r["revenue"] for r in use)
        extra = sum(r["extra_rev"] for r in use)
        out[band] = {
            "items": len(use),
            "qty": sum(r["qty"] for r in use),
            "old": old,
            "extra": extra,
            "new": old + extra,
            "gross_pct": (extra / old * 100) if old else 0,
            "net": extra * (1 - LOAD),
        }
    guest = [r for r in rows if r["guest"]]
    old = sum(r["revenue"] for r in guest)
    extra = sum(r["extra_rev"] for r in guest)
    out["guest"] = {
        "items": len(guest),
        "old": old,
        "extra": extra,
        "new": old + extra,
        "gross_pct": (extra / old * 100) if old else 0,
        "net": extra * (1 - LOAD),
        "cover_pp": (extra * (1 - LOAD) / old * 100) if old else 0,
        "cover_of_15": (extra * (1 - LOAD) / (old * LOAD) * 100) if old else 0,
    }
    return out


def write_md(rows: list[dict], totals: dict) -> str:
    g = totals["guest"]
    lines = [
        "# Прогрессивная шкала A/B/C",
        "",
        "Разрез по выручке сентября (гостевое меню, без стаффа и постоянников):",
        f"- **A** — первые {A_CUT:.0%} выручки, подъём **5%** (ходовые).",
        f"- **B** — следующие до {B_CUT:.0%}, подъём **8%**.",
        "- **C** — хвост, подъём **10%**.",
        "- Стафф / постоянники — не трогаем.",
        "",
        "Округление то же: до 500 ₽ шаг 10, от 500 шаг 50.",
        "",
        "## Сводка",
        "",
        f"Гостевая выручка сентября {md_money(g['old'])} ₽ → {md_money(g['new'])} ₽ "
        f"(+{g['gross_pct']:.1f}%). В карман после 15% нагрузки: **{md_money(g['net'])} ₽** "
        f"({g['cover_pp']:.1f} п.п. с оборота, {g['cover_of_15']:.0f}% от пятнадцатипроцентной кучи).",
        "",
        "| Класс | Позиций | Было ₽ | Прибавка | Факт % |",
        "|---|---:|---:|---:|---:|",
    ]
    for band, title in (("A", "A · 5%"), ("B", "B · 8%"), ("C", "C · 10%")):
        t = totals[band]
        lines.append(
            f"| {title} | {t['items']} | {md_money(t['old'])} | +{md_money(t['extra'])} | {t['gross_pct']:.1f}% |"
        )
    lines += [
        "",
        "## Полная таблица: было → стало",
        "",
        "CSV с колонкой заведения (строка = точка + позиция): `abc-by-venue.csv`.",
        "",
        "| Класс | Категория | Позиция | Шт/сент | Было | Стало | Факт % | Точки |",
        "|---|---|---|---:|---:|---:|---:|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['abc']} | {r['cat']} | {r['name']} | {r['qty']:.0f} | {r['current']} | {r['new']} | {r['actual_pct']:.1f} | {r['venues']} |"
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    rows = assign_abc(catalog(load_items()))
    totals = band_totals(rows)
    fields = [
        "abc",
        "cat",
        "name",
        "venues",
        "qty",
        "current",
        "pct_target",
        "new",
        "actual_pct",
        "extra_unit",
        "extra_rev",
        "guest",
    ]
    with (ROOT / "abc-was-became.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    by_key = {(r["cat"], r["name"]): r for r in rows}
    venue_rows = []
    for raw in load_items():
        key = (raw["cat"], raw["name"])
        rec = by_key[key]
        extra_rev = (rec["new"] - rec["current"]) * raw["qty"]
        venue_rows.append(
            {
                "Заведение": raw["venue"],
                "Класс": rec["abc"],
                "Категория": rec["cat"],
                "Позиция": rec["name"],
                "Шт_сентябрь": int(raw["qty"]),
                "Было": rec["current"],
                "Стало": rec["new"],
                "Цель_%": rec["pct_target"],
                "Факт_%": rec["actual_pct"],
                "Прибавка_за_шт": rec["new"] - rec["current"],
                "Прибавка_выручка": extra_rev,
            }
        )
    venue_rows.sort(
        key=lambda x: (
            x["Заведение"],
            x["Класс"] == "—",
            x["Класс"],
            -x["Прибавка_выручка"],
            x["Категория"],
            x["Позиция"],
        )
    )
    venue_csv = ROOT / "abc-by-venue.csv"
    with venue_csv.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(venue_rows[0].keys()))
        w.writeheader()
        w.writerows(venue_rows)

    md = write_md(rows, totals)
    (ROOT / "ABC.md").write_text(md, encoding="utf-8")
    (ROOT / "abc-figures.json").write_text(
        json.dumps({"totals": totals, "rows": rows}, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print(json.dumps(totals, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

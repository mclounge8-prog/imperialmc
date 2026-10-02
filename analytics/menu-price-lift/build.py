#!/usr/bin/env python3
"""Price-lift scenarios 5–10% from September sold catalog (POS line prices)."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
POS = ROOT.parent / "2026-09" / "pos-dump.json"
LOAD = 0.15  # user stack: taxes both IPs + acquiring 2.5%
PCTS = (5, 6, 7, 8, 9, 10)
GUEST_SKIP_CATS = {"Стафф", "Кальяны постоянникам"}


def step_for(price: float) -> int:
    return 50 if price >= 500 else 10


def nice_round(price: float) -> int:
    if price <= 0:
        return 0
    step = step_for(price)
    return int(round(price / step) * step)


def lifted(old: float, pct: int) -> int:
    raw = old * (1 + pct / 100)
    step = step_for(raw)
    nxt = int(round(raw / step) * step)
    if nxt <= old:
        nxt += step
    return nxt


def load_items() -> list[dict]:
    data = json.loads(POS.read_text())
    rows = []
    for raw in data["ITEMS"]:
        qty = float(raw["qty"])
        rev = float(raw["revenue"])
        if qty <= 0:
            continue
        rows.append(
            {
                "venue": raw["venue"],
                "cat": raw["cat"],
                "name": raw["name"],
                "qty": qty,
                "revenue": rev,
                "unit": rev / qty,
            }
        )
    return rows


def catalog(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["cat"], r["name"])
        g = grouped.setdefault(
            key,
            {
                "cat": r["cat"],
                "name": r["name"],
                "qty": 0.0,
                "revenue": 0.0,
                "venues": set(),
            },
        )
        g["qty"] += r["qty"]
        g["revenue"] += r["revenue"]
        g["venues"].add(r["venue"])
    out = []
    for g in grouped.values():
        unit = g["revenue"] / g["qty"]
        out.append(
            {
                "cat": g["cat"],
                "name": g["name"],
                "qty": g["qty"],
                "revenue": g["revenue"],
                "unit": unit,
                "current": nice_round(unit) or int(round(unit)),
                "venues": sorted(g["venues"]),
                "guest": g["cat"] not in GUEST_SKIP_CATS,
            }
        )
    out.sort(key=lambda x: (-x["revenue"], x["cat"], x["name"]))
    return out


def scenario_rows(cat: list[dict], pct: int) -> list[dict]:
    rows = []
    for item in cat:
        new = lifted(item["current"], pct)
        actual_pct = (new / item["current"] - 1) * 100 if item["current"] else 0
        extra_unit = new - item["current"]
        extra_rev = extra_unit * item["qty"]
        rows.append(
            {
                **item,
                "venues": ", ".join(item["venues"]),
                "pct_target": pct,
                "new": new,
                "actual_pct": round(actual_pct, 2),
                "extra_unit": extra_unit,
                "extra_rev": extra_rev,
                "net_after_load": extra_rev * (1 - LOAD),
            }
        )
    return rows


def totals(rows: list[dict], guest_only: bool = False) -> dict:
    use = [r for r in rows if (r.get("guest", True) if guest_only else True)]
    old = sum(r["revenue"] for r in use)
    extra = sum(r["extra_rev"] for r in use)
    net = extra * (1 - LOAD)
    return {
        "old": old,
        "extra": extra,
        "new": old + extra,
        "gross_pct": (extra / old * 100) if old else 0,
        "net": net,
        "cover_pp": (net / old * 100) if old else 0,
        "cover_of_15": (net / (old * LOAD) * 100) if old else 0,
        "items": len(use),
    }


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            out = dict(r)
            if isinstance(out.get("venues"), list):
                out["venues"] = ", ".join(out["venues"])
            w.writerow(out)


def md_money(n: float) -> str:
    return f"{n:,.0f}".replace(",", " ")


def main() -> None:
    rows = load_items()
    cat = catalog(rows)
    all_scenario = []
    summary = []
    for pct in PCTS:
        sc = scenario_rows(cat, pct)
        all_scenario.extend(sc)
        t_all = totals(sc, guest_only=False)
        t_guest = totals(sc, guest_only=True)
        summary.append({"pct": pct, "all": t_all, "guest": t_guest})

    fields = [
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
        "net_after_load",
        "guest",
    ]
    write_csv(ROOT / "prices-5-10.csv", all_scenario, fields)

    by_venue_rows = []
    venue_groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        venue_groups[r["venue"]].append(r)
    venue_summary = []
    for venue, vrows in sorted(venue_groups.items()):
        vcat = catalog(vrows)
        block = {"venue": venue}
        for pct in PCTS:
            sc = scenario_rows(vcat, pct)
            t = totals(sc, guest_only=True)
            block[str(pct)] = t
            for s in sc:
                by_venue_rows.append({"venue": venue, **s})
        venue_summary.append(block)
    write_csv(
        ROOT / "prices-by-venue.csv",
        by_venue_rows,
        ["venue"] + fields,
    )

    payload = {
        "source": "analytics/2026-09/pos-dump.json ITEMS",
        "note": "Цены — средневзвешенная цена строки чека сентября, округлённая до сетки. Не карточка БО.",
        "load": LOAD,
        "rounding": "до 500 шаг 10, от 500 шаг 50, не ниже текущей",
        "catalog": [
            {
                **{k: v for k, v in i.items() if k != "venues"},
                "venues": i["venues"],
                "lifts": {str(p): lifted(i["current"], p) for p in PCTS},
            }
            for i in cat
        ],
        "summary": summary,
        "by_venue": [
            {
                "venue": b["venue"],
                **{p: b[str(p)] for p in map(str, PCTS)},
            }
            for b in venue_summary
        ],
    }
    (ROOT / "figures.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Подъём меню 5–10% под налоговую нагрузку 15%",
        "",
        "Исходник: проданные позиции сентября 2026 (`pos-dump.json` / ITEMS).",
        "Это **цены строк чека до скидки по чеку** (субтотал сети 1 884 135 ₽), не выгрузка карточек из БО — к серверу нет доступа.",
        "",
        "Нагрузка, как ты сложил: **15%** с оборота (налоги обоих ИП + эквайринг 2,5%).",
        "Прибавка тоже ест эти 15%: из каждого нового рубля в кармане остаётся **85 копеек**.",
        "Чтобы **снять с себя 8 пунктов** из 15, сырой подъём должен быть 8 / 0,85 ≈ **9,4%** — в таблице это ряд **10%** после округления.",
        "",
        "Округление: до 500 ₽ — до десятков (170→180), от 500 ₽ — до полусотен (1150→1250, 1500→1600/1650). Если после округления цена не выросла — плюс один шаг.",
        "",
        "Объём продаж = сентябрь, оттока нет (как просил).",
        "«Гостевое» ниже — без категорий «Стафф» и «Кальяны постоянникам».",
        "",
        "## Прогрессия по сети (гостевое меню)",
        "",
        "| Цель | Новая выручка | Прибавка ₽ | Факт % после округления | В карман после 15% | Снято пунктов с оборота | Какая доля 15% нагрузки легла на гостя |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for s in summary:
        g = s["guest"]
        lines.append(
            f"| {s['pct']}% | {md_money(g['new'])} | +{md_money(g['extra'])} | {g['gross_pct']:.1f}% | {md_money(g['net'])} | {g['cover_pp']:.1f} п.п. | {g['cover_of_15']:.0f}% |"
        )
    lines += [
        "",
        "## По точкам, гостевое, ряд 8% и 10%",
        "",
        "| Точка | Сейчас | +8% новые | +8% в карман | снято п.п. | +10% новые | +10% в карман | снято п.п. |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for b in venue_summary:
        t8, t10 = b["8"], b["10"]
        lines.append(
            f"| {b['venue']} | {md_money(t8['old'])} | {md_money(t8['new'])} | {md_money(t8['net'])} | {t8['cover_pp']:.1f} | {md_money(t10['new'])} | {md_money(t10['net'])} | {t10['cover_pp']:.1f} |"
        )
    lines += [
        "",
        "Полные прайсы: `prices-5-10.csv` (уникальные позиции сети), `prices-by-venue.csv` (то же по точкам), `figures.json`.",
    ]
    (ROOT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

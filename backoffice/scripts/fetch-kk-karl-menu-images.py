#!/usr/bin/env python3
"""
Картинки для меню Kebab King Карла из Wikimedia Commons (свободные лицензии).

Схожие позиции шарят один файл-источник (копии item-{id}-*.jpg), чтобы шаурма
одного типа выглядела одинаково, а запросов к Commons было меньше.
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "ImperialMC-MenuImages/1.0 (https://imperial-mc.online; menu stock photos)"
OUT_DIR = Path(os.environ.get("MENU_IMAGE_OUT", "/tmp/kk-karl-menu-images"))
SLEEP_S = float(os.environ.get("MENU_IMAGE_SLEEP", "0.6"))

# Группы: один поиск → несколько позиций меню
GROUPS: list[dict] = [
    {"key": "americano", "q": "Caffè Americano", "ids": [144]},
    {"key": "cappuccino", "q": "Cappuccino", "ids": [145, 146]},
    {"key": "latte", "q": "Latte", "ids": [147]},
    {"key": "espresso", "q": "Espresso", "ids": [148]},
    {"key": "grape_soda", "q": "Grape soda", "ids": [149]},
    {"key": "pear_soda", "q": "Pear soft drink", "ids": [150]},
    {"key": "lemon_soda", "q": "Lemonade bottle", "ids": [151]},
    {"key": "tarkhun", "q": "Tarkhun", "ids": [152]},
    {"key": "feijoa_drink", "q": "Feijoa", "ids": [153]},
    {"key": "energy_drink", "q": "Energy drink", "ids": [154, 161, 162, 158, 157, 159, 160, 156, 155, 163]},
    {"key": "cola", "q": "Cola bottle", "ids": [164, 167, 166, 165]},
    {"key": "tropical_juice", "q": "Tropical juice", "ids": [170]},
    {"key": "apple_juice", "q": "Apple juice", "ids": [168, 169]},
    {"key": "mineral_water", "q": "Mineral water bottle", "ids": [172, 173, 171]},
    {"key": "iced_tea_green", "q": "Iced tea", "ids": [174, 175]},
    {"key": "hamburger", "q": "Hamburger", "ids": [106, 113]},
    {"key": "cheeseburger", "q": "Cheeseburger", "ids": [107]},
    {"key": "double_cheese", "q": "Double cheeseburger", "ids": [108]},
    {"key": "kebab_burger", "q": "Kebab sandwich", "ids": [110]},
    {"key": "panini", "q": "Panini", "ids": [111, 112, 114]},
    {"key": "chicken_burger", "q": "Chicken burger", "ids": [109]},
    {"key": "hot_dog", "q": "Hot dog", "ids": [117, 118]},
    {"key": "wrap", "q": "Chicken wrap", "ids": [115]},
    {"key": "shawarma_chicken", "q": "Shawarma sandwich", "ids": [121, 124, 125, 123]},
    {"key": "shawarma_pork", "q": "Doner kebab wrap", "ids": [122, 127, 126, 128]},
    {"key": "combo", "q": "Fast food meal", "ids": [130, 129]},
    {"key": "fries", "q": "French fries", "ids": [131]},
    {"key": "wings", "q": "Chicken wings", "ids": [132, 135]},
    {"key": "onion_rings", "q": "Onion rings", "ids": [138]},
    {"key": "instant_coffee", "q": "Cup of coffee", "ids": [139, 142]},
    {"key": "hot_tea", "q": "Cup of tea", "ids": [143, 140]},
    {"key": "fresh_juice", "q": "Fresh juice glass", "ids": [141]},
    {"key": "bbq_dip", "q": "Barbecue sauce", "ids": [178]},
    {"key": "ketchup", "q": "Ketchup", "ids": [177]},
    {"key": "garlic_sauce", "q": "Garlic sauce", "ids": [179]},
    {"key": "cheese_sauce", "q": "Cheese sauce", "ids": [176]},
    {"key": "bacon", "q": "Bacon", "ids": [180]},
    {"key": "mustard", "q": "Mustard (condiment)", "ids": [190]},
    {"key": "korean_carrot", "q": "Korean carrot salad", "ids": [184]},
    {"key": "chicken_meat", "q": "Grilled chicken", "ids": [185]},
    {"key": "pork_meat", "q": "Grilled pork", "ids": [186]},
    {"key": "tea_cup_lid", "q": "Paper cup with lid", "ids": [191]},
    {"key": "jalapeno", "q": "Jalapeño", "ids": [189]},
    {"key": "delivery", "q": "Food delivery", "ids": [192]},
]

# Запасные запросы, если основной пустой
FALLBACKS: dict[str, list[str]] = {
    "tarkhun": ["Green soda", "Herbal soft drink"],
    "feijoa_drink": ["Fruit soda", "Green soft drink"],
    "pear_soda": ["Pear juice", "Fruit soda bottle"],
    "double_cheese": ["Cheeseburger", "Hamburger with cheese"],
    "kebab_burger": ["Doner kebab", "Kebab"],
    "shawarma_pork": ["Shawarma", "Doner kebab"],
    "tropical_juice": ["Orange juice", "Fruit juice"],
    "adrenaline energy": ["Energy drink can"],
    "korean_carrot": ["Carrot salad", "Pickled carrots"],
    "tea_cup_lid": ["Disposable cup", "Coffee cup lid"],
    "delivery": ["Takeaway food bag", "Delivery bag"],
}


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=45, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
        return resp.read()


def commons_search(query: str) -> dict | None:
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrnamespace": "6",
            "gsrlimit": "12",
            "gsrsearch": query,
            "prop": "imageinfo",
            "iiprop": "url|mime|size|extmetadata",
            "iiurlwidth": "1000",
        }
    )
    data = http_json(f"https://commons.wikimedia.org/w/api.php?{params}")
    pages = list(((data.get("query") or {}).get("pages") or {}).values())
    scored = []
    for p in pages:
        infos = p.get("imageinfo") or []
        if not infos:
            continue
        ii = infos[0]
        mime = (ii.get("mime") or "").lower()
        if mime not in ("image/jpeg", "image/png", "image/webp"):
            continue
        w = int(ii.get("width") or 0)
        if w and w < 500:
            continue
        title = (p.get("title") or "").lower()
        if any(x in title for x in ("logo", "icon", "svg", "map", "diagram", "flag")):
            continue
        url = ii.get("thumburl") or ii.get("url")
        if not url:
            continue
        score = w * int(ii.get("height") or w)
        if "food" in title or "burger" in title or query.lower().split()[0] in title:
            score += 1_000_000
        scored.append((score, {"title": p.get("title"), "url": url, "mime": mime, "width": w}))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1] if scored else None


def find_image(group: dict) -> dict | None:
    queries = [group["q"]] + FALLBACKS.get(group["key"], [])
    for q in queries:
        hit = commons_search(q)
        time.sleep(SLEEP_S)
        if hit:
            hit["query_used"] = q
            return hit
    return None


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    only = set(int(x) for x in sys.argv[1:]) if len(sys.argv) > 1 else None

    for group in GROUPS:
        ids = [i for i in group["ids"] if only is None or i in only]
        if not ids:
            continue
        print(f"[{group['key']}] {group['q']} → {ids}", flush=True)
        try:
            hit = find_image(group)
            if not hit:
                print("  ! no results", flush=True)
                for i in ids:
                    report.append({"id": i, "ok": False, "error": "no results", "group": group["key"]})
                continue
            data = http_bytes(hit["url"])
            if len(data) < 3000:
                raise RuntimeError("image too small")
            mime = hit.get("mime") or ""
            ext = ".png" if "png" in mime else ".webp" if "webp" in mime else ".jpg"
            source_path = OUT_DIR / f"_src-{group['key']}{ext}"
            source_path.write_bytes(data)
            print(f"  src {source_path.name} ({len(data)} B) «{hit['title']}» via {hit.get('query_used')}", flush=True)
            for item_id in ids:
                fname = f"item-{item_id}-stock{ext}"
                dest = OUT_DIR / fname
                dest.write_bytes(data)
                report.append(
                    {
                        "id": item_id,
                        "ok": True,
                        "file": fname,
                        "group": group["key"],
                        "source_url": hit["url"],
                        "commons_title": hit["title"],
                        "query": hit.get("query_used"),
                    }
                )
                print(f"  + {fname}", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {exc}", flush=True)
            for i in ids:
                report.append({"id": i, "ok": False, "error": str(exc), "group": group["key"]})
        time.sleep(SLEEP_S)

    (OUT_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    ok = sum(1 for r in report if r.get("ok"))
    print(f"\nDone: {ok}/{len(report)} → {OUT_DIR}", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

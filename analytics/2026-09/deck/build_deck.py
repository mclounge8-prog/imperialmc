#!/usr/bin/env python3
"""Imperial MC September 2026 deck — readable, brand-dark, one idea per slide."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
FIG = json.loads((ROOT.parent / "figures.json").read_text())
CARD = json.loads((ROOT.parent / "card-shops.json").read_text())
POS = json.loads((ROOT.parent / "pos-dump.json").read_text())
LOGO = "logo-white.png"

SHOP_RU = {
    "MAGAZIN DOBROTSEN": "Доброцен",
    "MAGAZIN CHAJKA": "Чайка",
    "MAGAZIN SOM": "Сом",
    "MAGAZIN MYASNOJ": "Мясной",
    "MAGAZIN PRODUKTOV": "Продукты",
    "PRODUKTY": "Продукты",
    "PELMENNAYA 1": "Пельменная",
    "FRUKTOVYJ": "Фруктовый",
    "FRUKTOVYJ RAJ": "Фруктовый рай",
    "GORYACHIJ KHLEB": "Горячий хлеб",
    "IP GADZHIEV IMRAN": "ИП Гаджиев",
    "EVO_KONDITER IZDELIYA": "Кондитерская",
}


def r(n, digits=0):
    n = float(n)
    s = f"{n:,.{digits}f}" if digits else f"{n:,.0f}"
    return s.replace(",", "\u202f")


def pct(n):
    return f"{float(n):.1f}".replace(".", ",")


venues = {v["name"]: v for v in FIG["venues"]}
oct_ = venues["Kebab King Октябрьская"]
karl = venues["Kebab King Карла"]
rosa = venues["MC Lounge Роза"]
grand = venues["MC Гранд"]
puff = venues["MC Lounge Puff"]
T = FIG["totals"]
B = FIG["bank_statement"]
od = B["predprinimatelskiy_dohod_to_demkina"]
merch = CARD["by_merchant"]


def merch_amt(name):
    return next((m["amount"] for m in merch if m["name"] == name), 0)


def merch_n(name):
    return next((m["n"] for m in merch if m["name"] == name), 0)


street_names = [
    "Пятёрочка", "Магнит", "Монетка", "Метрополис", "MAGAZIN DOBROTSEN",
    "MAGAZIN CHAJKA", "MAGAZIN SOM", "MAGAZIN MYASNOJ", "MAGAZIN PRODUKTOV",
    "PRODUKTY", "PELMENNAYA 1", "FRUKTOVYJ", "FRUKTOVYJ RAJ",
    "GORYACHIJ KHLEB", "IP GADZHIEV IMRAN", "EVO_KONDITER IZDELIYA",
]
street = [(SHOP_RU.get(n, n), merch_amt(n), merch_n(n)) for n in street_names if merch_amt(n)]
# fold duplicate Продукты
folded = {}
for n, a, nn in street:
    folded[n] = [folded.get(n, [0, 0])[0] + a, folded.get(n, [0, 0])[1] + nn]
street = [(n, a, nn) for n, (a, nn) in folded.items()]
street_sum = sum(a for _, a, _ in street)
unlab = [(m["name"], m["amount"], m["n"]) for m in merch if m["name"].startswith("CH450")]
unlab_sum = sum(a for _, a, _ in unlab)


def hours(venue):
    by = {}
    for h in POS["HOUR"]:
        if h["venue"] != venue:
            continue
        k = int(h["hour"])
        by[k] = by.get(k, 0) + float(h["revenue"])
    return by


oct_h = hours("Kebab King Октябрьская")
karl_h = hours("Kebab King Карла")
max_h = max(list(oct_h.values()) + list(karl_h.values()))


def hour_bars(data, color):
    parts = []
    for h in range(10, 24):
        v = data.get(h, 0)
        ht = 12 + (v / max_h) * 280 if max_h else 12
        parts.append(
            f'<div class="hbar">'
            f'<div class="hbar-fill" style="height:{ht:.0f}px;background:{color}"></div>'
            f'<span>{h}</span></div>'
        )
    return "".join(parts)


def hbar_row(label, value, max_v, extra=""):
    w = 8 + (value / max_v) * 92 if max_v else 8
    return (
        f'<div class="br">'
        f'<div class="br-l">{label}</div>'
        f'<div class="br-track"><div class="br-fill" style="width:{w:.1f}%"></div></div>'
        f'<div class="br-v">{r(value)}{extra}</div></div>'
    )


FONT_FACES = """
@font-face { font-family: Inter; font-weight: 400; src: url('fonts/Inter-400-cyr.woff2') format('woff2'); unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: Inter; font-weight: 400; src: url('fonts/Inter-400-lat.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: Inter; font-weight: 500; src: url('fonts/Inter-500-cyr.woff2') format('woff2'); unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: Inter; font-weight: 500; src: url('fonts/Inter-500-lat.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: Inter; font-weight: 600; src: url('fonts/Inter-600-cyr.woff2') format('woff2'); unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: Inter; font-weight: 600; src: url('fonts/Inter-600-lat.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: Inter; font-weight: 700; src: url('fonts/Inter-700-cyr.woff2') format('woff2'); unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: Inter; font-weight: 700; src: url('fonts/Inter-700-lat.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: Grotesk; font-weight: 600; src: url('fonts/SpaceGrotesk-600-lat.woff2') format('woff2'); }
@font-face { font-family: Grotesk; font-weight: 700; src: url('fonts/SpaceGrotesk-700-lat.woff2') format('woff2'); }
"""

CSS = FONT_FACES + """
:root {
  --bg: #121214;
  --surface: #1b1b1f;
  --surface-2: #24242a;
  --line: #34343c;
  --text: #f1f1f3;
  --muted: #98979f;
  --blue: #3f63e6;
  --blue-deep: #2647c7;
  --ok: #3dbe8c;
  --lilac: #8b7cff;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: #0b0b0d; }
@page { size: 1920px 1080px; margin: 0; }
.slide {
  width: 1920px; height: 1080px;
  background:
    radial-gradient(900px 520px at 112% -10%, rgba(63,99,230,.22), transparent 58%),
    radial-gradient(700px 400px at -8% 110%, rgba(38,71,199,.16), transparent 55%),
    var(--bg);
  color: var(--text);
  font-family: Inter, 'DejaVu Sans', sans-serif;
  padding: 64px 80px 56px;
  position: relative;
  overflow: hidden;
  page-break-after: always;
}
.slide::before {
  content: "";
  position: absolute; left: 0; top: 0; bottom: 0; width: 7px;
  background: linear-gradient(180deg, var(--blue), var(--blue-deep));
}
.glow-line {
  width: 48px; height: 3px; border-radius: 2px;
  background: var(--blue);
  box-shadow: 0 0 16px 2px rgba(63,99,230,.55);
  margin: 16px 0 0;
}
.top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 36px; }
.eyebrow {
  font-size: 15px; font-weight: 600; letter-spacing: .18em;
  text-transform: uppercase; color: var(--blue); margin: 0 0 10px;
}
h2 { font-size: 46px; font-weight: 700; letter-spacing: -.03em; margin: 0; line-height: 1.12; max-width: 1500px; }
.logo {
  height: 52px; width: auto; max-width: 140px;
  object-fit: contain; object-position: right center;
  flex: 0 0 auto;
}
.title-slide { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding-left: 120px; }
.title-logo {
  height: 78px; width: auto; max-width: 220px;
  object-fit: contain; object-position: left center;
  display: block; margin: 0 0 40px;
}
.title-slide h1 {
  font-size: 92px; font-weight: 700; letter-spacing: -.04em;
  margin: 0; line-height: .95;
}
.chips { display: flex; gap: 12px; margin-top: 36px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--line); background: rgba(27,27,31,.7);
  border-radius: 999px; padding: 10px 18px; font-size: 18px; color: var(--muted);
}
.kpis { display: grid; gap: 20px; }
.k4 { grid-template-columns: repeat(4, 1fr); }
.k3 { grid-template-columns: repeat(3, 1fr); }
.k5 { grid-template-columns: repeat(5, 1fr); }
.k2 { grid-template-columns: 1fr 1fr; }
.card {
  background: linear-gradient(180deg, #222228, #1b1b1f);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 32px 30px 28px;
  position: relative;
  min-height: 210px;
}
.card .v { white-space: nowrap; }
.card::after {
  content: "";
  position: absolute; left: 24px; right: 24px; top: 0; height: 2px;
  background: linear-gradient(90deg, var(--blue), transparent);
  border-radius: 2px;
}
.card .l { color: var(--muted); font-size: 15px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; }
.card .v {
  font-family: Grotesk, Inter, sans-serif;
  font-size: 48px; font-weight: 700; margin-top: 12px; letter-spacing: -.03em; line-height: 1;
}
.card .s { color: var(--muted); font-size: 18px; margin-top: 12px; line-height: 1.4; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
.venue {
  background: linear-gradient(180deg, #222228, #1b1b1f);
  border: 1px solid var(--line); border-radius: 16px; padding: 26px 24px 22px;
}
.venue.hot { border-color: #3a4ea8; box-shadow: inset 0 0 0 1px rgba(63,99,230,.25); }
.venue .name { font-size: 20px; font-weight: 600; margin-bottom: 18px; }
.venue .sum { font-family: Grotesk, Inter, sans-serif; font-size: 40px; font-weight: 700; letter-spacing: -.03em; }
.venue .meta { color: var(--muted); font-size: 18px; margin-top: 10px; line-height: 1.45; }
.statrow { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; margin-top: 28px; }
.statrow .k { color: var(--muted); font-size: 16px; }
.statrow .n { font-family: Grotesk, Inter, sans-serif; font-size: 30px; font-weight: 700; margin-top: 4px; }
.note {
  margin-top: 28px; padding: 18px 22px;
  background: rgba(63,99,230,.1); border: 1px solid rgba(63,99,230,.28);
  border-radius: 14px; font-size: 20px; line-height: 1.4; color: #d5dbf5;
}
.ok {
  background: rgba(61,190,140,.1); border-color: rgba(61,190,140,.28); color: #d4f3e4;
}
.hours { display: flex; align-items: flex-end; gap: 10px; height: 360px; }
.hbar { width: 48px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.hbar-fill { width: 30px; border-radius: 8px 8px 3px 3px; }
.hbar span { font-size: 16px; color: var(--muted); }
.br { display: grid; grid-template-columns: 220px 1fr 180px; gap: 18px; align-items: center; margin: 18px 0; }
.br-l { font-size: 22px; font-weight: 550; }
.br-track { height: 16px; background: #2a2a32; border-radius: 99px; overflow: hidden; }
.br-fill { height: 100%; background: linear-gradient(90deg, var(--blue-deep), var(--blue)); border-radius: 99px; }
.br-v { font-family: Grotesk, Inter, sans-serif; font-size: 24px; font-weight: 700; text-align: right; }
.person { padding: 28px; }
.person .who { font-size: 24px; font-weight: 600; }
.take {
  display: grid; grid-template-columns: 64px 1fr; gap: 18px; align-items: start;
  background: linear-gradient(180deg, #222228, #1b1b1f);
  border: 1px solid var(--line); border-radius: 16px; padding: 26px 26px 24px;
}
.take .num {
  width: 56px; height: 56px; border-radius: 14px;
  background: rgba(63,99,230,.16); color: var(--blue);
  font-family: Grotesk, Inter, sans-serif; font-weight: 700; font-size: 26px;
  display: flex; align-items: center; justify-content: center;
}
.take b { display: block; font-size: 24px; margin-bottom: 8px; }
.take span { color: var(--muted); font-size: 18px; line-height: 1.4; }
.foot {
  position: absolute; left: 80px; right: 80px; bottom: 28px;
  display: flex; justify-content: space-between; align-items: center;
  color: var(--muted); font-size: 14px;
}
.page {
  min-width: 64px; text-align: center;
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px;
}
.share { display: flex; height: 72px; border-radius: 16px; overflow: hidden; margin: 36px 0 0; }
.share-seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; font-weight: 600; gap: 8px; }
.share-seg b { font-weight: 700; }
.vs {
  position: absolute; left: 50%; top: 58%; transform: translate(-50%,-50%);
  width: 56px; height: 56px; border-radius: 50%;
  background: #121214; border: 1px solid var(--line);
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: 14px; font-weight: 600; letter-spacing: .08em;
}
"""

TOTAL = 18


def slide(body, num, title=False):
    klass = "slide title-slide" if title else "slide"
    return f'''<section class="{klass}">
{body}
<div class="foot"><span>Imperial MC · сентябрь 2026</span><span class="page">{num} / {TOTAL}</span></div>
</section>'''


slides = []

slides.append(slide(f'''
  <img class="title-logo" src="{LOGO}" alt="Imperial MC">
  <p class="eyebrow">Аналитика сети</p>
  <h1>Сентябрь<br>2026</h1>
  <div class="glow-line"></div>
  <div class="chips">
    <span class="chip">1–30 сентября</span>
    <span class="chip">Екатеринбург</span>
    <span class="chip">5 точек</span>
    <span class="chip">3 167 чеков</span>
  </div>
''', 1, title=True))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Сеть</p><h2>Месяц одним взглядом</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k4">
    <div class="card"><div class="l">Оплачено</div><div class="v">{r(T["paid"])}</div><div class="s">скидки {r(T["discount_total"])} ₽</div></div>
    <div class="card"><div class="l">Карта</div><div class="v">{pct(T["card_pct"])}%</div><div class="s">{r(T["card"])} ₽</div></div>
    <div class="card"><div class="l">Нал</div><div class="v">{pct(T["cash_pct"])}%</div><div class="s">{r(T["cash"])} ₽</div></div>
    <div class="card"><div class="l">Kebab King</div><div class="v">86%</div><div class="s">{r(oct_["paid_total"]+karl["paid_total"])} ₽ на двоих</div></div>
  </div>
  <div class="share">
    <div class="share-seg" style="width:56.2%;background:#3f63e6"><b>Октябрьская</b> 56%</div>
    <div class="share-seg" style="width:29.9%;background:#6f8cff"><b>Карла</b> 30%</div>
    <div class="share-seg" style="width:6.5%;background:#8b7cff"><b>Роза</b></div>
    <div class="share-seg" style="width:6.0%;background:#3dbe8c"><b>Гранд</b></div>
    <div class="share-seg" style="width:1.4%;background:#5c5c66"></div>
  </div>
  <div class="note">Роза в ремонте. Гранд и Puff открылись 15-го. Их сентябрь — не нормальный месяц точки.</div>
''', 2))

venue_cards = [
    (oct_, True, "Октябрьская"),
    (karl, True, "Карла"),
    (rosa, False, "Роза"),
    (grand, False, "Гранд"),
    (puff, False, "Puff"),
]
vc = []
for v, hot, short in venue_cards:
    vc.append(
        f'<div class="venue{" hot" if hot else ""}"><div class="name">{short}</div>'
        f'<div class="sum">{r(v["paid_total"])}</div>'
        f'<div class="meta">{pct(v["share_pct"])}% сети · {r(v["paid_receipts"])} чеков<br>'
        f'средний {r(v["avg_check"])} · день {r(v["avg_day"])}</div></div>'
    )
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Разрез</p><h2>Пять точек</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k5">{''.join(vc)}</div>
''', 3))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Kebab King</p><h2>Октябрьская в 1,88 раза больше</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="grid2" style="position:relative">
    <div class="card">
      <div class="l">Октябрьская</div>
      <div class="v">{r(oct_["paid_total"])}</div>
      <div class="statrow">
        <div><div class="k">Чеки</div><div class="n">1 790</div></div>
        <div><div class="k">День</div><div class="n">{r(oct_["avg_day"])}</div></div>
        <div><div class="k">Обед 11–16</div><div class="n">{r(oct_["lunch_11_16"]["revenue"])}</div></div>
        <div><div class="k">Вечер 17–23</div><div class="n">{r(oct_["evening_17_23"]["revenue"])}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="l">Карла</div>
      <div class="v">{r(karl["paid_total"])}</div>
      <div class="statrow">
        <div><div class="k">Чеки</div><div class="n">1 026</div></div>
        <div><div class="k">День</div><div class="n">{r(karl["avg_day"])}</div></div>
        <div><div class="k">Обед 11–16</div><div class="n">{r(karl["lunch_11_16"]["revenue"])}</div></div>
        <div><div class="k">Вечер 17–23</div><div class="n">{r(karl["evening_17_23"]["revenue"])}</div></div>
      </div>
    </div>
    <div class="vs">VS</div>
  </div>
  <div class="note">Средний чек почти тот же. Ломается не меню — дневной ритм.</div>
''', 4))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Часы</p><h2>Октябрьская — весь день. Карла — вечер.</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="grid2">
    <div>
      <div class="l" style="color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-size:15px;margin-bottom:12px">Октябрьская</div>
      <div class="hours">{hour_bars(oct_h, "#3f63e6")}</div>
    </div>
    <div>
      <div class="l" style="color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-size:15px;margin-bottom:12px">Карла</div>
      <div class="hours">{hour_bars(karl_h, "#8b7cff")}</div>
    </div>
  </div>
''', 5))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Допродажи</p><h2>На Карла не дожимают напиток</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k3">
    <div class="card"><div class="l">Фри на чек</div><div class="v">0,22</div><div class="s">Октябрьская и Карла одинаково</div></div>
    <div class="card"><div class="l">Дип на чек</div><div class="v">0,13</div><div class="s">Карла 0,12 — тоже рядом</div></div>
    <div class="card"><div class="l">Напиток на чек</div><div class="v">0,35</div><div class="s">Карла только 0,24</div></div>
  </div>
  <div class="note">Шаурма 63–68% выручки, курица / свинина 60 / 40 на обеих. Комбо: 10 наборов за месяц. Напиток на Карла — единственный живой рычаг.</div>
''', 6))

# shifts as people cards
def people(v):
    bits = []
    for o in v["shift_openers"]:
        bits.append(
            f'<div class="card person"><div class="who">{o["name"]}</div>'
            f'<div class="v" style="font-size:40px;margin-top:16px">{r(o["avg_shift"])}</div>'
            f'<div class="s">{o["shifts"]} смен · всего {r(o["revenue"])}</div></div>'
        )
    return "".join(bits)

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Смены</p><h2>Кто держал кассу</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="grid2">
    <div>
      <p class="eyebrow" style="margin-bottom:16px">Октябрьская</p>
      <div class="kpis k2">{people(oct_)}</div>
    </div>
    <div>
      <p class="eyebrow" style="margin-bottom:16px">Карла</p>
      <div class="kpis k2">{people(karl)}</div>
    </div>
  </div>
  <div class="note">Октябрьская ровная. На Карла разница Егора и Андрея может быть графиком.</div>
''', 7))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Роза</p><h2>Ремонт. Постоянники. Свои списания.</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k4">
    <div class="card"><div class="l">Оплачено</div><div class="v">{r(rosa["paid_total"])}</div><div class="s">142 чека · средний {r(rosa["avg_check"])}</div></div>
    <div class="card"><div class="l">Постоянники</div><div class="v">38</div><div class="s">чаш · база зала</div></div>
    <div class="card"><div class="l">Классика</div><div class="v">67</div><div class="s">чаш гостей по полной</div></div>
    <div class="card"><div class="l">Стафф</div><div class="v">85</div><div class="s">чаш начальства · не дыра</div></div>
  </div>
  <div class="grid2" style="margin-top:22px">
    <div class="note ok">Списания под начальство так и должны быть видны в кассе. Это мы.</div>
    <div class="note">Смотреть снова после ремонта: появился ли гость сверх этой базы.</div>
  </div>
''', 8))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">С 15 сентября</p><h2>Гранд нащупал ядро. Puff дежурит.</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="grid2">
    <div class="card">
      <div class="l">Гранд · 16 дней</div>
      <div class="v">{r(grand["paid_total"])}</div>
      <div class="statrow">
        <div><div class="k">Чеки</div><div class="n">192</div></div>
        <div><div class="k">День</div><div class="n">{r(grand["avg_day"])}</div></div>
        <div><div class="k">Медиана</div><div class="n">380</div></div>
        <div><div class="k">Пик 26.09</div><div class="n">17 060</div></div>
      </div>
      <div class="s" style="margin-top:22px;font-size:20px">Карбонара, цезарь, капучино. После 20:00 пусто.</div>
    </div>
    <div class="card">
      <div class="l">Puff · 14 смен</div>
      <div class="v">{r(puff["paid_total"])}</div>
      <div class="statrow">
        <div><div class="k">Чеки</div><div class="n">17</div></div>
        <div><div class="k">Чаши</div><div class="n">18</div></div>
        <div><div class="k">Нулевые смены</div><div class="n">6 из 14</div></div>
        <div><div class="k">Суббота</div><div class="n">8 чаш</div></div>
      </div>
      <div class="s" style="margin-top:22px;font-size:20px">Пока нет трафика — не кормить отдельной сменой каждый день.</div>
    </div>
  </div>
''', 9))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Счёт ИП</p><h2>Пришло 1,97 млн · ушло 1,89 млн</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k4">
    <div class="card"><div class="l">Входящий</div><div class="v">{r(B["official"]["opening_balance"])}</div></div>
    <div class="card"><div class="l">Пришло</div><div class="v">{r(B["official"]["credit_turnover"])}</div><div class="s">220 операций</div></div>
    <div class="card"><div class="l">Ушло</div><div class="v">{r(B["official"]["debit_turnover"])}</div><div class="s">918 операций</div></div>
    <div class="card"><div class="l">На счёте</div><div class="v">{r(B["official"]["closing_balance"])}</div></div>
  </div>
  <div class="note">Эквайринг ≈ {r(B["acquiring_net_by_merchant_approx"]["total"])} при карте в кассе {r(T["card"])}. Нал кассы {r(T["cash"])} в выписку не попадает. Вклад — не расход.</div>
''', 10))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Выводы</p><h2>Себе — 238 500. Пятнадцатое — зарплаты.</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k3">
    <div class="card"><div class="l">Себе</div><div class="v">{r(od["owner_ex_15_16"])}</div><div class="s">«доход от предпринимательской» без 15.09</div></div>
    <div class="card"><div class="l">Белый ФОТ 15.09</div><div class="v">{r(18620+78870)}</div><div class="s">реестры 77 и 76 через Сбер</div></div>
    <div class="card"><div class="l">Ещё 15.09</div><div class="v">58 000</div><div class="s">тоже зарплатное окно, не себе</div></div>
  </div>
  <div class="note">16-го такого вывода не было. Если 58 тыс. тоже зарплата — видимое окно ≈ 155 тыс.</div>
''', 11))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Поставщики</p><h2>То, что уходит по счетам</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  {hbar_row("МАРР Россия", 354087, 354087)}
  {hbar_row("Мистер Крабс", 66654, 354087)}
  {hbar_row("Регионпиво", 47118, 354087)}
  {hbar_row("Курьер Плюс", 17430, 354087)}
  {hbar_row("WB / РВБ", 16909, 354087)}
  {hbar_row("Доксинбокс", 5160, 354087)}
  <div class="note">≈ 507 тыс. узнаваемых счетов. Дальше — то, чего у поставщика нет.</div>
''', 12))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Карта ИП</p><h2>Добор, который нельзя закрыть счётом</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k5">
    <div class="card"><div class="l">Еда с улицы</div><div class="v">{r(street_sum)}</div><div class="s">Пятёрочка, Магнит, Монетка</div></div>
    <div class="card"><div class="l">Упаковка</div><div class="v">{r(merch_amt("Мир упаковки")+merch_amt("Fix Price")+merch_amt("Клади-пакуй"))}</div><div class="s">Мир упаковки и Fix Price</div></div>
    <div class="card"><div class="l">К&amp;Б</div><div class="v">{r(merch_amt("Красное & Белое"))}</div><div class="s">розн. к Регионпиву</div></div>
    <div class="card"><div class="l">Маркетплейсы</div><div class="v">{r(merch_amt("Wildberries")+merch_amt("YM*avito"))}</div><div class="s">WB + Avito</div></div>
    <div class="card"><div class="l">CH450 без имени</div><div class="v">{r(unlab_sum)}</div><div class="s">Сбер обрезал вывеску</div></div>
  </div>
  <div class="note">Срочно, мелко, нет в прайсе МАРР. Ориентир с выписки, не сверка 1:1.</div>
''', 13))

top_street = sorted(street, key=lambda x: -x[1])[:6]
mx = top_street[0][1]
bars = "".join(hbar_row(n, a, mx, f" · {nn}") for n, a, nn in top_street)
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Розничный добор еды</p><h2>{r(street_sum)} ₽ · типичный чек 400–550</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  {bars}
  <div class="note ok">Зелень к вечеру, молоко, мелочь на смену. Не МАРР и не «непонятные траты» — завести статьёй.</div>
''', 14))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Крупнее добора</p><h2>Упаковка, алкоголь, маркетплейсы</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k4">
    <div class="card"><div class="l">Мир упаковки</div><div class="v">{r(merch_amt("Мир упаковки"))}</div><div class="s">три завоза 7 / 14 / 28.09</div></div>
    <div class="card"><div class="l">Fix Price</div><div class="v">{r(merch_amt("Fix Price"))}</div><div class="s">{merch_n("Fix Price")} покупок · расходники</div></div>
    <div class="card"><div class="l">Красное &amp; Белое</div><div class="v">{r(merch_amt("Красное & Белое"))}</div><div class="s">рядом с оптом 47 тыс.</div></div>
    <div class="card"><div class="l">Wildberries</div><div class="v">{r(merch_amt("Wildberries"))}</div><div class="s">плюс счёт РВБ 16 909</div></div>
  </div>
  <div class="note">Упаковка + Fix Price ≈ {r(merch_amt("Мир упаковки")+merch_amt("Fix Price"))} ₽. Это уже не «заскочил в пятёрочку».</div>
''', 15))

ch_sorted = sorted(unlab, key=lambda x: -x[1])
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Слепой кусок</p><h2>CH450 — {r(unlab_sum)} ₽ без вывески</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k4">
    {''.join(f'<div class="card"><div class="l">{n}</div><div class="v">{r(a)}</div><div class="s">{nn} покупок</div></div>' for n,a,nn in ch_sorted)}
  </div>
  <div class="note">Сбер пишет код точки, не имя. Открыть в СберБизнесе — розничный добор, скорее всего, вырастет.</div>
''', 16))

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Безнал, который виден</p><h2>Куда уехали деньги</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="kpis k3">
    <div class="card"><div class="l">Себе</div><div class="v">{r(od["owner_ex_15_16"])}</div></div>
    <div class="card"><div class="l">ФОТ 15.09</div><div class="v">{r(18620+78870)}</div></div>
    <div class="card"><div class="l">МАРР + Крабс</div><div class="v">{r(354087+66654)}</div></div>
    <div class="card"><div class="l">Пиво опт + К&amp;Б</div><div class="v">{r(47118+merch_amt("Красное & Белое"))}</div></div>
    <div class="card"><div class="l">Упаковка</div><div class="v">{r(merch_amt("Мир упаковки")+merch_amt("Fix Price")+merch_amt("Клади-пакуй"))}</div></div>
    <div class="card"><div class="l">Магазины еды</div><div class="v">{r(street_sum)}</div></div>
  </div>
  <div class="note">Нет аренды, полного ФОТа налом и коммуналки. Это карта безнала, не прибыль точек.</div>
''', 17))

takes = [
    ("01", "Октябрьскую не ломать", "56% сети. Обед равен вечеру."),
    ("02", "Карла — день и напиток", "Вечер уже есть. 0,24 напитка против 0,35."),
    ("03", "Розу не лечить", "Ремонт, постоянники, списания на своих."),
    ("04", "Гранд — ядро меню", "Карбонара, цезарь, капучино. Повторить 26.09."),
    ("05", "Добор — отдельная статья", f"Пятёрочка / Магнит / Монетка {r(merch_amt('Пятёрочка')+merch_amt('Магнит')+merch_amt('Монетка'))} ₽."),
    ("06", "Открыть имена CH450", f"Ещё {r(unlab_sum)} ₽ без вывески в СберБизнесе."),
]
take_html = "".join(
    f'<div class="take"><div class="num">{n}</div><div><b>{t}</b><span>{s}</span></div></div>'
    for n, t, s in takes
)
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Октябрь</p><h2>Что делать</h2></div><img class="logo" src="{LOGO}" alt=""></div>
  <div class="grid3">{take_html}</div>
''', 18))

html = f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Imperial MC · Сентябрь 2026</title>
<style>{CSS}</style>
</head>
<body>
{"".join(slides)}
</body>
</html>
'''
(ROOT / "september-2026.html").write_text(html, encoding="utf-8")
print("slides", len(slides), "html", (ROOT / "september-2026.html").stat().st_size)

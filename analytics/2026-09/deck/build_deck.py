#!/usr/bin/env python3
"""Build Imperial MC September 2026 slide deck HTML."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
FIG = json.loads((ROOT.parent / "figures.json").read_text())
CARD = json.loads(Path("/tmp/analytics/card-shops.json").read_text())
POS = json.loads((ROOT.parent / "pos-dump.json").read_text())
LOGO = ROOT / "logo-white.png"
SHOP_RU = {
    "MAGAZIN DOBROTSEN": "Доброцен",
    "MAGAZIN CHAJKA": "Чайка",
    "MAGAZIN SOM": "магазин «Сом»",
    "MAGAZIN MYASNOJ": "Мясной",
    "MAGAZIN PRODUKTOV": "Магазин продуктов",
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
    if digits:
        s = f"{n:,.{digits}f}"
    else:
        s = f"{n:,.0f}"
    return s.replace(",", " ")

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

merch = CARD["by_merchant"]
buckets = CARD["by_bucket"]

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
street_sum = sum(a for _, a, _ in street)

unlab = [(m["name"], m["amount"], m["n"]) for m in merch if m["name"].startswith("CH450")]
unlab_sum = sum(a for _, a, _ in unlab)

# hour bars
def hours(venue):
    rows = [h for h in POS["HOUR"] if h["venue"] == venue]
    by = {}
    for h in rows:
        k = int(h["hour"])
        by[k] = by.get(k, 0) + float(h["revenue"])
    return by

oct_h = hours("Kebab King Октябрьская")
karl_h = hours("Kebab King Карла")
max_h = max(list(oct_h.values()) + list(karl_h.values()))

def hour_bars(data, color):
    parts = []
    for h in range(8, 24):
        v = data.get(h, 0)
        ht = 8 + (v / max_h) * 160 if max_h else 8
        parts.append(
            f'<div class="hbar"><div class="hbar-fill" style="height:{ht:.0f}px;background:{color}"></div>'
            f'<span>{h}</span></div>'
        )
    return "".join(parts)

# weekly
weeks = {}
for w in FIG["weeks"]:
    weeks.setdefault(w["week"], {})[w["venue"]] = w["revenue"]
week_ids = sorted(weeks)

def venue_week_row(name, color):
    cells = []
    vals = [weeks[w].get(name, 0) for w in week_ids]
    mx = max(vals) or 1
    for v in vals:
        cells.append(
            f'<div class="wbar"><div class="wbar-fill" style="height:{20+v/mx*90:.0f}px;background:{color}"></div>'
            f'<span>{r(v)}</span></div>'
        )
    return "".join(cells)

def share_bar(items):
    # items: (label, value, color)
    total = sum(v for _, v, _ in items) or 1
    html = '<div class="stack">'
    for label, v, c in items:
        html += f'<div class="stack-seg" style="width:{v/total*100:.2f}%;background:{c}" title="{label}"></div>'
    html += "</div>"
    return html

CSS = """
:root {
  --bg: #121214;
  --surface: #1b1b1f;
  --surface-2: #24242a;
  --border: #34343c;
  --text: #f1f1f3;
  --muted: #98979f;
  --accent: #2647c7;
  --accent-2: #3f63e6;
  --danger: #e14c4c;
  --ok: #3dbe8c;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #0c0c0e; }
@page { size: 1920px 1080px; margin: 0; }
.slide {
  width: 1920px;
  height: 1080px;
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', 'DejaVu Sans', sans-serif;
  padding: 56px 72px 48px;
  position: relative;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.slide::before {
  content: "";
  position: absolute; inset: 0 auto 0 0; width: 6px;
  background: linear-gradient(180deg, var(--accent-2), var(--accent));
}
.top {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 28px;
}
.eyebrow {
  font-family: 'Space Grotesk', 'DejaVu Sans', sans-serif;
  font-size: 13px; font-weight: 500; letter-spacing: .16em;
  text-transform: uppercase; color: var(--accent-2); margin: 0 0 6px;
}
h1 {
  font-family: 'Space Grotesk', 'DejaVu Sans', sans-serif;
  font-size: 44px; font-weight: 600; margin: 0; letter-spacing: -0.02em;
}
h2 {
  font-family: 'Space Grotesk', 'DejaVu Sans', sans-serif;
  font-size: 36px; font-weight: 600; margin: 0 0 8px;
}
.sub { color: var(--muted); font-size: 18px; margin: 8px 0 0; }
.logo { height: 42px; opacity: .92; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 28px 0; }
.kpis5 { grid-template-columns: repeat(5, 1fr); }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px 22px;
}
.card .l { color: var(--muted); font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }
.card .v {
  font-family: 'Space Grotesk', 'DejaVu Sans', sans-serif;
  font-size: 34px; font-weight: 600; margin-top: 8px;
}
.card .s { color: var(--muted); font-size: 14px; margin-top: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 16px; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: 13px;
  letter-spacing: .06em; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid var(--border); }
td { padding: 11px 12px; border-bottom: 1px solid #2a2a30; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.hi td { color: var(--accent-2); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; }
.note {
  background: #1a2038; border: 1px solid #2c3a78; border-radius: 10px;
  padding: 14px 18px; color: #c8d0f0; font-size: 15px; line-height: 1.45;
}
.warn {
  background: #2a1c1c; border: 1px solid #5a3030; color: #f0c8c8;
}
.oknote { background: #14241c; border: 1px solid #24543c; color: #c8f0dc; }
.foot {
  position: absolute; left: 72px; right: 72px; bottom: 28px;
  display: flex; justify-content: space-between; color: var(--muted); font-size: 13px;
}
.stack { display: flex; height: 18px; border-radius: 9px; overflow: hidden; background: var(--surface-2); }
.stack-seg { height: 100%; }
.legend { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 10px; color: var(--muted); font-size: 14px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.hours { display: flex; align-items: flex-end; gap: 8px; height: 200px; padding-top: 10px; }
.hbar { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 42px; }
.hbar-fill { width: 28px; border-radius: 6px 6px 2px 2px; }
.hbar span { color: var(--muted); font-size: 11px; }
.weeks { display: flex; align-items: flex-end; gap: 14px; height: 150px; }
.wbar { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 90px; }
.wbar-fill { width: 44px; border-radius: 8px 8px 2px 2px; }
.wbar span { color: var(--muted); font-size: 11px; }
.ul { margin: 8px 0 0; padding-left: 18px; color: var(--text); line-height: 1.55; font-size: 17px; }
.ul li { margin: 6px 0; }
.title-slide { display: flex; flex-direction: column; justify-content: center; padding-left: 110px; }
.title-slide h1 { font-size: 72px; line-height: 1.05; max-width: 1200px; }
.title-slide .underline { width: 56px; height: 3px; background: var(--accent-2); border-radius: 2px;
  box-shadow: 0 0 14px 2px rgba(63,99,230,.55); margin: 22px 0 18px; }
.biglist { font-size: 22px; line-height: 1.5; }
.two-col-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 40px; }
"""

def slide(body, num, total=18, title_slide=False):
    klass = "slide title-slide" if title_slide else "slide"
    return f'''<section class="{klass}">
{body}
<div class="foot"><span>Imperial MC · сентябрь 2026 · внутренняя аналитика</span><span>{num} / {total}</span></div>
</section>'''

slides = []

# 1 title
slides.append(slide(f'''
  <img class="logo" src="{LOGO.name}" alt="Imperial MC" style="height:64px;margin-bottom:36px">
  <p class="eyebrow">Аналитика сети</p>
  <h1>Сентябрь 2026</h1>
  <div class="underline"></div>
  <p class="sub" style="font-size:22px;max-width:980px">Выручка из кассы по пяти точкам. Движение денег — из выписки Сбера ИП. Карточные закупки в магазинах — то, что не берём у поставщика.</p>
  <p class="sub">1–30 сентября · Екатеринбург · 3 167 оплаченных чеков</p>
''', 1, title_slide=True))

# 2 network
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Сеть</p><h2>Месяц одним взглядом</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="kpis">
    <div class="card"><div class="l">Оплачено</div><div class="v">{r(T["paid"])} ₽</div><div class="s">субтотал {r(T["subtotal"])} · скидки {r(T["discount_total"])}</div></div>
    <div class="card"><div class="l">Карта / нал</div><div class="v">{pct(T["card_pct"])} / {pct(T["cash_pct"])}</div><div class="s">{r(T["card"])} · {r(T["cash"])} ₽</div></div>
    <div class="card"><div class="l">Чеки</div><div class="v">{r(T["paid_receipts"])}</div><div class="s">отмены {r(T["cancelled_receipts"])} · возвраты {r(T["refunded_receipts"])}</div></div>
    <div class="card"><div class="l">KK вместе</div><div class="v">86%</div><div class="s">{r(oct_["paid_total"]+karl["paid_total"])} ₽ · две точки кормят сеть</div></div>
  </div>
  {share_bar([
      ("Октябрьская", oct_["paid_total"], "#3f63e6"),
      ("Карла", karl["paid_total"], "#6f8cff"),
      ("Роза", rosa["paid_total"], "#8b7cff"),
      ("Гранд", grand["paid_total"], "#3dbe8c"),
      ("Puff", puff["paid_total"], "#98979f"),
  ])}
  <div class="legend">
    <span><i class="dot" style="background:#3f63e6"></i>Октябрьская {pct(oct_["share_pct"])}%</span>
    <span><i class="dot" style="background:#6f8cff"></i>Карла {pct(karl["share_pct"])}%</span>
    <span><i class="dot" style="background:#8b7cff"></i>Роза {pct(rosa["share_pct"])}%</span>
    <span><i class="dot" style="background:#3dbe8c"></i>Гранд {pct(grand["share_pct"])}%</span>
    <span><i class="dot" style="background:#98979f"></i>Puff {pct(puff["share_pct"])}%</span>
  </div>
  <p class="sub" style="margin-top:28px">Роза в ремонте, Гранд и Puff — с 15 сентября. Их месяц нельзя читать как «нормальный ранрейт».</p>
''', 2))

# 3 table
def row(v, hi=False):
    cls = ' class="hi"' if hi else ""
    return f'''<tr{cls}><td>{v["name"]}</td><td class="num">{r(v["paid_total"])}</td>
    <td class="num">{pct(v["share_pct"])}%</td><td class="num">{r(v["paid_receipts"])}</td>
    <td class="num">{r(v["avg_check"])} / {r(v["median_check"])}</td>
    <td class="num">{r(v["cancelled_receipts"])} ({pct(v["cancel_share_of_tickets_pct"])}%)</td>
    <td class="num">{r(v["discount_total"])}</td><td class="num">{r(v["avg_day"])}</td></tr>'''

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Разрез</p><h2>Пять точек, все цифры</h2></div><img class="logo" src="{LOGO.name}"></div>
  <table>
    <thead><tr><th>Точка</th><th class="num">Выручка</th><th class="num">Доля</th><th class="num">Чеки</th>
    <th class="num">Средний / мед.</th><th class="num">Отмены</th><th class="num">Скидки</th><th class="num">День</th></tr></thead>
    <tbody>
      {row(oct_, True)}{row(karl, True)}{row(rosa)}{row(grand)}{row(puff)}
    </tbody>
  </table>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><div class="l">Карта по точкам</div>
      <div class="s">Октябрьская {r(oct_["card"])} · Карла {r(karl["card"])} · Роза {r(rosa["card"])} · Гранд {r(grand["card"])} · Puff {r(puff["card"])}</div></div>
    <div class="card"><div class="l">Нал по точкам</div>
      <div class="s">Октябрьская {r(oct_["cash"])} · Карла {r(karl["cash"])} · Роза {r(rosa["cash"])} · Гранд {r(grand["cash"])} · Puff {r(puff["cash"])}</div></div>
  </div>
''', 3))

# 4 KK compare
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Kebab King</p><h2>Октябрьская в 1,88 раза больше Карла</h2>
  <p class="sub">Средний чек почти тот же. Ломается не меню — ритм дня.</p></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div class="card">
      <div class="l">Октябрьская</div>
      <div class="v">{r(oct_["paid_total"])} ₽</div>
      <ul class="ul">
        <li>1 790 чеков · 30 смен · день {r(oct_["avg_day"])} ₽</li>
        <li>мин {r(oct_["min_day"])} · макс {r(oct_["max_day"])}</li>
        <li>обед 11–16: {r(oct_["lunch_11_16"]["revenue"])} ₽ / {r(oct_["lunch_11_16"]["receipts"])} чеков</li>
        <li>вечер 17–23: {r(oct_["evening_17_23"]["revenue"])} ₽ / {r(oct_["evening_17_23"]["receipts"])} чеков</li>
        <li>напиток на чек <b>{oct_["attach"]["drinks_per_ticket"]}</b> · фри {oct_["attach"]["fries_per_ticket"]}</li>
        <li>скидки {r(oct_["discount_total"])} ₽ · отмены 3%</li>
      </ul>
    </div>
    <div class="card">
      <div class="l">Карла</div>
      <div class="v">{r(karl["paid_total"])} ₽</div>
      <ul class="ul">
        <li>1 026 чеков · 31 смена (одна открыта 30.09)</li>
        <li>мин {r(karl["min_day"])} · макс {r(karl["max_day"])} · день {r(karl["avg_day"])}</li>
        <li>обед 11–16: {r(karl["lunch_11_16"]["revenue"])} ₽ / {r(karl["lunch_11_16"]["receipts"])} чеков</li>
        <li>вечер 17–23: {r(karl["evening_17_23"]["revenue"])} ₽ / {r(karl["evening_17_23"]["receipts"])} чеков</li>
        <li>напиток на чек <b>{karl["attach"]["drinks_per_ticket"]}</b> · фри {karl["attach"]["fries_per_ticket"]}</li>
        <li>плюс 32 тыс. после полуночи — точка вечерняя</li>
      </ul>
    </div>
  </div>
''', 4))

# 5 hours
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Часы</p><h2>Октябрьская живёт весь день, Карла — с вечера</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div>
      <div class="l" style="color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-size:13px">Октябрьская</div>
      <div class="hours">{hour_bars(oct_h, "#3f63e6")}</div>
    </div>
    <div>
      <div class="l" style="color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-size:13px">Карла</div>
      <div class="hours">{hour_bars(karl_h, "#8b7cff")}</div>
    </div>
  </div>
  <div class="note" style="margin-top:28px">Пики Октябрьской — 12–13 и 20:00. Карла разгоняется после 17 и держит хвост до часа ночи. Если днём у входа на Карла есть люди — их недобираем. Если района днём нет — не ждать паритета тем же меню.</div>
''', 5))

# 6 mix
oct_items = oct_["top_items"]
karl_items = karl["top_items"]
def items_table(items):
    rows = "".join(
        f'<tr><td>{i["name"]}</td><td class="num">{r(i["qty"])}</td><td class="num">{r(i["revenue"])}</td></tr>'
        for i in items[:8]
    )
    return f'<table><thead><tr><th>Позиция</th><th class="num">Шт</th><th class="num">₽</th></tr></thead><tbody>{rows}</tbody></table>'

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Номенклатура KK</p><h2>Шаурма 63–68%, курица / свинина 60 / 40</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div class="card"><div class="l">Октябрьская · топ</div>{items_table(oct_items)}</div>
    <div class="card"><div class="l">Карла · топ</div>{items_table(karl_items)}</div>
  </div>
  <p class="sub" style="margin-top:16px">Комбо на Октябрьской: 10 наборов / 5 500 ₽ за месяц — наборами не торгуем. Дипы 0,13 и 0,12 на чек, фри одинаково 0,22–0,23. Дыра Карла — напиток (0,24 vs 0,35).</p>
''', 6))

# 7 shifts KK
def openers(v):
    rows = "".join(
        f'<tr><td>{o["name"]}</td><td class="num">{o["shifts"]}</td><td class="num">{r(o["revenue"])}</td><td class="num">{r(o["avg_shift"])}</td></tr>'
        for o in v["shift_openers"]
    )
    return f'<table><thead><tr><th>Кто открывал</th><th class="num">Смен</th><th class="num">Выручка</th><th class="num">На смену</th></tr></thead><tbody>{rows}</tbody></table>'

slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Смены KK</p><h2>Кто держал кассу</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div class="card"><div class="l">Октябрьская</div>{openers(oct_)}</div>
    <div class="card"><div class="l">Карла</div>{openers(karl)}</div>
  </div>
  <div class="note" style="margin-top:22px">Октябрьская ровная: Алёна чуть сильнее Умиды. На Карла Егор выше Андрея — часть разницы может быть графиком, не навыком. Смена #153 Егора на 30.09 ещё была открыта в выгрузке.</div>
''', 7))

# 8 rosa
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">MC Lounge Роза</p><h2>Ремонт. Зал на постоянниках. Списания — свои.</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="kpis">
    <div class="card"><div class="l">Оплачено</div><div class="v">{r(rosa["paid_total"])} ₽</div><div class="s">по меню {r(rosa["subtotal"])}</div></div>
    <div class="card"><div class="l">Чеки</div><div class="v">{r(rosa["paid_receipts"])}</div><div class="s">средний {r(rosa["avg_check"])} · мед. {r(rosa["median_check"])}</div></div>
    <div class="card"><div class="l">Постоянники</div><div class="v">38 чаш</div><div class="s">28 500 ₽ · база, на которой зал стоит</div></div>
    <div class="card"><div class="l">Классика</div><div class="v">67 чаш</div><div class="s">77 050 ₽ гостевых по полной</div></div>
  </div>
  <div class="grid2">
    <div class="oknote">Списания под начальство (85 чаш стафф, 35 чеков по 100% на 54 600 ₽) — это мы, не дыра. В сентябре так и должно быть видно в кассе.</div>
    <div class="note">Отмены 41 к 142. Баг учёта: отмена не возвращает табак на склад — ревизия будет расходиться. Это не «кто-то ворует».</div>
  </div>
  <p class="sub" style="margin-top:18px">Пик 21:00–01:00. Дарья 15 смен / 73 тыс., Тимур 11 / 30 тыс. Пиво в чеках 13,8 тыс. при Регионпиве 47 тыс. — закуп впрок или несколько точек, сверить приход. Смотреть Розу снова после ремонта: появился ли гость сверх этой базы.</p>
''', 8))

# 9 grand puff
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Новые точки · с 15 сентября</p><h2>Гранд нащупал ядро, Puff пока дежурит</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div class="card">
      <div class="l">MC Гранд · 16 дней</div>
      <div class="v">{r(grand["paid_total"])} ₽</div>
      <ul class="ul">
        <li>192 чека · день {r(grand["avg_day"])} · медиана 380 ₽</li>
        <li>Ядро: карбонара 48 / 17,8 тыс., цезарь, капучино 44, американо 40</li>
        <li>25–27.09 всплеск: 10,7 + <b>17,1</b> + 8,6 тыс. — разбирать и повторять</li>
        <li>После 20:00 точка почти пустая</li>
        <li>19 чеков по 100% / 16 430 ₽ на старте</li>
        <li>Все 16 смен открывала Дёмкина</li>
      </ul>
    </div>
    <div class="card">
      <div class="l">Puff · 14 смен</div>
      <div class="v">{r(puff["paid_total"])} ₽</div>
      <ul class="ul">
        <li>17 чеков · 18 классических чаш по 1 500</li>
        <li>Шесть смен из четырнадцати — ноль</li>
        <li>Суббота живее (8 чаш), будни часто пустые</li>
        <li>28 сентября смены не было</li>
        <li>Пока нет трафика — не кормить отдельной сменой каждый день</li>
      </ul>
    </div>
  </div>
''', 9))

# 10 bank official
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Выписка Сбера · официальные итоги</p><h2>Пришло 1,97 млн · ушло 1,89 млн</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="kpis">
    <div class="card"><div class="l">Входящий</div><div class="v">{r(B["official"]["opening_balance"], 2)}</div></div>
    <div class="card"><div class="l">Кредит · 220 оп.</div><div class="v">{r(B["official"]["credit_turnover"], 2)}</div><div class="s">эквайринг и прочие зачисления</div></div>
    <div class="card"><div class="l">Дебет · 918 оп.</div><div class="v">{r(B["official"]["debit_turnover"], 2)}</div><div class="s">поставщики, выводы, магазины, вклад</div></div>
    <div class="card"><div class="l">Исходящий</div><div class="v">{r(B["official"]["closing_balance"], 2)}</div></div>
  </div>
  <div class="note">Эквайринг нетто по мерчантам ≈ {r(B["acquiring_net_by_merchant_approx"]["total"])} ₽ при карте в POS {r(T["card"])} ₽. Разница — комиссия ~2,5–2,7%, T+1 и 30-е. Мерчант …64405 почти рубль в рубль совпал с Карла. Нал {r(T["cash"])} ₽ из кассы в выписку не попадает. Переводы во вклад — не расход.</div>
  <p class="sub" style="margin-top:18px">PDF повёрнут: контрагенты ниже — ориентир. Официальные обороты сняты с последней страницы и сходятся.</p>
''', 10))

# 11 owner / payroll
od = B["predprinimatelskiy_dohod_to_demkina"]
def draw_row(o):
    cls = ' class="hi"' if o["role"] == "payroll_window" else ""
    role = "зарплатное окно" if o["role"] == "payroll_window" else "себе"
    return f'<tr{cls}><td>{o["date"][8:10]}.09</td><td class="num">{r(o["amount"])}</td><td>{role}</td></tr>'

rows = "".join(draw_row(o) for o in od["ops"])
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Выводы со счёта</p><h2>«Доход от предпринимательской» = заработкок</h2>
  <p class="sub">Кроме 15–16 числа — это чаще зарплаты. 16-го вывода не было.</p></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div class="card" style="max-height:720px;overflow:hidden">
      <table><thead><tr><th>Дата</th><th class="num">Сумма</th><th>Как читаем</th></tr></thead><tbody>{rows}</tbody></table>
    </div>
    <div>
      <div class="card" style="margin-bottom:14px"><div class="l">Себе за месяц</div><div class="v">{r(od["owner_ex_15_16"])} ₽</div><div class="s">без 58 000 ₽ 15 сентября</div></div>
      <div class="card" style="margin-bottom:14px"><div class="l">Белый ФОТ 15.09</div><div class="v">{r(18620+78870)} ₽</div><div class="s">реестр 77 — 18 620 · реестр 76 — 78 870 · договор 83390253</div></div>
      <div class="card"><div class="l">Если 58 тыс. тоже зарплата</div><div class="v">{r(B["payroll_visible_if_15th_draw_is_salary"])} ₽</div><div class="s">видимое окно середины месяца. Краснобродская 80,6 тыс. 14.09 рядом, статью не размечали.</div></div>
    </div>
  </div>
''', 11))

# 12 suppliers
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Поставщики · безнал</p><h2>То, что берём по счетам</h2></div><img class="logo" src="{LOGO.name}"></div>
  <table>
    <thead><tr><th>Контрагент</th><th class="num">Сумма</th><th>Платежей</th><th>Комментарий</th></tr></thead>
    <tbody>
      <tr><td>ООО «МАРР Россия»</td><td class="num">354 087</td><td>7</td><td>Основной продуктовый контур KK</td></tr>
      <tr><td>ООО «Мистер Крабс»</td><td class="num">66 654</td><td>4</td><td>Регулярный поставщик в течение месяца</td></tr>
      <tr><td>ООО «Регионпиво»</td><td class="num">47 118</td><td>1</td><td>5.09 · пиво в чеках Розы ~13,8 тыс.</td></tr>
      <tr><td>ООО «Курьер Плюс»</td><td class="num">17 430</td><td>1</td><td>8.09</td></tr>
      <tr><td>ООО РВБ / Wildberries Bank</td><td class="num">16 909</td><td>1</td><td>Счёт на товары, отдельно от карты WB</td></tr>
      <tr><td>ООО «Доксинбокс»</td><td class="num">5 160</td><td>1</td><td>Сервис документов</td></tr>
    </tbody>
  </table>
  <p class="sub" style="margin-top:22px">Итого узнаваемых счетов ≈ 507 тыс. Это не вся себестоимость: часть еды, химии и мелочи уходит картой в магазины — следующий слайд.</p>
''', 12))

# 13 street intro
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Карта ИП · магазины</p><h2>Закуп, который нельзя закрыть поставщиком</h2>
  <p class="sub">Срочно, мелко, нет в прайсе МАРР, другой город, упаковка, алкоголь в рознице, бытовое.</p></div><img class="logo" src="{LOGO.name}"></div>
  <div class="kpis kpis5">
    <div class="card"><div class="l">Улица / еда</div><div class="v">{r(street_sum)}</div><div class="s">Пятёрочка, Магнит, Монетка, локальные</div></div>
    <div class="card"><div class="l">Упаковка и расходники</div><div class="v">{r(buckets.get("pack",{}).get("amount",0))}</div><div class="s">Мир упаковки, Fix Price, Клади-пакуй</div></div>
    <div class="card"><div class="l">Красное &amp; Белое</div><div class="v">{r(merch_amt("Красное & Белое"))}</div><div class="s">{merch_n("Красное & Белое")} покупок · розница к Регионпиву</div></div>
    <div class="card"><div class="l">Маркетплейсы</div><div class="v">{r(merch_amt("Wildberries")+merch_amt("YM*avito"))}</div><div class="s">WB карта + Avito, плюс счёт РВБ 16,9 тыс.</div></div>
    <div class="card"><div class="l">Без названия CH450</div><div class="v">{r(unlab_sum)}</div><div class="s">Сбер обрезал имя точки в выписке</div></div>
  </div>
  <div class="note warn">Суммы карточных покупок собраны с повёрнутого PDF: мерчант + следующая операция VO 17. Это ориентир, не сверка 1:1 с банком. Официальный дебет месяца — 1 885 929 ₽, в нём ещё вклад, МАРР, ФОТ и выводы.</div>
  <p class="sub" style="margin-top:18px">Имеет смысл завести статью «розничный добор» и не смешивать её с МАРР. Это нормальный opex общепита, просто дороже счёта поставщика.</p>
''', 13))

# 14 street detail
street_rows = "".join(
    f'<tr><td>{n}</td><td class="num">{nn}</td><td class="num">{r(a)}</td><td class="num">{r(a/nn) if nn else "—"}</td></tr>'
    for n,a,nn in sorted(street, key=lambda x:-x[1])
)
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Розничный добор еды</p><h2>Пятёрочка, Магнит, Монетка и локальные</h2>
  <p class="sub">Сумма {r(street_sum)} ₽ · {sum(n for _,_,n in street)} покупок. Типичный чек 400–550 ₽ — докупка, не фура.</p></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <table>
      <thead><tr><th>Магазин</th><th class="num">Чеков</th><th class="num">₽</th><th class="num">Средний</th></tr></thead>
      <tbody>{street_rows}</tbody>
    </table>
    <div>
      <div class="card" style="margin-bottom:14px"><div class="l">Три сети</div>
        <div class="s">Пятёрочка {r(merch_amt("Пятёрочка"))} / {merch_n("Пятёрочка")} чеков<br>
        Магнит {r(merch_amt("Магнит"))} / {merch_n("Магнит")}<br>
        Монетка {r(merch_amt("Монетка"))} / {merch_n("Монетка")}</div></div>
      <div class="oknote">Это как раз закуп, который у МАРР не взять: зелень к вечеру, молоко, мелочь на смену, то что кончилось в зале. Не путать с «личными тратами», пока не разметим карту. Часть чеков наверняка смешанная.</div>
    </div>
  </div>
''', 14))

# 15 pack alcohol wb
pack_rows = f'''
<tr><td>Мир упаковки</td><td class="num">{merch_n("Мир упаковки")}</td><td class="num">{r(merch_amt("Мир упаковки"))}</td><td>Крупные завозы 7.09 / 14.09 / 28.09 (19,7 · 12,3 · 21,9 тыс.)</td></tr>
<tr><td>Fix Price</td><td class="num">{merch_n("Fix Price")}</td><td class="num">{r(merch_amt("Fix Price"))}</td><td>Расходники, пакеты, бытовое · 4 точки</td></tr>
<tr><td>Клади-пакуй</td><td class="num">{merch_n("Клади-пакуй")}</td><td class="num">{r(merch_amt("Клади-пакуй"))}</td><td>Упаковка</td></tr>
<tr><td>Galamart</td><td class="num">{merch_n("GALAMART")}</td><td class="num">{r(merch_amt("GALAMART"))}</td><td></td></tr>
<tr><td>Красное &amp; Белое</td><td class="num">{merch_n("Красное & Белое")}</td><td class="num">{r(merch_amt("Красное & Белое"))}</td><td>Розн. алкоголь к счёту Регионпива</td></tr>
<tr><td>Wildberries карта</td><td class="num">{merch_n("Wildberries")}</td><td class="num">{r(merch_amt("Wildberries"))}</td><td>Плюс счёт РВБ 16 909 ₽</td></tr>
<tr><td>Avito</td><td class="num">{merch_n("YM*avito")}</td><td class="num">{r(merch_amt("YM*avito"))}</td><td></td></tr>
<tr><td>Tabysh</td><td class="num">{merch_n("Tabysh")}</td><td class="num">{r(merch_amt("Tabysh"))}</td><td>Локальная точка, 10 чеков</td></tr>
'''
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Упаковка · алкоголь · маркетплейсы</p><h2>Крупнее продуктового добора</h2></div><img class="logo" src="{LOGO.name}"></div>
  <table>
    <thead><tr><th>Где</th><th class="num">Чеков</th><th class="num">₽</th><th>Заметка</th></tr></thead>
    <tbody>{pack_rows}</tbody>
  </table>
  <p class="sub" style="margin-top:20px">Мир упаковки + Fix Price ≈ {r(merch_amt("Мир упаковки")+merch_amt("Fix Price"))} ₽. Это уже не «заскочил в пятёрочку», а отдельная статья. К&amp;Б {r(merch_amt("Красное & Белое"))} рядом с Регионпивом 47 тыс. — либо срочный добор, либо ассортимент, которого нет у оптовика.</p>
''', 15))

# 16 unlabeled + yandex + services
ch_rows = "".join(
    f'<tr><td>{n}</td><td class="num">{nn}</td><td class="num">{r(a)}</td></tr>'
    for n,a,nn in sorted(unlab, key=lambda x:-x[1])
)
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Что выписка не назвала</p><h2>Терминалы CH450xx и сервисы</h2>
  <p class="sub">Сбер в назначении пишет код точки, не вывеску. {r(unlab_sum)} ₽ — скорее ещё розница, не переводы.</p></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid2">
    <div class="card">
      <div class="l">Обрезанные имена</div>
      <table><thead><tr><th>Код</th><th class="num">Чеков</th><th class="num">₽</th></tr></thead><tbody>{ch_rows}</tbody></table>
    </div>
    <div>
      <div class="card" style="margin-bottom:14px"><div class="l">Яндекс</div>
        <div class="v">{r(merch_amt("Яндекс (5814)")+merch_amt("Яндекс (директ?)")+merch_amt("Яндекс Плюс"))}</div>
        <div class="s">5814 — {r(merch_amt("Яндекс (5814)"))} · директ? {r(merch_amt("Яндекс (директ?)"))} · Плюс {r(merch_amt("Яндекс Плюс"))}. Не размечали: реклама / доставка / лавка.</div></div>
      <div class="card" style="margin-bottom:14px"><div class="l">Сервисы</div>
        <div class="s">CK*PAYTOOL {r(merch_amt("CK*PAYTOOL"))} · Timeweb {r(merch_amt("TIMEWEB.CLOUD"))} · ваучер {r(merch_amt("VP*VAUCHER"))} · стоматология {r(merch_amt("STOMATOLOGIYA TARI"))} · T2 / VK — мелочь. Часть явно личная.</div></div>
      <div class="note">Если открыть в СберБизнесе оригинальные имена CH450 — розничный добор, скорее всего, вырастет. Это следующий уточняющий файл, не дыра.</div>
    </div>
  </div>
''', 16))

# 17 money map
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Карта месяца</p><h2>Куда уехали безнал-деньги, которые мы видим</h2></div><img class="logo" src="{LOGO.name}"></div>
  <div class="grid3">
    <div class="card"><div class="l">Себе</div><div class="v">{r(od["owner_ex_15_16"])}</div><div class="s">доход от предпр. без 15.09</div></div>
    <div class="card"><div class="l">ФОТ видимый</div><div class="v">{r(18620+78870)}</div><div class="s">реестры Сбера 15.09 · плюс возможно 58 тыс.</div></div>
    <div class="card"><div class="l">МАРР + Крабс</div><div class="v">{r(354087+66654)}</div><div class="s">основной продуктовый контур</div></div>
    <div class="card"><div class="l">Пиво опт + К&amp;Б</div><div class="v">{r(47118+merch_amt("Красное & Белое"))}</div><div class="s">Регионпиво и розница</div></div>
    <div class="card"><div class="l">Упаковка</div><div class="v">{r(merch_amt("Мир упаковки")+merch_amt("Fix Price")+merch_amt("Клади-пакуй"))}</div><div class="s">счета + карта</div></div>
    <div class="card"><div class="l">Магазины еды</div><div class="v">{r(street_sum)}</div><div class="s">добор, которого нет у поставщика</div></div>
  </div>
  <div class="note" style="margin-top:22px">Не хватает аренды, полного ФОТа наличными, коммуналки и налогов. Пока это карта безнала, не P&amp;L точек. Нал кассы {r(T["cash"])} ₽ живёт отдельно.</div>
''', 17))

# 18 takeaways
slides.append(slide(f'''
  <div class="top"><div><p class="eyebrow">Октябрь</p><h2>Что делать, а что не трогать</h2></div><img class="logo" src="{LOGO.name}"></div>
  <ul class="ul biglist">
    <li><b>Октябрьскую не ломать.</b> 56% сети, ровный месяц, обед = вечер.</li>
    <li><b>Карла — день и напиток.</b> Вечер уже есть. 0,24 напитка на чек vs 0,35 на Октябрьской. Комбо не работает.</li>
    <li><b>Розу не лечить.</b> Ремонт, постоянники, списания на своих. Смотреть после открытия зала.</li>
    <li><b>Гранд — ядро меню</b> (карбонара, цезарь, капучино) и пик 26.09. Puff не кормить пустыми сменами.</li>
    <li><b>Розничный добор завести статьёй.</b> Пятёрочка / Магнит / Монетка {r(merch_amt("Пятёрочка")+merch_amt("Магнит")+merch_amt("Монетка"))} ₽ — нормальный opex, не «непонятные траты».</li>
    <li><b>Открыть имена CH450</b> в СберБизнесе — там ещё {r(unlab_sum)} ₽ без вывески.</li>
  </ul>
''', 18))

html = f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Imperial MC · Сентябрь 2026</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
{"".join(slides)}
</body>
</html>
'''

out = ROOT / "september-2026.html"
out.write_text(html, encoding="utf-8")
print("wrote", out, "slides", len(slides))

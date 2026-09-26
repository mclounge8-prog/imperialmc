(function () {
  'use strict';

  var TOKEN_KEY = 'imperial-mc:kiosk-device-token';
  var API = '';
  var UNIT = { g: 'г', ml: 'мл', pcs: 'шт' };
  var STATUS_LABEL = {
    new: 'Принято',
    cooking: 'Готовится',
    ready: 'Готово',
    issued: 'Выдано',
    cancelled: 'Отменено',
  };

  var state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    screen: 'boot',
    bootstrap: null,
    menu: null,
    categoryId: null,
    cart: [],
    customize: null,
    ticket: null,
    error: '',
    code: '',
    busy: false,
  };
  var pollTimer = null;

  function $(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) {
    return Math.round(Number(n) || 0) + ' ₽';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    var res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    var data = {};
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok) {
      var err = new Error(data.error || 'Ошибка запроса');
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function flattenCats(cats, acc) {
    acc = acc || [];
    (cats || []).forEach(function (c) {
      acc.push(c);
      flattenCats(c.children, acc);
    });
    return acc;
  }

  function itemsInCategory(catId) {
    if (!state.menu) return [];
    if (catId === 'uncat') return state.menu.uncategorized || [];
    var found = null;
    flattenCats(state.menu.categories).some(function (c) {
      if (c.id === catId) {
        found = c;
        return true;
      }
      return false;
    });
    if (!found) return [];
    var items = (found.items || []).slice();
    (found.children || []).forEach(function (child) {
      items = items.concat(child.items || []);
    });
    return items;
  }

  function defaultIds(item) {
    var ids = [];
    (item.modifierGroups || []).forEach(function (g) {
      (g.options || []).forEach(function (o) {
        if (o.isDefault) ids.push(o.modifierId);
      });
    });
    return ids;
  }

  function linePrice(item, ids) {
    var extra = 0;
    var set = {};
    (ids || []).forEach(function (id) {
      set[id] = true;
    });
    (item.modifierGroups || []).forEach(function (g) {
      (g.options || []).forEach(function (o) {
        if (set[o.modifierId]) extra += Number(o.price) || 0;
      });
    });
    return Number(item.price) + extra;
  }

  function lineModsText(item, ids) {
    var set = {};
    (ids || []).forEach(function (id) {
      set[id] = true;
    });
    var names = [];
    (item.modifierGroups || []).forEach(function (g) {
      (g.options || []).forEach(function (o) {
        if (set[o.modifierId]) names.push(o.name);
      });
    });
    return names.join(', ');
  }

  function cartTotal() {
    return state.cart.reduce(function (sum, line) {
      return sum + line.unitPrice * line.qty;
    }, 0);
  }

  function needsCustomize(item) {
    return (item.modifierGroups || []).some(function (g) {
      return g.id != null || (g.options || []).some(function (o) {
        return !o.isDefault;
      });
    });
  }

  function setScreen(name) {
    state.screen = name;
    render();
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll(fn, ms) {
    stopPoll();
    pollTimer = setInterval(fn, ms);
  }

  async function refreshBootstrap() {
    if (!state.token) return;
    try {
      state.bootstrap = await api('/api/kiosk/bootstrap');
      state.error = '';
      if (state.bootstrap.ready && (state.screen === 'wait' || state.screen === 'boot')) {
        await loadMenu();
        setScreen('menu');
        return;
      }
      if (!state.bootstrap.ready && state.screen === 'menu') {
        setScreen('wait');
        return;
      }
      render();
    } catch (e) {
      if (e.status === 401) {
        clearToken();
        return;
      }
      state.error = e.message;
      render();
    }
  }

  async function loadMenu() {
    state.menu = await api('/api/kiosk/menu');
    var cats = flattenCats(state.menu.categories);
    if (!state.categoryId) {
      state.categoryId = cats[0] ? cats[0].id : 'uncat';
    }
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    state.bootstrap = null;
    state.menu = null;
    state.cart = [];
    state.ticket = null;
    stopPoll();
    setScreen('register');
  }

  async function register() {
    var code = (state.code || '').trim().toUpperCase();
    if (!code) {
      state.error = 'Введи код из бэкофиса';
      render();
      return;
    }
    state.busy = true;
    state.error = '';
    render();
    try {
      var data = await api('/api/devices/register', { method: 'POST', body: { code: code, kind: 'kiosk' } });
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      state.busy = false;
      setScreen('wait');
      await refreshBootstrap();
      startPoll(refreshBootstrap, 4000);
    } catch (e) {
      state.busy = false;
      state.error = e.message;
      render();
    }
  }

  function openCustomize(item) {
    state.customize = { item: item, ids: defaultIds(item) };
    render();
  }

  function toggleMod(group, opt) {
    var ids = state.customize.ids.slice();
    var isOn = ids.indexOf(opt.modifierId) >= 0;
    var isRadio = group.maxSelect === 1;
    if (isRadio) {
      ids = ids.filter(function (id) {
        return !group.options.some(function (o) {
          return o.modifierId === id;
        });
      });
      if (!isOn) ids.push(opt.modifierId);
    } else if (isOn) {
      ids = ids.filter(function (id) {
        return id !== opt.modifierId;
      });
    } else {
      var selectedInGroup = group.options.filter(function (o) {
        return ids.indexOf(o.modifierId) >= 0;
      }).length;
      if (group.maxSelect != null && selectedInGroup >= group.maxSelect) return;
      ids.push(opt.modifierId);
    }
    state.customize.ids = ids;
    render();
  }

  function addToCart(item, ids) {
    var unitPrice = linePrice(item, ids);
    var key = item.id + ':' + ids.slice().sort().join(',');
    var existing = state.cart.find(function (l) {
      return l.key === key;
    });
    if (existing) existing.qty += 1;
    else {
      state.cart.push({
        key: key,
        item: item,
        modifierIds: ids.slice(),
        unitPrice: unitPrice,
        qty: 1,
      });
    }
    state.customize = null;
    render();
  }

  function changeQty(key, delta) {
    state.cart = state.cart
      .map(function (l) {
        if (l.key !== key) return l;
        return Object.assign({}, l, { qty: l.qty + delta });
      })
      .filter(function (l) {
        return l.qty > 0;
      });
    render();
  }

  async function submitCart() {
    if (!state.cart.length || state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    try {
      var data = await api('/api/kiosk/tickets', {
        method: 'POST',
        body: {
          items: state.cart.map(function (l) {
            return { menuItemId: l.item.id, qty: l.qty, modifierIds: l.modifierIds };
          }),
        },
      });
      state.ticket = data.ticket;
      state.cart = [];
      state.busy = false;
      setScreen('ticket');
      startPoll(refreshTicket, 3000);
    } catch (e) {
      state.busy = false;
      state.error = e.message;
      if (e.code === 'SHIFT_CLOSED' || e.code === 'KIOSK_DISABLED') {
        setScreen('wait');
        startPoll(refreshBootstrap, 4000);
        return;
      }
      render();
    }
  }

  async function refreshTicket() {
    if (!state.ticket) return;
    try {
      var data = await api('/api/kiosk/tickets/' + state.ticket.id);
      state.ticket = data.ticket;
      render();
      if (state.ticket.status === 'issued' || state.ticket.status === 'cancelled') {
        stopPoll();
      }
    } catch (_) {}
  }

  function newOrder() {
    state.ticket = null;
    state.error = '';
    setScreen('menu');
    startPoll(refreshBootstrap, 8000);
  }

  function renderRegister() {
    var root = el('div', 'screen');
    var card = el('div', 'center-card');
    card.appendChild(el('p', 'eyebrow', 'Самообслуживание'));
    var img = el('img');
    img.src = '/img/logo-white.webp?v=imc4';
    img.alt = 'Imperial MC';
    card.appendChild(img);
    card.appendChild(el('h1', null, 'Киоск'));
    card.appendChild(
      el(
        'p',
        null,
        'Открой бэкофис → Устройства → сгенерируй код, введи его здесь. Затем назначь заведение и включи «Киоск самообслуживания» на карточке точки.'
      )
    );
    var input = el('input');
    input.maxLength = 8;
    input.placeholder = 'КОД';
    input.autocomplete = 'off';
    input.value = state.code;
    input.addEventListener('input', function (e) {
      state.code = e.target.value.toUpperCase();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') register();
    });
    card.appendChild(input);
    var btn = el('button', 'btn', state.busy ? 'Регистрация…' : 'Подключить');
    btn.disabled = state.busy;
    btn.addEventListener('click', register);
    card.appendChild(btn);
    card.appendChild(el('div', 'error', state.error || ''));
    root.appendChild(card);
    return root;
  }

  function waitReason() {
    var b = state.bootstrap;
    if (!b) return 'Проверяю устройство…';
    if (!b.active) return 'Устройство деактивировано в бэкофисе';
    if (b.kind !== 'kiosk') return 'Тип устройства — не киоск. Смени на «Киоск» в разделе Устройства.';
    if (!b.venue) return 'Назначь заведение этому устройству в бэкофисе';
    if (!b.venue.kioskEnabled) return 'На заведении «' + b.venue.name + '» киоск выключен. Включи чекбокс на карточке заведения.';
    if (!b.shiftOpen) return 'Смена закрыта. Открой смену на терминале официанта.';
    return 'Готово';
  }

  function renderWait() {
    var root = el('div', 'screen');
    var card = el('div', 'center-card');
    card.appendChild(el('p', 'eyebrow', 'Киоск'));
    card.appendChild(el('h1', null, 'Ожидание'));
    card.appendChild(el('div', 'wait-status', waitReason()));
    card.appendChild(
      el('p', null, 'Как только смена открыта и киоск включён на заведении — меню откроется само.')
    );
    var reset = el('button', 'btn btn-ghost', 'Сбросить устройство');
    reset.addEventListener('click', clearToken);
    card.appendChild(reset);
    card.appendChild(el('div', 'error', state.error || ''));
    root.appendChild(card);
    return root;
  }

  function renderCustomize() {
    var c = state.customize;
    if (!c) return null;
    var wrap = el('div', 'modal');
    var panel = el('div', 'modal-panel');
    panel.appendChild(el('h3', null, c.item.name));
    panel.appendChild(el('p', null, money(linePrice(c.item, c.ids))));
    (c.item.modifierGroups || []).forEach(function (g) {
      var box = el('div', 'group');
      var limit = '';
      if (g.minSelect || g.maxSelect) {
        limit = ' · ' + (g.minSelect || 0) + '–' + (g.maxSelect == null ? '∞' : g.maxSelect);
      }
      box.appendChild(el('div', 'group-title', g.name + limit));
      (g.options || []).forEach(function (o) {
        var on = c.ids.indexOf(o.modifierId) >= 0;
        var btn = el('button', 'opt' + (on ? ' is-on' : '') + (g.maxSelect === 1 ? ' is-radio' : ''));
        btn.appendChild(el('span', 'box'));
        btn.appendChild(el('span', null, o.name));
        var meta = [];
        if (o.qty > 0 && o.unit) meta.push(o.qty + ' ' + (UNIT[o.unit] || o.unit));
        if (o.price > 0) meta.push('+' + money(o.price));
        btn.appendChild(el('span', 'meta', meta.join(' · ')));
        btn.addEventListener('click', function () {
          toggleMod(g, o);
        });
        box.appendChild(btn);
      });
      panel.appendChild(box);
    });
    var actions = el('div', 'modal-actions');
    var cancel = el('button', 'btn btn-ghost', 'Отмена');
    cancel.addEventListener('click', function () {
      state.customize = null;
      render();
    });
    var ok = el('button', 'btn', 'В заказ · ' + money(linePrice(c.item, c.ids)));
    ok.addEventListener('click', function () {
      var missing = (c.item.modifierGroups || []).find(function (g) {
        var count = g.options.filter(function (o) {
          return c.ids.indexOf(o.modifierId) >= 0;
        }).length;
        return g.minSelect > 0 && count < g.minSelect;
      });
      if (missing) {
        state.error = 'Выбери обязательные опции: ' + missing.name;
        render();
        return;
      }
      state.error = '';
      addToCart(c.item, c.ids);
    });
    actions.appendChild(cancel);
    actions.appendChild(ok);
    panel.appendChild(actions);
    if (state.error) panel.appendChild(el('div', 'error', state.error));
    wrap.appendChild(panel);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) {
        state.customize = null;
        render();
      }
    });
    return wrap;
  }

  function renderMenu() {
    var root = el('div', 'kiosk-shell');
    var main = el('div', 'kiosk-main');
    var top = el('div', 'kiosk-top');
    var img = el('img');
    img.src = '/img/logo-white.webp?v=imc4';
    img.alt = 'Imperial MC';
    img.title = 'Долгое нажатие сбрасывает устройство';
    var pressTimer = null;
    img.addEventListener('pointerdown', function () {
      pressTimer = setTimeout(clearToken, 1400);
    });
    img.addEventListener('pointerup', function () {
      clearTimeout(pressTimer);
    });
    img.addEventListener('pointerleave', function () {
      clearTimeout(pressTimer);
    });
    top.appendChild(img);
    top.appendChild(el('div', 'venue', (state.bootstrap && state.bootstrap.venue && state.bootstrap.venue.name) || 'Киоск'));
    top.appendChild(el('div', 'muted', 'Самообслуживание'));
    main.appendChild(top);

    var cats = flattenCats((state.menu && state.menu.categories) || []);
    var catRow = el('div', 'cats');
    cats.forEach(function (c) {
      var chip = el('button', 'cat-chip' + (state.categoryId === c.id ? ' is-on' : ''), c.name);
      chip.addEventListener('click', function () {
        state.categoryId = c.id;
        render();
      });
      catRow.appendChild(chip);
    });
    if ((state.menu && state.menu.uncategorized && state.menu.uncategorized.length) || !cats.length) {
      var un = el('button', 'cat-chip' + (state.categoryId === 'uncat' ? ' is-on' : ''), 'Ещё');
      un.addEventListener('click', function () {
        state.categoryId = 'uncat';
        render();
      });
      catRow.appendChild(un);
    }
    main.appendChild(catRow);

    var grid = el('div', 'items');
    itemsInCategory(state.categoryId).forEach(function (item) {
      var card = el('button', 'item-card');
      var pic = el('div', 'pic', '🍽');
      if (item.imageUrl) pic.style.backgroundImage = 'url("' + item.imageUrl + '")';
      card.appendChild(pic);
      var body = el('div', 'body');
      body.appendChild(el('div', 'name', item.name));
      body.appendChild(el('div', 'price', money(item.price)));
      card.appendChild(body);
      card.addEventListener('click', function () {
        if (needsCustomize(item)) openCustomize(item);
        else addToCart(item, defaultIds(item));
      });
      grid.appendChild(card);
    });
    main.appendChild(grid);
    root.appendChild(main);

    var cart = el('aside', 'cart');
    cart.appendChild(el('h2', null, 'Заказ'));
    var list = el('div', 'cart-list');
    if (!state.cart.length) list.appendChild(el('div', 'cart-empty', 'Выбери блюда слева'));
    state.cart.forEach(function (line) {
      var row = el('div', 'cart-line');
      var topLine = el('div', 'cart-line-top');
      topLine.appendChild(el('span', null, line.item.name));
      topLine.appendChild(el('span', null, money(line.unitPrice * line.qty)));
      row.appendChild(topLine);
      var mods = lineModsText(line.item, line.modifierIds);
      if (mods) row.appendChild(el('div', 'cart-mods', mods));
      var qty = el('div', 'qty-row');
      var minus = el('button', 'qty-btn', '−');
      minus.addEventListener('click', function () {
        changeQty(line.key, -1);
      });
      var plus = el('button', 'qty-btn', '+');
      plus.addEventListener('click', function () {
        changeQty(line.key, 1);
      });
      qty.appendChild(minus);
      qty.appendChild(el('span', null, String(line.qty)));
      qty.appendChild(plus);
      row.appendChild(qty);
      list.appendChild(row);
    });
    cart.appendChild(list);
    var foot = el('div', 'cart-foot');
    var tot = el('div', 'cart-total');
    tot.appendChild(el('span', null, 'Итого'));
    tot.appendChild(el('span', null, money(cartTotal())));
    foot.appendChild(tot);
    var go = el('button', 'btn', state.busy ? 'Отправка…' : 'Оформить');
    go.disabled = !state.cart.length || state.busy;
    go.addEventListener('click', submitCart);
    foot.appendChild(go);
    if (state.error) foot.appendChild(el('div', 'error', state.error));
    cart.appendChild(foot);
    root.appendChild(cart);

    var modal = renderCustomize();
    if (modal) {
      var wrap = el('div');
      wrap.appendChild(root);
      wrap.appendChild(modal);
      return wrap;
    }
    return root;
  }

  function renderTicket() {
    var t = state.ticket;
    var root = el('div', 'screen');
    var hero = el('div', 'ticket-hero');
    hero.appendChild(el('p', 'eyebrow', 'Номер заказа'));
    hero.appendChild(el('div', 'ticket-num', t ? String(t.number) : '—'));
    hero.appendChild(el('div', 'ticket-status ' + (t && t.status), STATUS_LABEL[t && t.status] || ''));
    hero.appendChild(el('p', null, 'Покажи номер на выдаче. Оплата — у кассира.'));
    root.appendChild(hero);
    var list = el('div', 'ticket-items');
    (t && t.items ? t.items : []).forEach(function (item) {
      var row = el('div', 'ticket-line');
      row.appendChild(el('div', null, item.qty + '× ' + item.name + ' · ' + money(item.price * item.qty)));
      if (item.modifiers && item.modifiers.length) {
        row.appendChild(
          el(
            'div',
            'cart-mods',
            item.modifiers
              .map(function (m) {
                return m.name + (m.qty && m.unitLabel ? ' ' + m.qty + ' ' + m.unitLabel : '');
              })
              .join(', ')
          )
        );
      }
      list.appendChild(row);
    });
    root.appendChild(list);
    var actions = el('div', 'ticket-actions');
    if (t && (t.status === 'issued' || t.status === 'cancelled' || t.status === 'ready')) {
      var next = el('button', 'btn', 'Новый заказ');
      next.addEventListener('click', newOrder);
      actions.appendChild(next);
    } else {
      actions.appendChild(el('p', null, 'Ждём кухню…'));
    }
    root.appendChild(actions);
    return root;
  }

  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    var node;
    if (state.screen === 'register') node = renderRegister();
    else if (state.screen === 'wait' || state.screen === 'boot') node = renderWait();
    else if (state.screen === 'ticket') node = renderTicket();
    else node = renderMenu();
    app.appendChild(node);
  }

  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/kiosk/sw.js').catch(function () {});
    }
    if (!state.token) {
      setScreen('register');
      return;
    }
    setScreen('wait');
    await refreshBootstrap();
    if (state.screen !== 'menu') startPoll(refreshBootstrap, 4000);
    else startPoll(refreshBootstrap, 8000);
  }

  boot();
})();

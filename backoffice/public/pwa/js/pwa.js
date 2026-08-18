(function () {
  'use strict';

  var loginScreen = document.getElementById('loginScreen');
  var appScreen = document.getElementById('appScreen');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var loginSubmit = document.getElementById('loginSubmit');
  var logoutBtn = document.getElementById('logoutBtn');
  var refreshBtn = document.getElementById('refreshBtn');
  var dateInput = document.getElementById('dateInput');
  var datePrimary = document.getElementById('datePrimary');
  var dateCompare = document.getElementById('dateCompare');
  var venueSelect = document.getElementById('venueSelect');
  var venueLabel = document.getElementById('venueLabel');
  var cardsEl = document.getElementById('cards');
  var updatedHint = document.getElementById('updatedHint');

  var state = {
    date: null, // YYYY-MM-DD, синхронизировано с dateInput
    venueId: '',
  };

  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function formatDateLabel(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    var day = parseInt(parts[2], 10);
    var month = MONTHS_SHORT[parseInt(parts[1], 10) - 1] || '';
    return day + ' ' + month + ' ' + parts[0];
  }

  function formatMoney(value) {
    var num = Number(value) || 0;
    return Math.round(num).toLocaleString('ru-RU') + ' \u20BD';
  }

  function formatInt(value) {
    return Math.round(Number(value) || 0).toLocaleString('ru-RU');
  }

  function formatSignedMoney(value) {
    var num = Number(value) || 0;
    var sign = num > 0 ? '+' : '';
    return sign + Math.round(num).toLocaleString('ru-RU') + ' \u20BD';
  }

  function formatSignedInt(value) {
    var num = Math.round(Number(value) || 0);
    var sign = num > 0 ? '+' : '';
    return sign + num.toLocaleString('ru-RU');
  }

  function showLogin(message) {
    appScreen.hidden = true;
    loginScreen.hidden = false;
    loginError.textContent = message || '';
  }

  function showApp() {
    loginScreen.hidden = true;
    appScreen.hidden = false;
  }

  // ---------- Авторизация ----------

  function checkSession() {
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('unauth');
        return res.json();
      })
      .then(function () {
        showApp();
        return init();
      })
      .catch(function () {
        showLogin();
      });
  }

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loginError.textContent = '';
    loginSubmit.disabled = true;

    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;

    fetch('/api/auth/login-json', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        loginSubmit.disabled = false;
        if (!result.ok) {
          loginError.textContent = result.data.error || 'Не удалось войти';
          return;
        }
        loginForm.reset();
        showApp();
        init();
      })
      .catch(function () {
        loginSubmit.disabled = false;
        loginError.textContent = 'Сервер недоступен, попробуйте ещё раз';
      });
  });

  logoutBtn.addEventListener('click', function () {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () {
      showLogin();
    });
  });

  // ---------- Дата и заведение ----------

  dateInput.addEventListener('change', function () {
    if (!dateInput.value) return;
    state.date = dateInput.value;
    updateDateLabels(null);
    loadStats();
  });

  venueSelect.addEventListener('change', function () {
    state.venueId = venueSelect.value;
    var selected = venueSelect.options[venueSelect.selectedIndex];
    venueLabel.textContent = selected ? selected.textContent : 'Все заведения';
    loadStats();
  });

  refreshBtn.addEventListener('click', function () {
    loadStats();
  });

  function updateDateLabels(compareIso) {
    datePrimary.textContent = formatDateLabel(state.date);
    if (compareIso) {
      dateCompare.textContent = formatDateLabel(compareIso);
    }
  }

  // ---------- Загрузка данных ----------

  function loadVenues() {
    return fetch('/api/pwa/venues', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('venues');
        return res.json();
      })
      .then(function (data) {
        var venues = data.venues || [];
        venueSelect.innerHTML = '<option value="">Все заведения</option>' +
          venues.map(function (v) {
            return '<option value="' + v.id + '">' + escapeHtml(v.name) + '</option>';
          }).join('');
      })
      .catch(function () {
        /* список заведений не критичен для отображения самой статистики */
      });
  }

  function loadStats() {
    cardsEl.setAttribute('aria-busy', 'true');
    var params = new URLSearchParams();
    if (state.date) params.set('date', state.date);
    if (state.venueId) params.set('venueId', state.venueId);

    return fetch('/api/pwa/stats?' + params.toString(), { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) {
          showLogin();
          throw new Error('unauth');
        }
        if (!res.ok) throw new Error('stats');
        return res.json();
      })
      .then(function (data) {
        state.date = data.date;
        dateInput.value = data.date;
        updateDateLabels(data.compareDate);
        renderCards(data.metrics);
        updatedHint.textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      })
      .catch(function (err) {
        if (err.message === 'unauth') return;
        cardsEl.innerHTML = '<div class="empty-state">Не удалось загрузить статистику. Потяните, чтобы обновить, или нажмите ↻.</div>';
      })
      .finally(function () {
        cardsEl.removeAttribute('aria-busy');
      });
  }

  // ---------- Рендер карточек ----------

  var CARD_DEFS = [
    { key: 'cash', label: 'Наличными за день', formatter: formatMoney, deltaFormatter: formatSignedMoney },
    { key: 'revenue', label: 'Выручка', formatter: formatMoney, deltaFormatter: formatSignedMoney },
    { key: 'avgCheck', label: 'Средний чек', formatter: formatMoney, deltaFormatter: formatSignedMoney },
    { key: 'receiptCount', label: 'Количество чеков', formatter: formatInt, deltaFormatter: formatSignedInt },
    { key: 'guestCount', label: 'Гости', formatter: formatInt, deltaFormatter: formatSignedInt },
  ];

  function sparklinePath(values, width, height) {
    if (!values || values.length === 0) return '';
    var max = Math.max.apply(null, values.concat([1]));
    var min = Math.min.apply(null, values.concat([0]));
    var range = max - min || 1;
    var stepX = values.length > 1 ? width / (values.length - 1) : 0;
    return values.map(function (v, i) {
      var x = i * stepX;
      var y = height - ((v - min) / range) * height;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  function renderCards(metrics) {
    cardsEl.innerHTML = CARD_DEFS.map(function (def) {
      var m = metrics[def.key] || { value: 0, deltaPct: 0, deltaAbs: 0, trend: [] };
      var trendClass = m.deltaPct > 0.5 ? 'up' : m.deltaPct < -0.5 ? 'down' : 'flat';
      var arrow = trendClass === 'up' ? '\u25B2' : trendClass === 'down' ? '\u25BC' : '\u25CF';
      var lineColor = trendClass === 'up' ? 'var(--success)' : trendClass === 'down' ? 'var(--danger)' : 'var(--text-muted)';
      var path = sparklinePath(m.trend, 110, 44);

      return (
        '<div class="stat-card">' +
          '<div class="stat-card-info">' +
            '<div class="stat-card-label">' + escapeHtml(def.label) + '</div>' +
            '<div class="stat-card-value">' + def.formatter(m.value) + '</div>' +
            '<div class="stat-card-delta ' + trendClass + '">' +
              '<span>' + arrow + ' ' + Math.abs(m.deltaPct).toFixed(2) + '%</span>' +
              '<span class="stat-card-delta-abs">' + def.deltaFormatter(m.deltaAbs) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="sparkline-wrap">' +
            '<svg class="sparkline" viewBox="0 0 110 44" preserveAspectRatio="none">' +
              '<path d="' + path + '" fill="none" stroke="' + lineColor + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />' +
            '</svg>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------- Инициализация ----------

  function init() {
    if (!state.date) {
      state.date = todayISO();
      dateInput.value = state.date;
      dateInput.max = todayISO();
      updateDateLabels(null);
    }
    return Promise.all([loadVenues(), loadStats()]);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/pwa/sw.js').catch(function () {
        /* офлайн-режим не критичен — приложение всё равно работает онлайн */
      });
    });
  }

  checkSession();
})();

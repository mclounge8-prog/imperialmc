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
  var chartSheet = document.getElementById('chartSheet');
  var chartSheetTitle = document.getElementById('chartSheetTitle');
  var chartSheetCompare = document.getElementById('chartSheetCompare');
  var chartSheetPlot = document.getElementById('chartSheetPlot');
  var chartSheetClose = document.getElementById('chartSheetClose');
  var chartSheetX = document.getElementById('chartSheetX');
  var chartLegendSelected = document.getElementById('chartLegendSelected');
  var chartLegendCompare = document.getElementById('chartLegendCompare');
  var updateToast = document.getElementById('updateToast');
  var updateToastBtn = document.getElementById('updateToastBtn');

  var state = {
    date: null,
    venueId: '',
    compareDate: null,
    dates: [],
    hourLabels: [],
    metrics: null,
  };

  var APP_VERSION = null;
  var pendingSwRegistration = null;

  // Поколение экрана авторизации: поздний ответ старого checkSession() не должен
  // вернуть форму входа поверх уже открытой статистики (типичная гонка на iPhone).
  var authEpoch = 0;
  var isAuthenticated = false;

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
    isAuthenticated = false;
    authEpoch += 1;
    loginScreen.classList.remove('screen-hidden');
    appScreen.classList.add('screen-hidden');
    appScreen.setAttribute('aria-hidden', 'true');
    document.body.classList.add('is-login');
    window.scrollTo(0, 0);
    if (message !== undefined) {
      loginError.textContent = message || '';
    }
  }

  function showApp() {
    isAuthenticated = true;
    authEpoch += 1;
    loginScreen.classList.add('screen-hidden');
    appScreen.classList.remove('screen-hidden');
    appScreen.setAttribute('aria-hidden', 'false');
    document.body.classList.remove('is-login');
    window.scrollTo(0, 0);
  }

  function apiFetch(url, options) {
    var opts = options || {};
    opts.credentials = 'include';
    return fetch(url, opts);
  }

  // ---------- Авторизация ----------

  function checkSession() {
    var epoch = authEpoch;
    return apiFetch('/api/auth/me')
      .then(function (res) {
        if (!res.ok) throw new Error('unauth');
        return res.json();
      })
      .then(function () {
        if (epoch !== authEpoch) return null;
        showApp();
        return init();
      })
      .catch(function () {
        // Не трогаем UI, если пользователь уже успел войти, пока летел /me
        if (epoch !== authEpoch || isAuthenticated) return;
        showLogin();
      });
  }

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loginError.textContent = '';
    loginSubmit.disabled = true;

    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    // Инвалидируем любой незавершённый checkSession с загрузки страницы
    authEpoch += 1;
    var epoch = authEpoch;

    apiFetch('/api/auth/login-json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    })
      .then(function (res) {
        return res
          .json()
          .then(function (data) {
            return { ok: res.ok, status: res.status, data: data };
          })
          .catch(function () {
            if (res.status === 404) throw new Error('missing-endpoint');
            if (res.status >= 500) throw new Error('server-error');
            throw new Error('bad-response');
          });
      })
      .then(function (result) {
        if (epoch !== authEpoch) return null;
        if (!result.ok) {
          loginSubmit.disabled = false;
          loginError.textContent = result.data.error || 'Не удалось войти';
          return null;
        }
        // Cookie мог не сохраниться (особенно в standalone PWA на iOS) —
        // не открываем «Показатели», пока /me не подтвердит сессию.
        return apiFetch('/api/auth/me').then(function (res) {
          if (!res.ok) {
            throw new Error('session');
          }
          return res.json();
        });
      })
      .then(function (me) {
        if (epoch !== authEpoch) return;
        loginSubmit.disabled = false;
        if (!me) return;
        document.getElementById('password').value = '';
        showApp();
        return init();
      })
      .catch(function (err) {
        if (epoch !== authEpoch) return;
        loginSubmit.disabled = false;
        if (err && err.message === 'session') {
          loginError.textContent =
            'Вход принят, но браузер не сохранил сессию. Откройте https://imperial-mc.online/pwa/ в Safari (не из ярлыка), войдите, затем снова «На экран Домой».';
          return;
        }
        if (err && err.message === 'missing-endpoint') {
          loginError.textContent = 'Сервер устарел: нет /login-json. Обновите бэкофис и повторите вход.';
          return;
        }
        if (err && err.message === 'server-error') {
          loginError.textContent = 'Ошибка сервера при входе. Попробуйте ещё раз через минуту.';
          return;
        }
        loginError.textContent = 'Сервер недоступен, попробуйте ещё раз';
      });
  });

  logoutBtn.addEventListener('click', function () {
    apiFetch('/api/auth/logout', { method: 'POST' }).finally(function () {
      showLogin('');
      document.getElementById('username').value = '';
      document.getElementById('password').value = '';
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
    return apiFetch('/api/pwa/venues')
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

    return apiFetch('/api/pwa/stats?' + params.toString())
      .then(function (res) {
        if (res.status === 401) {
          showLogin('Сессия истекла, войдите снова');
          throw new Error('unauth');
        }
        if (!res.ok) throw new Error('stats');
        return res.json();
      })
      .then(function (data) {
        state.date = data.date;
        state.compareDate = data.compareDate || null;
        state.dates = data.dates || [];
        state.hourLabels = data.hourLabels || [];
        state.metrics = data.metrics || null;
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

  var COLOR_SELECTED = '#3f63e6';
  var COLOR_COMPARE = '#c9a227';
  var COLOR_GRID = '#34343c';

  function sparkScaleDual(seriesA, seriesB, width, height) {
    var values = (seriesA || []).concat(seriesB || []).concat([1]);
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values.concat([0]));
    var range = max - min || 1;
    var len = Math.max((seriesA && seriesA.length) || 0, (seriesB && seriesB.length) || 0, 1);
    var stepX = len > 1 ? width / (len - 1) : 0;
    return {
      max: max,
      min: min,
      range: range,
      stepX: stepX,
      point: function (v, i) {
        return {
          x: i * stepX,
          y: height - ((v - min) / range) * height,
        };
      },
    };
  }

  function pathFromSeries(series, scale) {
    if (!series || !series.length) return '';
    return series.map(function (v, i) {
      var p = scale.point(v, i);
      return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');
  }

  function renderCards(metrics) {
    cardsEl.innerHTML = CARD_DEFS.map(function (def) {
      var m = metrics[def.key] || { value: 0, deltaPct: 0, deltaAbs: 0, trend: [], compareTrend: [] };
      var trendClass = m.deltaPct > 0.5 ? 'up' : m.deltaPct < -0.5 ? 'down' : 'flat';
      var arrow = trendClass === 'up' ? '\u25B2' : trendClass === 'down' ? '\u25BC' : '\u25CF';
      var lineColor = trendClass === 'up' ? 'var(--success)' : trendClass === 'down' ? 'var(--danger)' : COLOR_SELECTED;
      var scale = sparkScaleDual(m.trend, m.compareTrend, 110, 44);
      var pathCompare = pathFromSeries(m.compareTrend, scale);
      var pathSelected = pathFromSeries(m.trend, scale);

      return (
        '<button type="button" class="stat-card" data-metric="' + def.key + '" aria-label="' +
          escapeHtml(def.label) + ': открыть график">' +
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
              (pathCompare
                ? '<path d="' + pathCompare + '" fill="none" stroke="' + COLOR_COMPARE + '" stroke-width="1.8" stroke-dasharray="3 3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />'
                : '') +
              '<path d="' + pathSelected + '" fill="none" stroke="' + lineColor + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />' +
            '</svg>' +
          '</div>' +
        '</button>'
      );
    }).join('');
  }

  function formatCompactAxis(value) {
    var num = Number(value) || 0;
    var abs = Math.abs(num);
    if (abs >= 1000000) return (Math.round((num / 1000000) * 10) / 10).toString().replace('.', ',') + 'M';
    if (abs >= 1000) return (Math.round((num / 1000) * 10) / 10).toString().replace('.', ',') + 'K';
    return String(Math.round(num));
  }

  function buildHourlyDetailChart(m, formatter) {
    var selected = (m.hours && m.hours.selected) || [];
    var compare = (m.hours && m.hours.compare) || [];
    if (!selected.length && !compare.length) {
      return '<p class="empty-state">Нет данных за период</p>';
    }

    var labels = state.hourLabels.length ? state.hourLabels : selected.map(function (_, i) {
      return String(i).padStart(2, '0');
    });
    var height = 200;
    var padTop = 14;
    var maxValue = Math.max(1, Math.max.apply(null, selected.concat(compare)));
    var n = Math.max(selected.length, compare.length, 1);
    var stepXPct = n > 1 ? 100 / (n - 1) : 0;

    function yPct(v) {
      return ((height - (v / maxValue) * (height - padTop)) / height) * 100;
    }

    var points = [];
    for (var i = 0; i < n; i += 1) {
      var sel = selected[i] || 0;
      var cmp = compare[i] || 0;
      points.push({
        xPct: stepXPct ? i * stepXPct : 50,
        label: (labels[i] || String(i)) + ':00',
        rows: [
          { name: formatDateLabel(state.date), value: formatter(sel), color: COLOR_SELECTED, yPct: yPct(sel), raw: sel },
          { name: formatDateLabel(state.compareDate), value: formatter(cmp), color: COLOR_COMPARE, yPct: yPct(cmp), raw: cmp },
        ],
      });
    }

    // SVG viewBox в логических единицах; оси — HTML рядом
    var width = 640;
    function scaleY(v) {
      return height - (v / maxValue) * (height - padTop);
    }
    function scaleX(i) {
      return n > 1 ? (i / (n - 1)) * width : width / 2;
    }

    function linePath(series) {
      return series.map(function (v, idx) {
        return (idx === 0 ? 'M' : 'L') + scaleX(idx).toFixed(1) + ',' + scaleY(v).toFixed(1);
      }).join(' ');
    }

    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
      var y = height - f * (height - padTop);
      return '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + width + '" y2="' + y.toFixed(1) +
        '" stroke="' + COLOR_GRID + '" stroke-width="1" stroke-dasharray="4 4" />';
    }).join('');

    var dotsSelected = selected.map(function (v, idx) {
      return '<circle cx="' + scaleX(idx).toFixed(1) + '" cy="' + scaleY(v).toFixed(1) +
        '" r="3.2" fill="' + COLOR_SELECTED + '" />';
    }).join('');

    var yTicks = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
      var y = height - f * (height - padTop);
      var translate = f === 1 ? '0' : f === 0 ? '-100%' : '-50%';
      return '<span class="chart-y-axis-tick" style="top:' + y.toFixed(1) + 'px;transform:translateY(' + translate + ')">' +
        escapeHtml(formatCompactAxis(f * maxValue)) + '</span>';
    }).join('');

    var xLabels = [0, 3, 6, 9, 12, 15, 18, 21].map(function (h) {
      return '<span>' + String(h).padStart(2, '0') + '</span>';
    }).join('');

    var svg =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" class="detail-chart-svg" role="img">' +
        grid +
        '<path d="' + linePath(compare) + '" fill="none" stroke="' + COLOR_COMPARE + '" stroke-width="2" stroke-dasharray="6 5" stroke-linejoin="round" stroke-linecap="round" />' +
        '<path d="' + linePath(selected) + '" fill="none" stroke="' + COLOR_SELECTED + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />' +
        dotsSelected +
      '</svg>';

    return (
      '<div class="detail-chart-wrap" data-points="' + escapeHtml(JSON.stringify(points)) + '">' +
        '<div class="detail-chart-with-axis">' +
          '<div class="chart-y-axis" style="height:' + height + 'px">' + yTicks + '</div>' +
          '<div class="detail-chart-plot" style="height:' + height + 'px">' +
            svg +
            '<div class="chart-crosshair screen-hidden"></div>' +
            '<div class="chart-hover-dots"></div>' +
            '<div class="chart-tooltip screen-hidden"></div>' +
          '</div>' +
        '</div>' +
        '<div class="chart-x-labels">' + xLabels + '</div>' +
      '</div>' +
      '<div class="chart-sheet-values">' +
        '<div class="chart-sheet-value-row">' +
          '<span class="chart-legend-dot chart-legend-dot-selected"></span>' +
          '<span>' + escapeHtml(formatDateLabel(state.date)) + ' · итог</span>' +
          '<strong>' + formatter(m.value) + '</strong>' +
        '</div>' +
        '<div class="chart-sheet-value-row">' +
          '<span class="chart-legend-dot chart-legend-dot-compare"></span>' +
          '<span>' + escapeHtml(formatDateLabel(state.compareDate)) + ' · итог</span>' +
          '<strong>' + formatter(m.compareValue) + '</strong>' +
        '</div>' +
      '</div>'
    );
  }

  function bindChartInteractions(root) {
    var plot = root.querySelector('.detail-chart-plot');
    if (!plot) return;
    var points;
    try {
      points = JSON.parse(root.getAttribute('data-points') || '[]');
    } catch (e) {
      points = [];
    }
    var crosshair = plot.querySelector('.chart-crosshair');
    var dotsEl = plot.querySelector('.chart-hover-dots');
    var tooltip = plot.querySelector('.chart-tooltip');

    function hide() {
      crosshair.classList.add('screen-hidden');
      tooltip.classList.add('screen-hidden');
      dotsEl.innerHTML = '';
    }

    function showAt(clientX) {
      if (!points.length) return;
      var rect = plot.getBoundingClientRect();
      if (!rect.width) return;
      var relX = ((clientX - rect.left) / rect.width) * 100;
      var nearest = points[0];
      var nearestDist = Infinity;
      points.forEach(function (p) {
        var dist = Math.abs(p.xPct - relX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      });

      crosshair.classList.remove('screen-hidden');
      crosshair.style.left = nearest.xPct + '%';

      dotsEl.innerHTML = nearest.rows.map(function (row) {
        return '<div class="chart-hover-dot" style="left:' + nearest.xPct + '%;top:' + row.yPct +
          '%;background:' + row.color + '"></div>';
      }).join('');

      var minY = Math.min.apply(null, nearest.rows.map(function (r) { return r.yPct; }));
      var left = nearest.xPct;
      var translateX = '-50%';
      if (left < 12) translateX = '0%';
      else if (left > 88) translateX = '-100%';
      tooltip.classList.remove('screen-hidden');
      tooltip.style.left = left + '%';
      tooltip.style.top = Math.max(0, minY - 8) + '%';
      tooltip.style.transform = 'translate(' + translateX + ', -100%)';
      tooltip.innerHTML =
        '<div class="chart-tooltip-label">' + escapeHtml(nearest.label) + '</div>' +
        nearest.rows.map(function (row) {
          return (
            '<div class="chart-tooltip-row">' +
              '<span class="chart-tooltip-dot" style="background:' + row.color + '"></span>' +
              '<span class="chart-tooltip-name">' + escapeHtml(row.name) + '</span>' +
              '<span class="chart-tooltip-value">' + escapeHtml(row.value) + '</span>' +
            '</div>'
          );
        }).join('');
    }

    plot.addEventListener('pointerdown', function (event) {
      plot.setPointerCapture(event.pointerId);
      showAt(event.clientX);
    });
    plot.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'mouse' || plot.hasPointerCapture(event.pointerId)) {
        showAt(event.clientX);
      }
    });
    plot.addEventListener('pointerup', hide);
    plot.addEventListener('pointercancel', hide);
    plot.addEventListener('pointerleave', hide);
  }

  function openChartSheet(metricKey) {
    var def = CARD_DEFS.find(function (d) { return d.key === metricKey; });
    if (!def || !state.metrics || !state.metrics[metricKey]) return;
    var m = state.metrics[metricKey];
    chartSheetTitle.textContent = def.label;
    chartSheetCompare.textContent =
      'По часам · сравнение с ' + formatDateLabel(state.compareDate) + ' (тот же день неделю назад)';
    if (chartLegendSelected) chartLegendSelected.textContent = formatDateLabel(state.date);
    if (chartLegendCompare) chartLegendCompare.textContent = formatDateLabel(state.compareDate) + ' · неделя назад';
    chartSheetPlot.innerHTML = buildHourlyDetailChart(m, def.formatter);
    var wrap = chartSheetPlot.querySelector('.detail-chart-wrap');
    if (wrap) bindChartInteractions(wrap);
    chartSheet.classList.remove('screen-hidden');
    chartSheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('chart-open');
  }

  function closeChartSheet() {
    chartSheet.classList.add('screen-hidden');
    chartSheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('chart-open');
    chartSheetPlot.innerHTML = '';
  }

  cardsEl.addEventListener('click', function (event) {
    var card = event.target.closest('.stat-card');
    if (!card || !cardsEl.contains(card)) return;
    openChartSheet(card.getAttribute('data-metric'));
  });

  chartSheetClose.addEventListener('click', closeChartSheet);
  chartSheetX.addEventListener('click', closeChartSheet);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !chartSheet.classList.contains('screen-hidden')) {
      closeChartSheet();
    }
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------- Автообновление PWA ----------

  function showUpdateToast(onConfirm) {
    if (!updateToast) {
      onConfirm();
      return;
    }
    updateToast.classList.remove('screen-hidden');
    updateToastBtn.onclick = function () {
      onConfirm();
    };
  }

  function applyUpdateNow() {
    if (pendingSwRegistration && pendingSwRegistration.waiting) {
      pendingSwRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    window.location.reload();
  }

  function checkAppVersion() {
    return fetch('/pwa/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.v) return;
        if (APP_VERSION == null) {
          APP_VERSION = data.v;
          try { localStorage.setItem('pwa-app-version', data.v); } catch (e) { /* ignore */ }
          return;
        }
        if (data.v !== APP_VERSION) {
          showUpdateToast(function () {
            window.location.reload();
          });
        }
      })
      .catch(function () { /* офлайн — не мешаем */ });
  }

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      APP_VERSION = localStorage.getItem('pwa-app-version');
    } catch (e) {
      APP_VERSION = null;
    }

    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'PWA_UPDATED') {
        showUpdateToast(function () {
          window.location.reload();
        });
      }
    });

    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/pwa/sw.js', { updateViaCache: 'none' })
        .then(function (reg) {
          pendingSwRegistration = reg;
          reg.update().catch(function () {});
          if (reg.waiting) {
            showUpdateToast(function () {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            });
          }
          reg.addEventListener('updatefound', function () {
            var installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', function () {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast(function () {
                  if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                  else window.location.reload();
                });
              }
            });
          });
        })
        .catch(function () {});

      checkAppVersion();
      setInterval(function () {
        checkAppVersion();
        if (pendingSwRegistration) pendingSwRegistration.update().catch(function () {});
      }, 60 * 1000);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        checkAppVersion();
        if (pendingSwRegistration) pendingSwRegistration.update().catch(function () {});
      }
    });
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

  setupServiceWorker();

  // Стартуем с экрана входа — иначе до ответа /me на долю секунды
  // мелькает «Показатели» (и раньше из-за бага с [hidden] он вообще всегда
  // оставался внизу страницы).
  showLogin();
  checkSession();
})();

// Небольшой набор своих скриптов бэкофиса (не сторонняя библиотека — поэтому
// не в /vendor). Поиск по каталогам (склад, модификаторы, меню): они
// разрастаются до десятков категорий и сотен позиций, где сплошной список без
// поиска и с полностью развёрнутыми аккордеонами становится нечитаемым.
// Плюс наведение на графики статистики (см. views/charts.js).

/**
 * Фильтрует строки таблиц внутри аккордеона по подстроке (без учёта регистра).
 * Секции без совпадений скрываются целиком; секции с совпадением — раскрываются
 * через Alpine.$data (а не просто через style — иначе разойдётся с реактивным
 * состоянием Alpine, и следующий клик по заголовку всё равно вернёт то, что
 * лежит в x-data, независимо от того, что мы поставили в style напрямую).
 *
 * Состояние "открыто/закрыто" ДО начала поиска запоминается один раз, в самый
 * первый символ — а не на каждое нажатие клавиши, иначе промежуточные
 * совпадения посередине набора текста (напр. общая буква "о" почти везде)
 * раскрывали бы секции, которые потом никогда не закрывались обратно после
 * очистки поля поиска.
 */
function filterCatalogSearch(inputEl, containerId) {
  var query = inputEl.value.trim().toLowerCase();
  var container = document.getElementById(containerId);
  if (!container) return;

  var wasSearching = container.dataset.searching === '1';
  var isSearching = query.length > 0;

  var sections = container.querySelectorAll('.accordion-section');
  sections.forEach(function (section) {
    if (isSearching && !wasSearching && window.Alpine) {
      var beforeData = window.Alpine.$data(section);
      section.dataset.openBeforeSearch = beforeData && beforeData.open ? '1' : '0';
    }

    var rows = section.querySelectorAll('tbody tr');
    var hasMatch = !isSearching;

    rows.forEach(function (row) {
      var text = row.textContent.toLowerCase();
      var matches = !isSearching || text.indexOf(query) !== -1;
      row.style.display = matches ? '' : 'none';
      if (matches) hasMatch = true;
    });

    section.style.display = hasMatch ? '' : 'none';

    if (window.Alpine) {
      var data = window.Alpine.$data(section);
      if (data) {
        if (isSearching) {
          if (hasMatch) data.open = true;
        } else if (wasSearching) {
          data.open = section.dataset.openBeforeSearch === '1';
        }
      }
    }
  });

  container.dataset.searching = isSearching ? '1' : '0';
}

/**
 * Alpine-компонент наведения для графиков на «Главной» (views/charts.js
 * рендерит каждую точку сервером с координатами в процентах — xPct/yPct —
 * и уже отформатированными значениями, JS здесь только ищет ближайшую по X
 * точку и подставляет её в подсказку/линию-прицел).
 *
 * Раньше цифры при наведении показывались через нативный <title> у SVG-точек:
 * у браузера это происходит с задержкой и только если попасть курсором точно
 * в кружок радиусом 2-3px, поэтому казалось, что подсказка вообще не работает.
 * Здесь вместо этого — область наведения на всю ширину графика.
 */
window.chartTooltip = function (points) {
  return {
    points: Array.isArray(points) ? points : [],
    active: null,
    onMove(event) {
      if (!this.points.length) return;
      var rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      var relX = ((event.clientX - rect.left) / rect.width) * 100;
      var nearest = this.points[0];
      var nearestDist = Infinity;
      this.points.forEach(function (p) {
        var dist = Math.abs(p.xPct - relX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      });
      this.active = nearest;
    },
    hide() {
      this.active = null;
    },
    get tooltipStyle() {
      if (!this.active) return 'display:none';
      var minY = Math.min.apply(
        null,
        this.active.rows.map(function (r) {
          return r.yPct;
        })
      );
      var left = this.active.xPct;
      var translateX = '-50%';
      if (left < 12) translateX = '0%';
      else if (left > 88) translateX = '-100%';
      var top = Math.max(0, minY - 10);
      return 'left:' + left + '%; top:' + top + '%; transform:translate(' + translateX + ', -100%);';
    },
  };
};

// Небольшой набор своих скриптов бэкофиса (не сторонняя библиотека — поэтому
// не в /vendor). Пока — только поиск по каталогам (склад, модификаторы, меню):
// они разрастаются до десятков категорий и сотен позиций, где сплошной список
// без поиска и с полностью развёрнутыми аккордеонами становится нечитаемым.

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

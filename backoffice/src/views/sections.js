export const sections = {
  dashboard: {
    title: 'Главная',
    hint: 'Обзор продаж и статистика',
    emptyText: 'Пока нет данных для статистики',
    actionText: 'Появится после первых продаж',
  },
  venues: {
    title: 'Заведения',
    hint: 'Точки продаж, склад и столы каждой из них',
    emptyText: 'Пока нет ни одного заведения',
    actionText: 'Добавить первое заведение',
  },
  tables: {
    title: 'Столы',
    hint: 'Расстановка столов по залу',
    emptyText: 'Пока нет ни одного стола',
    actionText: 'Добавить первый стол',
  },
  menu: {
    title: 'Меню',
    hint: 'Позиции меню и категории',
    emptyText: 'Пока нет позиций меню',
    actionText: 'Добавить первую позицию',
  },
  warehouse: {
    title: 'Склад',
    hint: 'Номенклатура сырья и остатки',
    emptyText: 'Склад пуст',
    actionText: 'Добавить номенклатуру',
  },
  staff: {
    title: 'Сотрудники',
    hint: 'Сотрудники и роли для входа по PIN',
    emptyText: 'Пока нет сотрудников',
    actionText: 'Добавить сотрудника',
  },
  devices: {
    title: 'Устройства',
    hint: 'Android-терминалы: регистрация, заведение, активация',
    emptyText: 'Пока нет ни одного устройства',
    actionText: 'Сгенерировать код регистрации',
  },
  reports: {
    title: 'Отчёты',
    hint: 'Чеки и статистика продаж',
    emptyText: 'Чеков пока нет',
    actionText: 'Появятся после первой оплаты',
  },
};

export function renderSection(key) {
  const s = sections[key];
  if (!s) return null;

  return `
    <header>
      <h1>${s.title}</h1>
      <p>${s.hint}</p>
    </header>
    <section class="empty-state">
      <p>${s.emptyText}</p>
      <button disabled>${s.actionText}</button>
    </section>
  `;
}

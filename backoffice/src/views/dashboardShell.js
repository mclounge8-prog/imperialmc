import { sections } from './sections.js';
import { escapeHtml } from './escapeHtml.js';

// Разделы, которые реально работают с "текущим заведением" (склад/меню/столы) —
// только для них показываем общий переключатель заведения в шапке. У «Отчётов»
// свой отдельный фильтр по датам/заведению (там смысл другой — исторический
// отбор, а не "с чем сейчас работаю"), у остальных заведение не при делах.
const VENUE_SCOPED_SECTIONS = new Set(['warehouse', 'menu', 'tables']);

function renderVenueSwitcher(venues, selectedVenueId, initialKey) {
  if (venues.length === 0) return '';
  const options = venues
    .map(
      (v) =>
        `<option value="${v.id}"${String(v.id) === String(selectedVenueId) ? ' selected' : ''}>${escapeHtml(v.name)}</option>`
    )
    .join('');
  const hiddenClass = VENUE_SCOPED_SECTIONS.has(initialKey) ? '' : ' sidebar-venue-hidden';

  return `
    <div class="sidebar-venue${hiddenClass}" id="sidebar-venue-switcher">
      <label class="sidebar-venue-label">Заведение</label>
      <select
        class="venue-select"
        name="venue_id"
        hx-post="/preferences/venue"
        hx-trigger="change"
        hx-target="#main-content"
        hx-swap="innerHTML"
      >${options}</select>
    </div>
  `;
}

export function renderDashboardShell({ username, initialKey, initialSectionHtml, venues = [], selectedVenueId = null }) {
  const navItems = Object.entries(sections)
    .map(([key, s]) => {
      const activeClass = key === initialKey ? ' active' : '';
      const scopedAttr = VENUE_SCOPED_SECTIONS.has(key) ? ' data-venue-scoped="true"' : '';
      return `
        <button
          class="nav-item${activeClass}"
          hx-get="/fragments/${key}"
          hx-target="#main-content"
          hx-push-url="/dashboard#${key}"
          ${scopedAttr}
          hx-on:click="
            document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('sidebar-venue-switcher').classList.toggle('sidebar-venue-hidden', !this.dataset.venueScoped);
          "
        >${s.title}</button>
      `;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Бэкофис — панель управления</title>
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <script src="/vendor/htmx.min.js"></script>
  <script src="/vendor/alpine.min.js" defer></script>
  <script src="/js/app.js" defer></script>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <img src="/img/logo-white.webp" alt="Imperial MC">
      </div>

      ${renderVenueSwitcher(venues, selectedVenueId, initialKey)}

      <nav>
        ${navItems}
      </nav>

      <div class="whoami">${username}</div>
      <button class="logout" hx-post="/api/auth/logout">Выйти</button>
    </aside>

    <main class="main" id="main-content">
      ${initialSectionHtml}
    </main>
  </div>
</body>
</html>`;
}

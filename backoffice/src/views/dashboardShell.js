import { sections } from './sections.js';

export function renderDashboardShell({ username, initialKey, initialSectionHtml }) {
  const navItems = Object.entries(sections)
    .map(([key, s]) => {
      const activeClass = key === initialKey ? ' active' : '';
      return `
        <button
          class="nav-item${activeClass}"
          hx-get="/fragments/${key}"
          hx-target="#main-content"
          hx-push-url="/dashboard#${key}"
          hx-on:click="document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); this.classList.add('active')"
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <script src="/vendor/htmx.min.js"></script>
  <script src="/vendor/alpine.min.js" defer></script>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <img src="/img/logo-white.webp" alt="Imperial MC">
      </div>

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

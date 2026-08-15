import { escapeHtml } from './escapeHtml.js';

function fileLabel(file) {
  return file ? escapeHtml(file) : '<span class="muted">не загружен</span>';
}

export function renderUpdatesSection(manifest, clientPreview) {
  const apk = manifest.apk || {};
  const js = manifest.js || {};

  return `
    <header>
      <h1>Обновления терминала</h1>
      <p>APK — полная сборка (нужна при изменении АТОЛ/native). JS OTA — только логика и экраны без переустановки APK.</p>
    </header>

    <section class="card" style="margin-bottom: 1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Текущий манифест</h2>
      <div style="display:grid;gap:.75rem;grid-template-columns:1fr 1fr;">
        <div>
          <strong>APK</strong>
          <ul style="margin:.4rem 0 0;padding-left:1.1rem;line-height:1.55;">
            <li>versionCode: <code>${escapeHtml(String(apk.versionCode ?? ''))}</code></li>
            <li>versionName: <code>${escapeHtml(String(apk.versionName ?? ''))}</code></li>
            <li>файл: ${fileLabel(apk.file)}</li>
            <li>обязательное: ${apk.mandatory ? 'да' : 'нет'}</li>
            <li>URL: ${clientPreview.apk.url ? `<code>${escapeHtml(clientPreview.apk.url)}</code>` : '—'}</li>
          </ul>
          ${apk.notes ? `<p class="muted" style="margin:.5rem 0 0;">${escapeHtml(apk.notes)}</p>` : ''}
        </div>
        <div>
          <strong>JS OTA</strong>
          <ul style="margin:.4rem 0 0;padding-left:1.1rem;line-height:1.55;">
            <li>version: <code>${escapeHtml(String(js.version ?? 0))}</code></li>
            <li>min APK code: <code>${escapeHtml(String(js.minApkVersionCode ?? 1))}</code></li>
            <li>файл: ${fileLabel(js.file)}</li>
            <li>обязательное: ${js.mandatory ? 'да' : 'нет'}</li>
            <li>URL: ${clientPreview.js.url ? `<code>${escapeHtml(clientPreview.js.url)}</code>` : '—'}</li>
          </ul>
          ${js.notes ? `<p class="muted" style="margin:.5rem 0 0;">${escapeHtml(js.notes)}</p>` : ''}
        </div>
      </div>
      <p class="muted" style="margin:.9rem 0 0;font-size:.85rem;">
        Терминал читает <code>GET /api/terminal/updates</code>. После загрузки APK/JS манифест обновляется сразу.
      </p>
    </section>

    <section class="card" style="margin-bottom: 1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Загрузить APK</h2>
      <form
        hx-post="/terminal-updates/apk"
        hx-encoding="multipart/form-data"
        hx-target="#main-content"
        hx-swap="innerHTML"
        class="stack-form"
      >
        <label>Файл .apk
          <input type="file" name="apk" accept=".apk,application/vnd.android.package-archive" required />
        </label>
        <label>versionCode (целое, больше предыдущего)
          <input type="number" name="versionCode" min="1" step="1" value="${escapeHtml(String((Number(apk.versionCode) || 1) + 1))}" required />
        </label>
        <label>versionName
          <input type="text" name="versionName" value="${escapeHtml(String(apk.versionName || '1.0.0'))}" required />
        </label>
        <label>Заметки для планшета
          <input type="text" name="notes" placeholder="Что нового" value="" />
        </label>
        <label style="display:flex;align-items:center;gap:.5rem;">
          <input type="checkbox" name="mandatory" value="1" />
          Обязательное обновление (нельзя отложить)
        </label>
        <button type="submit">Опубликовать APK</button>
      </form>
    </section>

    <section class="card" style="margin-bottom: 1.25rem;">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Загрузить JS OTA (.zip)</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.9rem;">
        ZIP должен содержать <code>index.android.bundle</code> в корне.
        Собирается скриптом <code>terminal-app/scripts/build-js-ota.sh</code>.
        Не подходит для смены native/АТОЛ — тогда нужен APK.
      </p>
      <form
        hx-post="/terminal-updates/js"
        hx-encoding="multipart/form-data"
        hx-target="#main-content"
        hx-swap="innerHTML"
        class="stack-form"
      >
        <label>Файл .zip
          <input type="file" name="bundle" accept=".zip,application/zip" required />
        </label>
        <label>JS version (целое, больше предыдущего)
          <input type="number" name="version" min="1" step="1" value="${escapeHtml(String((Number(js.version) || 0) + 1))}" required />
        </label>
        <label>Минимальный APK versionCode
          <input type="number" name="minApkVersionCode" min="1" step="1" value="${escapeHtml(String(apk.versionCode || 1))}" required />
        </label>
        <label>Заметки
          <input type="text" name="notes" placeholder="Что нового в JS" value="" />
        </label>
        <label style="display:flex;align-items:center;gap:.5rem;">
          <input type="checkbox" name="mandatory" value="1" />
          Обязательное JS-обновление
        </label>
        <button type="submit">Опубликовать JS OTA</button>
      </form>
    </section>

    <section class="card">
      <h2 style="margin:0 0 .75rem;font-size:1.05rem;">Сброс JS OTA</h2>
      <p class="muted" style="margin:0 0 .75rem;font-size:.9rem;">
        Убирает ссылку на JS-бандл из манифеста. Планшеты после следующей проверки останутся на JS, вшитом в APK (или уже скачанном локально, пока не очистят).
      </p>
      <form
        hx-post="/terminal-updates/js/clear"
        hx-target="#main-content"
        hx-swap="innerHTML"
        hx-confirm="Сбросить публикацию JS OTA?"
      >
        <button type="submit" class="danger">Сбросить JS OTA</button>
      </form>
    </section>
  `;
}

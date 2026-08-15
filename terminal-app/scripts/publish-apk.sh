#!/usr/bin/env bash
# Собрать release APK и опубликовать на сервер (без браузера).
#
# Пароль SSH — в файл terminal-app/.env.deploy (не коммитится):
#   SSHPASS=ваш-пароль
#   TERMINAL_DEPLOY_HOST=root@176.57.218.9
#
# Или: export SSHPASS='...'
#
#   ./scripts/publish-apk.sh 2 1.0.1 "Заметки"
#   ./scripts/publish-apk.sh 2 1.0.1 "Заметки" --skip-build
set -euo pipefail

echo "==> publish-apk.sh стартовал"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.deploy" ]]; then
  echo "==> Читаю .env.deploy"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.deploy"
  set +a
fi

VERSION_CODE="${1:?Укажите versionCode: ./scripts/publish-apk.sh 2 1.0.1}"
VERSION_NAME="${2:?Укажите versionName: ./scripts/publish-apk.sh 2 1.0.1}"
NOTES="${3:-}"
SKIP_BUILD=0
if [[ "${4:-}" == "--skip-build" || "${3:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
  if [[ "${3:-}" == "--skip-build" ]]; then
    NOTES=""
  fi
fi

DEPLOY_HOST="${TERMINAL_DEPLOY_HOST:-root@176.57.218.9}"
APP_CONTAINER="${TERMINAL_APP_CONTAINER:-imperial-mc-backoffice-app-1}"
REMOTE_TMP="/tmp/imperial-terminal-apk-$$.apk"

if [[ -z "${SSHPASS:-}" ]]; then
  echo "Нет SSHPASS. Создайте $ROOT/.env.deploy с строкой SSHPASS=пароль" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Не найден sshpass. Установите: brew install hudochenkov/sshpass/sshpass" >&2
  exit 1
fi

ssh_cmd() { sshpass -e ssh -o StrictHostKeyChecking=no "$@"; }
scp_cmd() { sshpass -e scp -o StrictHostKeyChecking=no "$@"; }

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> Сборка APK (versionCode=$VERSION_CODE versionName=$VERSION_NAME)…"
  "$ROOT/scripts/build-release-apk.sh" "$VERSION_CODE" "$VERSION_NAME"
else
  echo "==> Пропуск сборки (--skip-build)"
fi

APK="$(ls -t "$ROOT"/dist/ImperialMcTerminal-v"${VERSION_CODE}"-*.apk 2>/dev/null | head -1 || true)"
if [[ -z "$APK" || ! -f "$APK" ]]; then
  APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
fi
if [[ ! -f "$APK" ]]; then
  echo "APK не найден: ни dist/, ни android/app/build/outputs/apk/release/app-release.apk" >&2
  exit 1
fi
echo "==> APK: $APK ($(wc -c < "$APK") bytes)"

REMOTE_NAME="terminal-v${VERSION_CODE}-$(date +%s).apk"
echo "==> SCP → ${DEPLOY_HOST}:${REMOTE_TMP}"
scp_cmd "$APK" "${DEPLOY_HOST}:${REMOTE_TMP}"

echo "==> docker cp + обновление манифеста"
ssh_cmd "$DEPLOY_HOST" bash -s <<EOF
set -euo pipefail
docker cp '${REMOTE_TMP}' '${APP_CONTAINER}:/app/public/updates/${REMOTE_NAME}'
rm -f '${REMOTE_TMP}'
docker exec \\
  -e REMOTE_NAME='${REMOTE_NAME}' \\
  -e VERSION_CODE='${VERSION_CODE}' \\
  -e VERSION_NAME='${VERSION_NAME}' \\
  -e NOTES=$(printf %q "$NOTES") \\
  '${APP_CONTAINER}' node -e '
const fs = require("fs");
const crypto = require("crypto");
const path = "/app/public/updates/manifest.json";
const file = process.env.REMOTE_NAME;
const versionCode = Number(process.env.VERSION_CODE);
const versionName = process.env.VERSION_NAME;
const notes = process.env.NOTES || "";
const buf = fs.readFileSync("/app/public/updates/" + file);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
let manifest = { apk: {}, js: {} };
try { manifest = JSON.parse(fs.readFileSync(path, "utf8")); } catch (_) {}
manifest.apk = { versionCode, versionName, file, sha256, mandatory: false, notes };
if (!manifest.js) {
  manifest.js = { version: 0, minApkVersionCode: versionCode, file: null, mandatory: false, notes: "" };
}
fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\\n");
console.log("Published APK", JSON.stringify(manifest.apk));
'
EOF

echo "==> Проверка API…"
curl -sS "https://imperial-mc.online/api/terminal/updates"
echo ""
echo "Готово. На планшете: Настройки → Обновления (versionCode должен быть > чем на планшете)."

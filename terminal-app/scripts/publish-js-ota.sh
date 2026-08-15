#!/usr/bin/env bash
# Собрать JS OTA и сразу опубликовать на сервер (без браузера).
#
# Использование:
#   export SSHPASS='пароль-сервера'   # если нет SSH-ключа
#   ./scripts/publish-js-ota.sh 1
#   ./scripts/publish-js-ota.sh 1 "Убрали свайпы" 1
#   ./scripts/publish-js-ota.sh 1 "" 1 --skip-build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JS_VERSION="${1:?Укажите JS version, например: ./scripts/publish-js-ota.sh 1}"
NOTES="${2:-}"
MIN_APK="${3:-}"
SKIP_BUILD=0
if [[ "${4:-}" == "--skip-build" ]] || [[ "${3:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
  if [[ "${3:-}" == "--skip-build" ]]; then
    MIN_APK=""
  fi
fi

DEPLOY_HOST="${TERMINAL_DEPLOY_HOST:-root@176.57.218.9}"
APP_CONTAINER="${TERMINAL_APP_CONTAINER:-imperial-mc-backoffice-app-1}"
REMOTE_TMP="/tmp/imperial-terminal-js-$$.zip"

ssh_cmd() {
  if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
    sshpass -e ssh -o StrictHostKeyChecking=no "$@"
  else
    ssh -o StrictHostKeyChecking=no "$@"
  fi
}

scp_cmd() {
  if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
    sshpass -e scp -o StrictHostKeyChecking=no "$@"
  else
    scp -o StrictHostKeyChecking=no "$@"
  fi
}

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> Сборка JS OTA…"
  "$ROOT/scripts/build-js-ota.sh" "$JS_VERSION"
fi

ZIP="$ROOT/dist/js-ota-v${JS_VERSION}.zip"
if [[ ! -f "$ZIP" ]]; then
  echo "ZIP не найден: $ZIP" >&2
  exit 1
fi

# Если min APK не задан — возьмём текущий versionCode из gradle
if [[ -z "$MIN_APK" ]]; then
  MIN_APK="$(grep -oE 'versionCode [0-9]+' android/app/build.gradle | head -1 | awk '{print $2}')"
fi

REMOTE_NAME="js-ota-v${JS_VERSION}-$(date +%s).zip"
echo "==> Загрузка $(basename "$ZIP") → ${DEPLOY_HOST} (${REMOTE_NAME})"
scp_cmd "$ZIP" "${DEPLOY_HOST}:${REMOTE_TMP}"

ssh_cmd "$DEPLOY_HOST" bash -s <<EOF
set -euo pipefail
docker cp '${REMOTE_TMP}' '${APP_CONTAINER}:/app/public/updates/${REMOTE_NAME}'
rm -f '${REMOTE_TMP}'
docker exec \\
  -e REMOTE_NAME='${REMOTE_NAME}' \\
  -e JS_VERSION='${JS_VERSION}' \\
  -e MIN_APK='${MIN_APK}' \\
  -e NOTES=$(printf %q "$NOTES") \\
  '${APP_CONTAINER}' node -e '
const fs = require("fs");
const crypto = require("crypto");
const path = "/app/public/updates/manifest.json";
const file = process.env.REMOTE_NAME;
const version = Number(process.env.JS_VERSION);
const minApkVersionCode = Number(process.env.MIN_APK) || 1;
const notes = process.env.NOTES || "";
const buf = fs.readFileSync("/app/public/updates/" + file);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
let manifest = { apk: {}, js: {} };
try { manifest = JSON.parse(fs.readFileSync(path, "utf8")); } catch (_) {}
manifest.js = { version, minApkVersionCode, file, sha256, mandatory: false, notes };
fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\\n");
console.log("Published JS OTA", JSON.stringify(manifest.js));
'
EOF

echo ""
echo "Готово. Проверка: curl -s https://imperial-mc.online/api/terminal/updates"
echo "На планшете: Настройки → Обновления (или перезапуск)."

#!/usr/bin/env bash
# Собрать JS OTA и опубликовать на сервер.
# Пароль: terminal-app/.env.deploy → SSHPASS=...
set -euo pipefail

echo "==> publish-js-ota.sh стартовал"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.deploy" ]]; then
  echo "==> Читаю .env.deploy"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.deploy"
  set +a
fi

JS_VERSION="${1:?Укажите JS version: ./scripts/publish-js-ota.sh 1}"
NOTES="${2:-}"
MIN_APK="${3:-}"
SKIP_BUILD=0
if [[ "${4:-}" == "--skip-build" || "${3:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
  if [[ "${3:-}" == "--skip-build" ]]; then
    MIN_APK=""
  fi
fi

DEPLOY_HOST="${TERMINAL_DEPLOY_HOST:-root@176.57.218.9}"
APP_CONTAINER="${TERMINAL_APP_CONTAINER:-imperial-mc-backoffice-app-1}"
REMOTE_TMP="/tmp/imperial-terminal-js-$$.zip"

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
  echo "==> Сборка JS OTA v${JS_VERSION}…"
  "$ROOT/scripts/build-js-ota.sh" "$JS_VERSION"
fi

ZIP="$ROOT/dist/js-ota-v${JS_VERSION}.zip"
if [[ ! -f "$ZIP" ]]; then
  echo "ZIP не найден: $ZIP" >&2
  exit 1
fi

if [[ -z "$MIN_APK" ]]; then
  MIN_APK="$(grep -oE 'versionCode [0-9]+' android/app/build.gradle | head -1 | awk '{print $2}')"
fi

REMOTE_NAME="js-ota-v${JS_VERSION}-$(date +%s).zip"
echo "==> SCP → ${DEPLOY_HOST}"
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

echo "==> Проверка API…"
curl -sS "https://imperial-mc.online/api/terminal/updates"
echo ""
echo "Готово."

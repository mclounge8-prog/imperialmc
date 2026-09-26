#!/usr/bin/env bash
# Собрать APK киоска и выложить на сервер: /updates/kiosk.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.deploy" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.deploy"
  set +a
fi

VERSION_CODE="${1:-1}"
VERSION_NAME="${2:-1.0.0}"
NOTES="${3:-Киоск самообслуживания}"
SKIP_BUILD=0
if [[ "${4:-}" == "--skip-build" || "${3:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
  if [[ "${3:-}" == "--skip-build" ]]; then
    NOTES="Киоск самообслуживания"
  fi
fi

DEPLOY_HOST="${TERMINAL_DEPLOY_HOST:-root@176.57.218.9}"
APP_CONTAINER="${TERMINAL_APP_CONTAINER:-imperial-mc-backoffice-app-1}"
REMOTE_TMP="/tmp/imperial-kiosk-apk-$$.apk"

if [[ -z "${SSHPASS:-}" ]]; then
  echo "Нет SSHPASS. Создайте $ROOT/.env.deploy" >&2
  exit 1
fi

ssh_cmd() { sshpass -e ssh -o StrictHostKeyChecking=no "$@"; }
scp_cmd() { sshpass -e scp -o StrictHostKeyChecking=no "$@"; }

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  "$ROOT/scripts/build-kiosk-apk.sh" "$VERSION_CODE" "$VERSION_NAME"
fi

APK="$(ls -t "$ROOT"/dist/ImperialMcKiosk-v"${VERSION_CODE}"-*.apk 2>/dev/null | head -1 || true)"
if [[ -z "$APK" || ! -f "$APK" ]]; then
  APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
fi
if [[ ! -f "$APK" ]]; then
  echo "APK киоска не найден" >&2
  exit 1
fi

REMOTE_NAME="kiosk-v${VERSION_CODE}-$(date +%s).apk"
scp_cmd "$APK" "${DEPLOY_HOST}:${REMOTE_TMP}"

ssh_cmd "$DEPLOY_HOST" bash -s <<EOF
set -euo pipefail
docker cp '${REMOTE_TMP}' '${APP_CONTAINER}:/app/public/updates/${REMOTE_NAME}'
docker cp '${REMOTE_TMP}' '${APP_CONTAINER}:/app/public/updates/kiosk.apk'
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
let manifest = { apk: {}, js: {}, kiosk: {} };
try { manifest = JSON.parse(fs.readFileSync(path, "utf8")); } catch (_) {}
manifest.kiosk = { versionCode, versionName, file, sha256, notes };
fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\\n");
console.log("Published kiosk APK", JSON.stringify(manifest.kiosk));
'
EOF

echo "Скачать: https://imperial-mc.online/updates/kiosk.apk"

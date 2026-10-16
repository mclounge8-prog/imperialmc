#!/usr/bin/env bash
# Опубликовать JS OTA кухни. Не трогает бандл зала и киоска.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.deploy" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.deploy"
  set +a
fi

JS_VERSION="${1:?Укажите JS version: ./scripts/publish-kitchen-js-ota.sh 1}"
NOTES="${2:-}"
MIN_APK="${3:-3}"
SKIP_BUILD=0
if [[ "${4:-}" == "--skip-build" || "${3:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
  if [[ "${3:-}" == "--skip-build" ]]; then
    MIN_APK="3"
  fi
fi

DEPLOY_HOST="${TERMINAL_DEPLOY_HOST:-root@176.57.218.9}"
APP_CONTAINER="${TERMINAL_APP_CONTAINER:-imperial-mc-backoffice-app-1}"
REMOTE_TMP="/tmp/imperial-kitchen-js-$$.zip"

if [[ -z "${SSHPASS:-}" ]]; then
  echo "Нет SSHPASS" >&2
  exit 1
fi

ssh_cmd() { sshpass -e ssh -o StrictHostKeyChecking=no "$@"; }
scp_cmd() { sshpass -e scp -o StrictHostKeyChecking=no "$@"; }

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  "$ROOT/scripts/build-kitchen-js-ota.sh" "$JS_VERSION"
fi

ZIP="$ROOT/dist/kitchen-js-ota-v${JS_VERSION}.zip"
if [[ ! -f "$ZIP" ]]; then
  echo "ZIP не найден: $ZIP" >&2
  exit 1
fi

REMOTE_NAME="kitchen-js-ota-v${JS_VERSION}-$(date +%s).zip"
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
  -e MANDATORY='${MANDATORY:-1}' \\
  '${APP_CONTAINER}' node -e '
const fs = require("fs");
const crypto = require("crypto");
const path = "/app/public/updates/manifest.json";
const file = process.env.REMOTE_NAME;
const version = Number(process.env.JS_VERSION);
const minApkVersionCode = Number(process.env.MIN_APK) || 3;
const notes = process.env.NOTES || "";
const buf = fs.readFileSync("/app/public/updates/" + file);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
manifest.kitchenJs = {
  version,
  minApkVersionCode,
  file,
  sha256,
  mandatory: process.env.MANDATORY !== "0",
  notes,
};
fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\\n");
console.log("Published kitchen JS OTA", JSON.stringify(manifest.kitchenJs));
'
EOF

echo "Готово."

#!/usr/bin/env bash
# Сборка release APK киоска (другой applicationId — ставится рядом с терминалом).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION_CODE="${1:-1}"
VERSION_NAME="${2:-1.0.0}"

echo "==> Kiosk APK versionCode=${VERSION_CODE} versionName=${VERSION_NAME}"
cd android
./gradlew assembleRelease -Pkiosk=true -PkioskVersionCode="${VERSION_CODE}" -PkioskVersionName="${VERSION_NAME}"
cd ..

OUT="android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$OUT" ]]; then
  echo "APK не найден: $OUT" >&2
  exit 1
fi

DEST_DIR="$ROOT/dist"
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/ImperialMcKiosk-v${VERSION_CODE}-${VERSION_NAME}.apk"
cp -f "$OUT" "$DEST"
echo "Готово: $DEST"

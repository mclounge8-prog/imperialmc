#!/usr/bin/env bash
# Сборка release APK для публикации в бэкофисе (раздел «Обновления»).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION_CODE="${1:-}"
VERSION_NAME="${2:-}"

if [[ -n "$VERSION_CODE" ]]; then
  sed -i "s/versionCode [0-9]\\+/versionCode ${VERSION_CODE}/" android/app/build.gradle
fi
if [[ -n "$VERSION_NAME" ]]; then
  sed -i "s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME}\"/" android/app/build.gradle
fi

echo "==> Bundling + assembling release APK…"
cd android
./gradlew assembleRelease
cd ..

OUT="android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$OUT" ]]; then
  echo "APK не найден: $OUT" >&2
  exit 1
fi

DEST_DIR="$ROOT/dist"
mkdir -p "$DEST_DIR"
CODE="$(grep -oE 'versionCode [0-9]+' android/app/build.gradle | head -1 | awk '{print $2}')"
NAME="$(grep -oE 'versionName "[^"]+"' android/app/build.gradle | head -1 | sed 's/versionName \"//;s/\"//')"
DEST="$DEST_DIR/ImperialMcTerminal-v${CODE}-${NAME}.apk"
cp -f "$OUT" "$DEST"

echo ""
echo "Готово: $DEST"
echo "Дальше: бэкофис → Обновления → Загрузить APK"
echo "  versionCode=$CODE  versionName=$NAME"

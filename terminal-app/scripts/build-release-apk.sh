#!/usr/bin/env bash
# Сборка release APK для публикации в бэкофисе (раздел «Обновления»).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION_CODE="${1:-}"
VERSION_NAME="${2:-}"

# macOS sed требует sed -i '', Linux — sed -i
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

if [[ -n "$VERSION_CODE" ]]; then
  sed_inplace "s/versionCode [0-9][0-9]*/versionCode ${VERSION_CODE}/" android/app/build.gradle
fi
if [[ -n "$VERSION_NAME" ]]; then
  sed_inplace "s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME}\"/" android/app/build.gradle
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
echo "Опубликовать на сервер без браузера:"
echo "  ./scripts/publish-apk.sh $CODE $NAME"
echo "  # или уже собранный файл:"
echo "  ./scripts/publish-apk.sh $CODE $NAME \"\" --skip-build"
echo "versionCode=$CODE  versionName=$NAME"

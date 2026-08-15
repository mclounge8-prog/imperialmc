#!/usr/bin/env bash
# Сборка JS OTA zip (только JS, без native). Для публикации в бэкофисе.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JS_VERSION="${1:?Укажите номер JS version, например: ./scripts/build-js-ota.sh 3}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Metro bundle (android, release)…"
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output "$WORKDIR/index.android.bundle" \
  --assets-dest "$WORKDIR/assets"

# В ZIP кладём бандл в корень — UpdateModule ищет index.android.bundle.
# Локальные require()-картинки остаются из APK; менять ассеты через JS OTA нельзя.
ZIP_DIR="$ROOT/dist"
mkdir -p "$ZIP_DIR"
ZIP="$ZIP_DIR/js-ota-v${JS_VERSION}.zip"
rm -f "$ZIP"
(
  cd "$WORKDIR"
  zip -q -r "$ZIP" index.android.bundle
)

echo ""
echo "Готово: $ZIP"
echo "Дальше: бэкофис → Обновления → Загрузить JS OTA"
echo "  version=$JS_VERSION  (minApkVersionCode = текущий versionCode установленных планшетов)"

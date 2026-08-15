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
  --bundle-output "$WORKDIR/index.android.bundle.js" \
  --assets-dest "$WORKDIR/assets"

# Hermes bytecode — иначе release APK с Hermes не подхватит plain JS и OTA «не применится».
HERMESC="$(find "$ROOT/node_modules/react-native/sdks/hermesc" -type f -name hermesc 2>/dev/null | head -1 || true)"
if [[ -z "$HERMESC" ]]; then
  HERMESC="$(find "$ROOT/node_modules/hermes-compiler" -type f -path '*/linux64-bin/hermesc' 2>/dev/null | head -1 || true)"
fi
if [[ -z "$HERMESC" ]]; then
  HERMESC="$(find "$ROOT/node_modules" -type f -path '*/linux64-bin/hermesc' 2>/dev/null | head -1 || true)"
fi
if [[ -z "$HERMESC" ]]; then
  HERMESC="$(find "$ROOT/node_modules/react-native" -type f -name hermesc 2>/dev/null | head -1 || true)"
fi

BUNDLE_OUT="$WORKDIR/index.android.bundle"
if [[ -n "$HERMESC" && -x "$HERMESC" ]]; then
  echo "==> Hermes compile ($HERMESC)…"
  "$HERMESC" -O -emit-binary -out "$BUNDLE_OUT" "$WORKDIR/index.android.bundle.js"
else
  echo "WARN: hermesc не найден — кладём plain JS (на Hermes-сборке OTA может не взлететь)"
  mv "$WORKDIR/index.android.bundle.js" "$BUNDLE_OUT"
fi

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
echo "Опубликовать: ./scripts/publish-js-ota.sh $JS_VERSION"
echo "  (minApkVersionCode = текущий versionCode установленных планшетов)"

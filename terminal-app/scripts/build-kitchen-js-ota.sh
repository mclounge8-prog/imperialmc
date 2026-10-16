#!/usr/bin/env bash
# JS OTA только для приложения кухни (entry index.kitchen.js). Не путать с OTA зала.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JS_VERSION="${1:?Укажите номер: ./scripts/build-kitchen-js-ota.sh 1}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Metro bundle кухни (android, release)…"
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.kitchen.js \
  --bundle-output "$WORKDIR/index.android.bundle.js" \
  --assets-dest "$WORKDIR/assets"

HERMESC="$(find "$ROOT/node_modules/react-native/sdks/hermesc" -type f -name hermesc 2>/dev/null | head -1 || true)"
if [[ -z "$HERMESC" ]]; then
  HERMESC="$(find "$ROOT/node_modules/hermes-compiler" -type f -path '*/linux64-bin/hermesc' 2>/dev/null | head -1 || true)"
fi
if [[ -z "$HERMESC" ]]; then
  HERMESC="$(find "$ROOT/node_modules" -type f -path '*/linux64-bin/hermesc' 2>/dev/null | head -1 || true)"
fi
if [[ -z "$HERMESC" || ! -x "$HERMESC" ]]; then
  echo "ERROR: hermesc не найден" >&2
  exit 1
fi

echo "==> Hermes compile ($HERMESC)…"
"$HERMESC" -O -emit-binary -out "$WORKDIR/index.android.bundle" "$WORKDIR/index.android.bundle.js"

ZIP_DIR="$ROOT/dist"
mkdir -p "$ZIP_DIR"
ZIP="$ZIP_DIR/kitchen-js-ota-v${JS_VERSION}.zip"
rm -f "$ZIP"
(
  cd "$WORKDIR"
  zip -q -r "$ZIP" index.android.bundle
)

echo "Готово: $ZIP"
echo "Опубликовать: ./scripts/publish-kitchen-js-ota.sh $JS_VERSION"

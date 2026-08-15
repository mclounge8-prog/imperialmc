/** Фиксированные размеры плитки стола на схеме (координаты редактора). */
export const TABLE_SIZE_PRESETS = {
  small: { width: 72, height: 56, label: 'Маленький' },
  medium: { width: 96, height: 72, label: 'Средний' },
  large: { width: 128, height: 96, label: 'Большой' },
};

export const TABLE_SIZE_VALUES = Object.keys(TABLE_SIZE_PRESETS);

export function normalizeTableSizeKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return TABLE_SIZE_VALUES.includes(key) ? key : 'medium';
}

export function dimensionsForSize(size) {
  const key = normalizeTableSizeKey(size);
  return TABLE_SIZE_PRESETS[key];
}

/** Миграция со старых свободных width/height в пресет. */
export function sizeFromLegacyDimensions(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w >= 110 || h >= 88) return 'large';
  if (w > 0 && h > 0 && (w <= 80 || h <= 60)) return 'small';
  return 'medium';
}

export function withTableDimensions(table) {
  const size = table.size
    ? normalizeTableSizeKey(table.size)
    : sizeFromLegacyDimensions(table.width, table.height);
  const dims = dimensionsForSize(size);
  return { ...table, size, width: dims.width, height: dims.height };
}

/** Общая сетка схемы зала — одинаковая в бэкофисе и на терминале. */
export const GRID_CELL = 40;
export const GRID_COLS = 20;
export const GRID_ROWS = 12;

export const FLOOR_PLAN_WIDTH = GRID_CELL * GRID_COLS; // 800
export const FLOOR_PLAN_HEIGHT = GRID_CELL * GRID_ROWS; // 480

/** Размеры столов в клетках сетки → px. */
export const TABLE_SIZE_PRESETS = {
  small: { cols: 2, rows: 2, width: GRID_CELL * 2, height: GRID_CELL * 2, label: 'Маленький (2×2)' },
  medium: { cols: 3, rows: 2, width: GRID_CELL * 3, height: GRID_CELL * 2, label: 'Средний (3×2)' },
  large: { cols: 4, rows: 3, width: GRID_CELL * 4, height: GRID_CELL * 3, label: 'Большой (4×3)' },
};

export const TABLE_SIZE_VALUES = Object.keys(TABLE_SIZE_PRESETS);

export function normalizeTableSizeKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return TABLE_SIZE_VALUES.includes(key) ? key : 'medium';
}

export function dimensionsForSize(size) {
  const key = normalizeTableSizeKey(size);
  const preset = TABLE_SIZE_PRESETS[key];
  return { width: preset.width, height: preset.height, cols: preset.cols, rows: preset.rows };
}

export function snapToGrid(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n / GRID_CELL) * GRID_CELL);
}

export function clampTablePosition(posX, posY, width, height) {
  const maxX = Math.max(0, FLOOR_PLAN_WIDTH - width);
  const maxY = Math.max(0, FLOOR_PLAN_HEIGHT - height);
  return {
    posX: Math.min(maxX, snapToGrid(posX)),
    posY: Math.min(maxY, snapToGrid(posY)),
  };
}

/** Миграция со старых свободных width/height в пресет. */
export function sizeFromLegacyDimensions(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w >= GRID_CELL * 4 || h >= GRID_CELL * 3) return 'large';
  if (w > 0 && h > 0 && (w <= GRID_CELL * 2 || h <= GRID_CELL * 2)) return 'small';
  return 'medium';
}

export function withTableDimensions(table) {
  const size = table.size
    ? normalizeTableSizeKey(table.size)
    : sizeFromLegacyDimensions(table.width, table.height);
  const dims = dimensionsForSize(size);
  const snapped = clampTablePosition(table.pos_x, table.pos_y, dims.width, dims.height);
  return {
    ...table,
    size,
    width: dims.width,
    height: dims.height,
    pos_x: snapped.posX,
    pos_y: snapped.posY,
  };
}

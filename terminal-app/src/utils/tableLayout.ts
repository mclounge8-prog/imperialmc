import type { TableInfo, TableSize } from '../api/client';

/** Должно совпадать с backoffice/src/tableSizes.js */
export const GRID_CELL = 40;
export const GRID_COLS = 20;
export const GRID_ROWS = 12;
export const FLOOR_PLAN_WIDTH = GRID_CELL * GRID_COLS;
export const FLOOR_PLAN_HEIGHT = GRID_CELL * GRID_ROWS;

export const TABLE_SIZE_PRESETS: Record<
  TableSize,
  { cols: number; rows: number; width: number; height: number }
> = {
  small: { cols: 2, rows: 2, width: GRID_CELL * 2, height: GRID_CELL * 2 },
  medium: { cols: 3, rows: 2, width: GRID_CELL * 3, height: GRID_CELL * 2 },
  large: { cols: 4, rows: 3, width: GRID_CELL * 4, height: GRID_CELL * 3 },
};

export function normalizeTableSize(value: string | undefined | null): TableSize {
  if (value === 'small' || value === 'large' || value === 'medium') return value;
  return 'medium';
}

export function layoutSizeForTable(table: Pick<TableInfo, 'size' | 'width' | 'height'>): {
  width: number;
  height: number;
} {
  return TABLE_SIZE_PRESETS[normalizeTableSize(table.size)];
}

export function snapToGrid(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / GRID_CELL) * GRID_CELL);
}

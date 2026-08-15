import type { TableInfo, TableSize } from '../api/client';

/** Должно совпадать с backoffice/src/tableSizes.js (логика клеток). */
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
  cols: number;
  rows: number;
} {
  return TABLE_SIZE_PRESETS[normalizeTableSize(table.size)];
}

export function snapToGrid(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / GRID_CELL) * GRID_CELL);
}

export function posToCell(pos: number): number {
  return Math.max(0, Math.round(snapToGrid(pos) / GRID_CELL));
}

export type GridRenderedTable = TableInfo & {
  left: number;
  top: number;
  tileWidth: number;
  tileHeight: number;
};

/**
 * Рендер схемы: клетки заполняют весь viewport терминала.
 * col/row те же, что в бэкофисе — без обрезки правого края и низа.
 */
export function layoutTablesOnViewport(
  tables: TableInfo[],
  viewportWidth: number,
  viewportHeight: number
): { planWidth: number; planHeight: number; cellW: number; cellH: number; tables: GridRenderedTable[] } {
  const planWidth = Math.max(1, Math.floor(viewportWidth));
  const planHeight = Math.max(1, Math.floor(viewportHeight));
  const cellW = planWidth / GRID_COLS;
  const cellH = planHeight / GRID_ROWS;

  return {
    planWidth,
    planHeight,
    cellW,
    cellH,
    tables: tables.map((table) => {
      const size = normalizeTableSize(table.size);
      const preset = TABLE_SIZE_PRESETS[size];
      const col = Math.min(GRID_COLS - preset.cols, posToCell(table.posX));
      const row = Math.min(GRID_ROWS - preset.rows, posToCell(table.posY));
      const left = Math.round(col * cellW);
      const top = Math.round(row * cellH);
      const right = Math.round((col + preset.cols) * cellW);
      const bottom = Math.round((row + preset.rows) * cellH);
      return {
        ...table,
        size,
        width: preset.width,
        height: preset.height,
        left,
        top,
        tileWidth: Math.max(1, right - left),
        tileHeight: Math.max(1, bottom - top),
      };
    }),
  };
}

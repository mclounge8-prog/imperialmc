import type { TableInfo, TableSize } from '../api/client';

export const TABLE_SIZE_PRESETS: Record<TableSize, { width: number; height: number }> = {
  small: { width: 72, height: 56 },
  medium: { width: 96, height: 72 },
  large: { width: 128, height: 96 },
};

export function normalizeTableSize(value: string | undefined | null): TableSize {
  if (value === 'small' || value === 'large' || value === 'medium') return value;
  return 'medium';
}

export function layoutSizeForTable(table: Pick<TableInfo, 'size' | 'width' | 'height'>): {
  width: number;
  height: number;
} {
  const size = normalizeTableSize(table.size);
  return TABLE_SIZE_PRESETS[size];
}

export type FittedFloorPlan = {
  scale: number;
  planWidth: number;
  planHeight: number;
  tables: Array<TableInfo & { left: number; top: number; tileWidth: number; tileHeight: number }>;
};

/** Подгоняет схему под доступную область: целиком на экране, без скролла. */
export function fitFloorPlan(
  tables: TableInfo[],
  availWidth: number,
  availHeight: number,
  padding = 12
): FittedFloorPlan {
  const safeW = Math.max(1, availWidth - padding * 2);
  const safeH = Math.max(1, availHeight - padding * 2);

  const layoutTables = tables.map((table) => {
    const dims = layoutSizeForTable(table);
    return {
      ...table,
      size: normalizeTableSize(table.size),
      layoutWidth: dims.width,
      layoutHeight: dims.height,
    };
  });

  const contentW = Math.max(...layoutTables.map((t) => t.posX + t.layoutWidth), 1);
  const contentH = Math.max(...layoutTables.map((t) => t.posY + t.layoutHeight), 1);
  const scale = Math.min(safeW / contentW, safeH / contentH);

  return {
    scale,
    planWidth: Math.max(1, Math.round(contentW * scale)),
    planHeight: Math.max(1, Math.round(contentH * scale)),
    tables: layoutTables.map((table) => ({
      ...table,
      left: Math.round(table.posX * scale),
      top: Math.round(table.posY * scale),
      tileWidth: Math.max(36, Math.round(table.layoutWidth * scale)),
      tileHeight: Math.max(28, Math.round(table.layoutHeight * scale)),
    })),
  };
}

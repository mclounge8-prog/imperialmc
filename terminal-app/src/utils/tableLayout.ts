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
  scaleX: number;
  scaleY: number;
  /** Средний масштаб — для размера шрифта на плитке. */
  scale: number;
  planWidth: number;
  planHeight: number;
  tables: Array<TableInfo & { left: number; top: number; tileWidth: number; tileHeight: number }>;
};

/**
 * Растягивает схему на всю доступную ширину и высоту (scaleX/scaleY независимо),
 * без пустых полей сверху/снизу/по бокам.
 */
export function fitFloorPlan(
  tables: TableInfo[],
  availWidth: number,
  availHeight: number,
  padding = 0
): FittedFloorPlan {
  const planWidth = Math.max(1, Math.floor(availWidth - padding * 2));
  const planHeight = Math.max(1, Math.floor(availHeight - padding * 2));

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
  const scaleX = planWidth / contentW;
  const scaleY = planHeight / contentH;
  const scale = Math.sqrt(scaleX * scaleY);

  return {
    scaleX,
    scaleY,
    scale,
    planWidth,
    planHeight,
    tables: layoutTables.map((table) => ({
      ...table,
      left: Math.round(table.posX * scaleX),
      top: Math.round(table.posY * scaleY),
      tileWidth: Math.max(36, Math.round(table.layoutWidth * scaleX)),
      tileHeight: Math.max(28, Math.round(table.layoutHeight * scaleY)),
    })),
  };
}

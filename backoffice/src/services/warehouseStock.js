/**
 * Сколько вернуть на склад по строкам чека.
 * qty модификатора — расход на 1 порцию, qty строки — число порций.
 * Так же списывается при добавлении позиции (расход × количество).
 */
export function stockDeltasForItems(items) {
  const totals = new Map();
  for (const item of items || []) {
    const rawQty = Number(item?.qty);
    const itemQty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 0;
    if (itemQty <= 0) continue;
    for (const mod of item.modifiers || []) {
      const id = mod?.warehouse_item_id ?? mod?.warehouseItemId ?? null;
      const perUnit = Number(mod?.qty) || 0;
      if (!id || perUnit <= 0) continue;
      const key = Number(id);
      totals.set(key, (totals.get(key) || 0) + perUnit * itemQty);
    }
  }
  return [...totals.entries()].map(([warehouseItemId, deltaQty]) => ({
    warehouseItemId,
    deltaQty,
  }));
}

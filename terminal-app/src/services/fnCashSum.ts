/** Сумма наличных в денежном ящике по ответу АТОЛ getShiftTotals. */
export function readFnCashSum(response: unknown): number | null {
  if (!response || typeof response !== 'object') return null;
  const root = response as Record<string, unknown>;
  const totals = asRecord(root.shiftTotals) || asRecord(root.ShiftTotals) || root;
  const drawer = asRecord(totals.cashDrawer) || asRecord(totals.CashDrawer);
  const raw = drawer ? drawer.sum ?? drawer.Sum : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

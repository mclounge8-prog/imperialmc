export type DrawerCash = {
  openingCash: number;
  expectedCash: number;
};

export function openDrawerCash(
  shift: {
    status?: string;
    cash?: { openingCash?: number; expectedCash?: number } | null;
  } | null
): DrawerCash | null {
  if (!shift || shift.status !== 'open' || !shift.cash) return null;
  const openingCash = Number(shift.cash.openingCash);
  const expectedCash = Number(shift.cash.expectedCash);
  if (!Number.isFinite(openingCash) || !Number.isFinite(expectedCash)) return null;
  return { openingCash, expectedCash };
}

export function formatDrawerMoney(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

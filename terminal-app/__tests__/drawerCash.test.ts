import { formatDrawerMoney, openDrawerCash } from '../src/utils/drawerCash';

describe('openDrawerCash', () => {
  test('returns both amounts only while the shift is open', () => {
    expect(
      openDrawerCash({
        status: 'open',
        cash: { openingCash: 5000, expectedCash: 12400.4 },
      })
    ).toEqual({ openingCash: 5000, expectedCash: 12400.4 });
    expect(openDrawerCash({ status: 'closed', cash: { openingCash: 1, expectedCash: 2 } })).toBeNull();
    expect(openDrawerCash(null)).toBeNull();
    expect(openDrawerCash({ status: 'open', cash: null })).toBeNull();
  });

  test('formats rounded rubles', () => {
    expect(formatDrawerMoney(12400.4)).toMatch(/12[\s\u00a0\u202f]400 ₽/);
    expect(formatDrawerMoney(0)).toMatch(/0 ₽/);
  });
});

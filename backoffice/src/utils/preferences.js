import { getCookie, setCookie } from 'hono/cookie';

const SECTION_COOKIE = 'imc_last_section';
const VENUE_COOKIE = 'imc_selected_venue';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // год — это просто "где я в последний раз был", не секрет

/**
 * В каком разделе бэкофиса админ был последний раз — читается при полной
 * загрузке /dashboard (F5), чтобы обновление страницы оставляло на месте
 * (в «Складе», «Меню» и т.д.), а не сбрасывало на «Главную». Хэш в URL
 * (#warehouse) на сервер никогда не попадает — cookie — единственный способ
 * серверу узнать, где был пользователь.
 */
export function readLastSection(c) {
  return getCookie(c, SECTION_COOKIE) || null;
}

export function writeLastSection(c, key) {
  setCookie(c, SECTION_COOKIE, key, { path: '/', maxAge: COOKIE_MAX_AGE, sameSite: 'Lax' });
}

/** Заведение, выбранное в общем переключателе в шапке — общее для склада,
 *  меню и столов, чтобы не выбирать его заново при каждом переключении раздела. */
export function readSelectedVenueId(c) {
  const raw = getCookie(c, VENUE_COOKIE);
  return raw ? Number(raw) : null;
}

export function writeSelectedVenueId(c, venueId) {
  setCookie(c, VENUE_COOKIE, String(venueId), { path: '/', maxAge: COOKIE_MAX_AGE, sameSite: 'Lax' });
}

/** Сохранённое в cookie заведение, если оно всё ещё существует в списке,
 *  иначе первое по списку (или null, если заведений нет вообще). */
export function resolveSelectedVenue(venues, requestedId) {
  if (venues.length === 0) return null;
  if (requestedId) {
    const found = venues.find((v) => v.id === requestedId);
    if (found) return found;
  }
  return venues[0];
}

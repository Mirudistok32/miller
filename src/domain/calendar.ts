/**
 * Дата уровня дня — строка ГГГГ-ММ-ДД по часам игрока. Арифметика дат без Date: номер дня
 * от 1970-01-01 по пролептическому григорианскому календарю (алгоритм Хиннанта).
 */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Номер дня от 1970-01-01. */
export function dayNumber(key: string): number {
  const m = DATE_KEY.exec(key);
  if (!m) return NaN;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const y = Number(m[1]) - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** День по номеру → ГГГГ-ММ-ДД. */
export function keyOfDay(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Настоящая дата в нужном виде (не 2026-02-30 и не «завтра»-мусор). */
export const isDateKey = (value: unknown): value is string =>
  typeof value === 'string' && DATE_KEY.test(value) && keyOfDay(dayNumber(value)) === value;

export const addDays = (key: string, days: number): string => keyOfDay(dayNumber(key) + days);

/** Месяц 0–11. */
export const monthOfKey = (key: string): number => Number(key.slice(5, 7)) - 1;

/** Сколько дней подряд, заканчивая днём key, уровень дня решён. */
export function streakOf(solved: (key: string) => boolean, key: string): number {
  let count = 0;
  for (let k = key; solved(k) && count < 10_000; k = addDays(k, -1)) count++;
  return count;
}

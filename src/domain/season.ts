/** Время года меняет только вид деревни: траву, деревья, погоду. Правила те же. */

export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

export const isSeason = (value: unknown): value is Season =>
  typeof value === 'string' && (SEASONS as readonly string[]).includes(value);

/** Месяц 0–11 → время года (декабрь — зима). */
export function seasonOfMonth(month: number): Season {
  if (month === 11 || month < 2) return 'winter';
  if (month < 5) return 'spring';
  if (month < 8) return 'summer';
  return 'autumn';
}

/** Сколько уровней бесконечного режима идёт одно время года. */
export const LEVELS_PER_SEASON = 5;
const ENDLESS_ORDER: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Бесконечный режим начинается весной и проходит год за 20 уровней. */
export function seasonOfLevel(level: number): Season {
  const k = Math.floor((Math.max(1, level) - 1) / LEVELS_PER_SEASON) % ENDLESS_ORDER.length;
  return ENDLESS_ORDER[k] ?? 'spring';
}

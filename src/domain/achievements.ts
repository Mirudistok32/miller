import type { SolveResult } from './result';
import { type Season, SEASONS } from './season';

/** id ачивок — ключи в сохранении: не переименовывать без миграции. */
export const ACHIEVEMENT_IDS = [
  'first-mill',
  'daily',
  'streak-3',
  'streak-7',
  'perfect',
  'perfect-5',
  'swift',
  'dry',
  'level-10',
  'level-25',
  'four-seasons',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export const isAchievementId = (value: unknown): value is AchievementId =>
  typeof value === 'string' && (ACHIEVEMENT_IDS as readonly string[]).includes(value);

export const STREAK_SHORT = 3;
export const STREAK_LONG = 7;
export const PERFECT_MANY = 5;
export const SWIFT_SECONDS = 60;
export const LEVEL_MID = 10;
export const LEVEL_HIGH = 25;

/** Накопленное за всё время — уже с учётом этого решения. */
export interface Totals {
  perfect: number;
  seasons: readonly Season[];
  /** Серия уровня дня, дней подряд; 0 — решён не уровень дня. */
  streak: number;
}

/** Какие ачивки заслужены этим решением. Повтор не страшен: выдаются те, которых ещё нет. */
export function earnedBy(r: SolveResult, totals: Totals): AchievementId[] {
  const out: AchievementId[] = ['first-mill'];
  if (r.mode === 'daily') out.push('daily');
  if (totals.streak >= STREAK_SHORT) out.push('streak-3');
  if (totals.streak >= STREAK_LONG) out.push('streak-7');
  if (r.moves <= r.minMoves && r.hints === 0) out.push('perfect');
  if (totals.perfect >= PERFECT_MANY) out.push('perfect-5');
  if (r.mode === 'daily' && r.time <= SWIFT_SECONDS) out.push('swift');
  if (r.dry) out.push('dry');
  if (r.mode === 'endless' && (r.level ?? 0) >= LEVEL_MID) out.push('level-10');
  if (r.mode === 'endless' && (r.level ?? 0) >= LEVEL_HIGH) out.push('level-25');
  if (SEASONS.every((s) => totals.seasons.includes(s))) out.push('four-seasons');
  return out;
}

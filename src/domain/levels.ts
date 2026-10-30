/**
 * Какие уровни бывают: уровень дня (сид по дате — одинаковый у всех), бесконечный режим
 * (сид по номеру, сложность растёт) и демо в меню. Сиды с версией: изменение генератора
 * меняет все уровни, поэтому новая версия — осознанное решение (docs/decisions.md).
 */

import { generateLevel, type Level, type LevelParams } from './generator';
import { hashString } from './random';

export const SEED_VERSION = 3;

/** Порог путей на всех уровнях: кратчайший один, обходов не больше трёх. */
const MAX_PATHS = 4;

export const dailySeed = (date: string): number =>
  hashString(`miller:daily:v${SEED_VERSION}:${date}`);

export const endlessSeed = (level: number): number =>
  hashString(`miller:endless:v${SEED_VERSION}:${level}`);

export const demoSeed = (round: number): number => hashString(`miller:demo:v1:${round}`);

/** Чей недоигранный уровень в сохранении: другая версия сида — уже другой уровень. */
export const dailyKey = (date: string): string => `daily:v${SEED_VERSION}:${date}`;

export const endlessKey = (level: number): string => `endless:v${SEED_VERSION}:${level}`;

/** Уровень дня: поле 5×5 — его первым видит новичок, поэтому сложность как у средних ступеней. */
export const DAILY_PARAMS: LevelParams = {
  cols: 5,
  rows: 5,
  teeShare: 0.05,
  emptyShare: 0.45,
  pathShare: [0.3, 0.42],
  misturnShare: 0.6,
  minMoves: 7,
  maxMoves: 9,
  maxPaths: MAX_PATHS,
};

/** Демо в меню: автопилот решает его на глазах. */
export const DEMO_PARAMS: LevelParams = {
  cols: 5,
  rows: 5,
  teeShare: 0.1,
  emptyShare: 0.3,
  pathShare: [0.35, 0.5],
  misturnShare: 0.7,
  minMoves: 6,
  maxMoves: 12,
  maxPaths: MAX_PATHS,
};

interface Tier {
  /** С какого уровня действует. */
  from: number;
  params: LevelParams;
}

const tier = (
  from: number,
  [cols, rows]: readonly [number, number],
  teeShare: number,
  emptyShare: number,
  pathShare: readonly [number, number],
  misturnShare: number,
  [minMoves, maxMoves]: readonly [number, number],
): Tier => ({
  from,
  params: {
    cols,
    rows,
    teeShare,
    emptyShare,
    pathShare,
    misturnShare,
    minMoves,
    maxMoves,
    maxPaths: MAX_PATHS,
  },
});

/**
 * Ступени бесконечного режима: поле растёт от 3×3 до 7×7, не больше чем на столбец или ряд за
 * ступень; путь воды удлиняется, нужно больше ходов. Первые ступени без развилок и почти без
 * обманок: на них игрок учится. Обходов всюду не больше порога, поэтому медиана минимума растёт от
 * ступени к ступени (замер — docs/decisions.md, PLAN-LOG, сид v3).
 */
export const TIERS: readonly Tier[] = [
  tier(1, [3, 3], 0, 0.85, [0.3, 0.45], 0.4, [2, 2]),
  tier(3, [3, 3], 0, 0.7, [0.45, 0.6], 0.5, [3, 3]),
  tier(5, [3, 4], 0, 0.65, [0.4, 0.55], 0.5, [4, 4]),
  tier(8, [4, 4], 0, 0.6, [0.3, 0.45], 0.5, [5, 5]),
  tier(11, [4, 5], 0.03, 0.5, [0.3, 0.45], 0.55, [6, 7]),
  tier(15, [5, 5], 0.05, 0.45, [0.3, 0.42], 0.6, [7, 9]),
  tier(20, [5, 6], 0.08, 0.4, [0.32, 0.45], 0.65, [9, 12]),
  tier(27, [6, 6], 0.1, 0.32, [0.36, 0.5], 0.7, [11, 15]),
  tier(36, [6, 7], 0.12, 0.28, [0.4, 0.55], 0.75, [13, 18]),
  tier(48, [7, 7], 0.15, 0.25, [0.45, 0.6], 0.8, [17, 26]),
  tier(65, [7, 7], 0.12, 0.22, [0.5, 0.65], 0.85, [20, 30]),
  tier(85, [7, 7], 0.1, 0.2, [0.55, 0.7], 0.9, [23, 34]),
  tier(110, [7, 7], 0.1, 0.2, [0.6, 0.75], 0.95, [26, 38]),
];

export function endlessParams(level: number): LevelParams {
  let found = TIERS[0];
  for (const t of TIERS) if (level >= t.from) found = t;
  if (!found) throw new Error('endlessParams: нет ступеней');
  return found.params;
}

export const dailyLevel = (date: string): Level => generateLevel(dailySeed(date), DAILY_PARAMS);

export const endlessLevel = (level: number): Level =>
  generateLevel(endlessSeed(level), endlessParams(level));

export const demoLevel = (round: number): Level => generateLevel(demoSeed(round), DEMO_PARAMS);

/** Размер поля для рекордов и подписей: «6x7». */
export const sizeKey = (p: Pick<LevelParams, 'cols' | 'rows'>): string => `${p.cols}x${p.rows}`;

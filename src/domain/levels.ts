/**
 * Какие уровни бывают: уровень дня (сид по дате — одинаковый у всех), бесконечный режим
 * (сид по номеру, сложность растёт) и демо в меню. Сиды с версией: изменение генератора
 * меняет все уровни, поэтому новая версия — осознанное решение (docs/decisions.md).
 */

import { generateLevel, type Level, type LevelParams } from './generator';
import { hashString } from './random';

export const SEED_VERSION = 2;

/** Порог путей на всех уровнях: кратчайший один, обходов не больше трёх. */
const MAX_PATHS = 4;

export const dailySeed = (date: string): number =>
  hashString(`miller:daily:v${SEED_VERSION}:${date}`);

export const endlessSeed = (level: number): number =>
  hashString(`miller:endless:v${SEED_VERSION}:${level}`);

export const demoSeed = (round: number): number => hashString(`miller:demo:v1:${round}`);

/** Уровень дня: поле 6×7 с развилками — на несколько минут; сложность как у поздних ступеней. */
export const DAILY_PARAMS: LevelParams = {
  cols: 6,
  rows: 7,
  teeShare: 0.15,
  emptyShare: 0.25,
  pathShare: [0.42, 0.58],
  misturnShare: 0.8,
  minMoves: 15,
  maxMoves: 24,
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
 * Ступени бесконечного режима: поле растёт до 7×7, путь воды удлиняется, нужно больше ходов.
 * Обходов всюду не больше порога, поэтому медиана минимума растёт от ступени к ступени
 * (замер — docs/decisions.md, PLAN-LOG, пункт 1.2).
 */
export const TIERS: readonly Tier[] = [
  tier(1, [4, 4], 0, 0.45, [0.3, 0.4], 0.5, [3, 7]),
  tier(2, [4, 5], 0.05, 0.4, [0.3, 0.45], 0.6, [5, 10]),
  tier(3, [5, 5], 0.08, 0.35, [0.32, 0.45], 0.65, [7, 12]),
  tier(4, [5, 6], 0.1, 0.3, [0.34, 0.48], 0.7, [9, 15]),
  tier(6, [6, 6], 0.12, 0.28, [0.38, 0.52], 0.75, [11, 18]),
  tier(9, [6, 7], 0.15, 0.25, [0.42, 0.58], 0.8, [14, 22]),
  tier(13, [7, 7], 0.15, 0.25, [0.45, 0.6], 0.8, [17, 26]),
  tier(18, [7, 7], 0.12, 0.22, [0.5, 0.65], 0.85, [20, 30]),
  tier(25, [7, 7], 0.1, 0.2, [0.55, 0.7], 0.9, [23, 34]),
  tier(40, [7, 7], 0.1, 0.2, [0.6, 0.75], 0.95, [26, 38]),
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

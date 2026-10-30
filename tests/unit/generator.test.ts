import { describe, expect, it } from 'vitest';

import { addDays } from '@/domain/calendar';
import { flow } from '@/domain/flow';
import { generateLevel, type Level, type LevelParams } from '@/domain/generator';
import { maskOf, rotsOf } from '@/domain/grid';
import {
  DAILY_PARAMS,
  dailyLevel,
  DEMO_PARAMS,
  demoLevel,
  endlessLevel,
  endlessParams,
  TIERS,
} from '@/domain/levels';
import { applyTurns, countPaths, solve } from '@/domain/solver';

import { draw } from './helpers';

/** Всё, что генератор обещает про любой уровень. */
function expectFair(level: Level, label: string) {
  const { board, solution, params } = level;
  const where = `${label}\n${draw(board)}`;
  expect(board.cols, where).toBe(params.cols);
  expect(board.rows, where).toBe(params.rows);
  expect(board.cells, where).toHaveLength(params.cols * params.rows);
  expect(board.source, where).toBeGreaterThanOrEqual(0);
  expect(board.mill, where).toBeLessThan(params.cols);
  expect(board.source, where).not.toBe(board.mill);
  // на старте вода до колеса не доходит
  expect(flow(board).solved, where).toBe(false);
  // решатель доказал минимум, и его решение действительно собирает путь
  expect(solution.exact, where).toBe(true);
  expect(solution.moves, where).toBeGreaterThan(0);
  expect(flow(applyTurns(board, solution.turns)).solved, where).toBe(true);
  // клетки пути — жёлоба, а не трава
  for (const c of solution.path) expect(board.cells[c]?.kind, where).not.toBe('empty');
}

/** Порог: кратчайший путь один, всего путей не больше maxPaths. */
function expectThreshold(level: Level, label: string) {
  const count = countPaths(level.board);
  const where = `${label}\n${draw(level.board)}`;
  expect(count.exact, where).toBe(true);
  expect(count.shortest, where).toBe(1);
  expect(count.total, where).toBeLessThanOrEqual(level.params.maxPaths);
  expect(count.moves, where).toBe(level.solution.moves);
}

const medianMoves = (params: LevelParams, sample: number) => {
  const moves = Array.from(
    { length: sample },
    (_, k) => generateLevel(k + 1, params).solution.moves,
  ).sort((a, b) => a - b);
  return moves[Math.floor((sample - 1) / 2)] ?? 0;
};

describe('генератор', () => {
  it(
    '1200 уровней дня подряд: каждый решаем, ни один не решён на старте, порог путей соблюдён',
    { timeout: 60_000 },
    () => {
      let date = '2026-01-01';
      for (let i = 0; i < 1200; i++, date = addDays(date, 1)) {
        const level = dailyLevel(date);
        expectFair(level, date);
        expectThreshold(level, date);
      }
    },
  );

  it(
    '1200 уровней бесконечного режима: каждый решаем, ни один не решён на старте, порог соблюдён',
    { timeout: 60_000 },
    () => {
      for (let n = 1; n <= 1200; n++) {
        const level = endlessLevel(n);
        expectFair(level, `уровень ${n}`);
        expectThreshold(level, `уровень ${n}`);
      }
    },
  );

  it('порог соблюдён на каждой ступени', { timeout: 60_000 }, () => {
    for (const { from, params } of TIERS) {
      for (let seed = 1; seed <= 200; seed++) {
        expectThreshold(generateLevel(seed, params), `ступень ${from}, сид ${seed}`);
      }
    }
  });

  it(
    'обманки остаются: поздний уровень не становится одним путём на пустом поле',
    {
      timeout: 60_000,
    },
    () => {
      for (const params of [DAILY_PARAMS, TIERS.at(-1)?.params ?? DAILY_PARAMS]) {
        for (let seed = 1; seed <= 100; seed++) {
          const { board, solution } = generateLevel(seed, params);
          const decoys = board.cells.filter(
            (c, i) => c.kind !== 'empty' && !solution.path.includes(i),
          );
          expect(decoys.length, draw(board)).toBeGreaterThanOrEqual(5);
        }
      }
    },
  );

  it('решатель, запущенный заново, находит тот же минимум', { timeout: 60_000 }, () => {
    for (let level = 1; level <= 150; level++) {
      const l = endlessLevel(level);
      expect(solve(l.board)?.moves, `уровень ${level}`).toBe(l.solution.moves);
    }
  });

  it('генерация быстрая: ни один уровень не дольше 250 мс', { timeout: 60_000 }, () => {
    let worst = 0;
    for (let level = 1; level <= 300; level++) {
      const t0 = performance.now();
      endlessLevel(level * 7);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(250);
  });

  it('крайние настройки не вешают генератор', { timeout: 60_000 }, () => {
    const extremes: LevelParams[] = [
      { ...DAILY_PARAMS, cols: 2, rows: 2 },
      { ...DAILY_PARAMS, cols: 9, rows: 9 },
      { ...DAILY_PARAMS, emptyShare: 1, teeShare: 1 },
      { ...DAILY_PARAMS, pathShare: [1, 1], minMoves: 999, maxMoves: 999 },
      { ...DAILY_PARAMS, pathShare: [0, 0], minMoves: 0, maxMoves: 0, misturnShare: 0 },
      { ...DAILY_PARAMS, cols: 9, rows: 2 },
      { ...DAILY_PARAMS, cols: 2, rows: 9 },
    ];
    for (const [i, params] of extremes.entries()) {
      for (let seed = 0; seed < 25; seed++) {
        const t0 = performance.now();
        const level = generateLevel(seed * 7919 + i, params);
        expect(performance.now() - t0).toBeLessThan(2000);
        expectFair(level, `крайность ${i}, сид ${seed}`);
      }
    }
  });

  it('недопустимое поле — понятная ошибка, а не зависание', () => {
    expect(() => generateLevel(1, { ...DAILY_PARAMS, cols: 1 })).toThrow(/поле/);
    expect(() => generateLevel(1, { ...DAILY_PARAMS, rows: 10 })).toThrow(/поле/);
    expect(() => generateLevel(1, { ...DAILY_PARAMS, cols: 4.5 })).toThrow(/поле/);
  });

  it('один сид — один и тот же уровень', () => {
    expect(generateLevel(42, DAILY_PARAMS)).toEqual(generateLevel(42, DAILY_PARAMS));
    expect(endlessLevel(7)).toEqual(endlessLevel(7));
  });

  it('разные сиды — разные поля, родник и колесо гуляют по всем столбцам', () => {
    const boards = new Set<string>();
    const sources = new Set<number>();
    const mills = new Set<number>();
    for (let seed = 0; seed < 120; seed++) {
      const { board } = generateLevel(seed, DAILY_PARAMS);
      boards.add(board.cells.map(maskOf).join(','));
      sources.add(board.source);
      mills.add(board.mill);
    }
    expect(boards.size).toBe(120);
    expect(sources.size).toBe(DAILY_PARAMS.cols);
    expect(mills.size).toBe(DAILY_PARAMS.cols);
  });

  it('в уровнях есть все три формы жёлобов, развилки — со второй ступени', () => {
    const kinds = new Set<string>();
    for (let level = 2; level <= 40; level++) {
      for (const c of endlessLevel(level).board.cells) kinds.add(c.kind);
    }
    expect([...kinds].sort()).toEqual(['corner', 'empty', 'straight', 'tee']);
    expect(endlessLevel(1).board.cells.some((c) => c.kind === 'tee')).toBe(false);
  });

  it('сложность растёт: поле не уменьшается, медиана минимума растёт', { timeout: 60_000 }, () => {
    const medians = TIERS.map((t) => medianMoves(endlessParams(t.from), 150));
    for (let i = 1; i < TIERS.length; i++) {
      const a = TIERS[i - 1]?.params;
      const b = TIERS[i]?.params;
      expect((b?.cols ?? 0) * (b?.rows ?? 0)).toBeGreaterThanOrEqual(
        (a?.cols ?? 0) * (a?.rows ?? 0),
      );
    }
    for (let i = 1; i < medians.length; i++) {
      expect(medians[i], `медианы по ступеням: ${medians.join(', ')}`).toBeGreaterThan(
        medians[i - 1] ?? 0,
      );
    }
  });

  it('минимум ходов обычно попадает в окно ступени', { timeout: 60_000 }, () => {
    for (const params of [...TIERS.map((t) => t.params), DAILY_PARAMS, DEMO_PARAMS]) {
      let inside = 0;
      for (let seed = 0; seed < 100; seed++) {
        const m = generateLevel(seed, params).solution.moves;
        if (m >= params.minMoves && m <= params.maxMoves) inside++;
      }
      expect(
        inside,
        `${params.cols}×${params.rows}, окно ${params.minMoves}–${params.maxMoves}`,
      ).toBeGreaterThanOrEqual(60);
    }
  });

  it('демо и уровни бесконечного режима не совпадают с уровнем дня', () => {
    const daily = rotsOf(dailyLevel('2026-10-30').board);
    expect(rotsOf(demoLevel(0).board)).not.toBe(daily);
    expect(rotsOf(endlessLevel(10).board)).not.toBe(daily);
  });
});

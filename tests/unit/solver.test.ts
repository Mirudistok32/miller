import { describe, expect, it } from 'vitest';

import { addDays } from '@/domain/calendar';
import { flow } from '@/domain/flow';
import {
  type Board,
  CCW,
  type Cell,
  CW,
  DIRS,
  E,
  KINDS,
  maskOf,
  N,
  neighbor,
  opposite,
  rotateCell,
  S,
  W,
} from '@/domain/grid';
import { dailyLevel, endlessLevel } from '@/domain/levels';
import { mulberry32, pick } from '@/domain/random';
import { applyTurns, countPaths, hintMove, solve, spinToFit, turnsToFit } from '@/domain/solver';

import { board, draw } from './helpers';

/** Цена t четвертей оборота: каждый ход — четверть в любую сторону. */
const turnCost = (t: number) => Math.min(t, 4 - t);

/** Честный перебор всех поворотов в обе стороны: минимум ходов или null, если решения нет. */
function bruteForce(b: Board): number | null {
  const n = b.cells.length;
  const options = b.cells.map((c) => (c.kind === 'empty' ? 1 : c.kind === 'straight' ? 2 : 4));
  const turns = new Array<number>(n).fill(0);
  let best: number | null = null;
  const walk = (i: number, spent: number) => {
    if (best !== null && spent >= best) return;
    if (i === n) {
      if (flow(applyTurns(b, turns)).solved) best = spent;
      return;
    }
    for (let t = 0; t < (options[i] ?? 1); t++) {
      turns[i] = t;
      walk(i + 1, spent + turnCost(t));
    }
    turns[i] = 0;
  };
  walk(0, 0);
  return best;
}

/**
 * Честный счёт путей: перебор всех поворотов, в каждом решённом поле — все простые пути по
 * стыкующимся жёлобам. Цена пути — наименьшая сумма поворотов среди полей, где он собран.
 */
function bruteForcePaths(b: Board) {
  const n = b.cells.length;
  const options = b.cells.map((c) => (c.kind === 'empty' ? 1 : c.kind === 'straight' ? 2 : 4));
  const turns = new Array<number>(n).fill(0);
  const paths = new Map<string, number>();
  const mill = (b.rows - 1) * b.cols + b.mill;

  const collect = (turned: Board, spent: number) => {
    const seen = new Set<number>();
    const route: number[] = [];
    const go = (c: number) => {
      seen.add(c);
      route.push(c);
      const mask = maskOf(turned.cells[c] ?? { kind: 'empty', rot: 0 });
      if (c === mill) {
        if (mask & S) {
          const key = route.join(',');
          paths.set(key, Math.min(paths.get(key) ?? Infinity, spent));
        }
      } else {
        for (const d of DIRS) {
          if (!(mask & d)) continue;
          const nb = neighbor(turned, c, d);
          if (nb < 0 || seen.has(nb)) continue;
          if (maskOf(turned.cells[nb] ?? { kind: 'empty', rot: 0 }) & opposite(d)) go(nb);
        }
      }
      route.pop();
      seen.delete(c);
    };
    if (maskOf(turned.cells[b.source] ?? { kind: 'empty', rot: 0 }) & N) go(b.source);
  };

  const walk = (i: number, spent: number) => {
    if (i === n) {
      const turned = applyTurns(b, turns);
      if (flow(turned).solved) collect(turned, spent);
      return;
    }
    for (let t = 0; t < (options[i] ?? 1); t++) {
      turns[i] = t;
      walk(i + 1, spent + turnCost(t));
    }
    turns[i] = 0;
  };
  walk(0, 0);

  const costs = [...paths.values()];
  const moves = costs.length > 0 ? Math.min(...costs) : null;
  return {
    moves,
    total: costs.length,
    shortest: costs.filter((k) => k === moves).length,
    near: costs.filter((k) => moves !== null && k <= moves + 2).length,
    exact: true,
  };
}

function randomBoard(seed: number, cols: number, rows: number, emptyShare: number): Board {
  const rng = mulberry32(seed);
  const cells: Cell[] = Array.from({ length: cols * rows }, () =>
    rng() < emptyShare
      ? { kind: 'empty', rot: 0 }
      : { kind: pick(rng, KINDS.slice(1)), rot: Math.floor(rng() * 4) },
  );
  return {
    cols,
    rows,
    cells,
    source: Math.floor(rng() * cols),
    mill: Math.floor(rng() * cols),
  };
}

/** Поле без пустых клеток и прямых: обходов и равных кратчайших здесь больше всего. */
function forkedBoard(seed: number, cols: number, rows: number): Board {
  const rng = mulberry32(seed);
  const cells: Cell[] = Array.from({ length: cols * rows }, () => ({
    kind: rng() < 0.7 ? 'tee' : 'corner',
    rot: Math.floor(rng() * 4),
  }));
  return {
    cols,
    rows,
    cells,
    source: Math.floor(rng() * cols),
    mill: Math.floor(rng() * cols),
  };
}

describe('решатель', () => {
  it('сколько поворотов нужно жёлобу', () => {
    expect(turnsToFit({ kind: 'straight', rot: 0 }, E | W)).toBe(1);
    expect(turnsToFit({ kind: 'straight', rot: 1 }, E | W)).toBe(0);
    expect(turnsToFit({ kind: 'corner', rot: 0 }, W | N)).toBe(1);
    expect(turnsToFit({ kind: 'corner', rot: 0 }, S | W)).toBe(2);
    expect(turnsToFit({ kind: 'tee', rot: 1 }, N | S)).toBe(1);
    expect(turnsToFit({ kind: 'tee', rot: 0 }, N | S)).toBe(0);
    expect(turnsToFit({ kind: 'corner', rot: 0 }, N | S)).toBe(Infinity);
    expect(turnsToFit({ kind: 'empty', rot: 0 }, N)).toBe(Infinity);
  });

  it('поворот выбирает короткую сторону', () => {
    expect(spinToFit({ kind: 'corner', rot: 0 }, N | E)).toBe(0);
    expect(spinToFit({ kind: 'corner', rot: 0 }, E | S)).toBe(1);
    expect(spinToFit({ kind: 'corner', rot: 0 }, W | N)).toBe(-1);
    expect(spinToFit({ kind: 'corner', rot: 0 }, S | W)).toBe(2);
    expect(spinToFit({ kind: 'empty', rot: 0 }, N)).toBe(Infinity);
  });

  it('решение с поворотом против часовой собирает путь', () => {
    // угол под родником открыт вверх и вправо, а нужно вверх и влево: один ход против часовой
    const b = board(['┌└', '│·', '│·'], 1, 0);
    const s = solve(b);
    expect(s?.moves).toBe(1);
    expect(s?.turns[1]).toBe(-1);
    expect(flow(applyTurns(b, s?.turns ?? [])).solved).toBe(true);
  });

  it('находит самый дешёвый путь, а не первый попавшийся', () => {
    // Прямо вниз по левому столбцу — 2 хода (два прямых лежат); в обход через развилки — дороже.
    const b = board(['│┬┐', '─┤│', '─··'], 0, 0);
    const s = solve(b);
    expect(s?.moves).toBe(2);
    expect(s?.path).toEqual([0, 3, 6]);
    expect(s?.exact).toBe(true);
    expect(flow(applyTurns(b, s?.turns ?? [])).solved).toBe(true);
  });

  it('уже решённое поле — ноль ходов', () => {
    expect(solve(board(['│·', '└┐'], 0, 1))?.moves).toBe(0);
  });

  it('нерешаемое поле — null', () => {
    expect(solve(board(['│·', '··'], 0, 1))).toBeNull();
    // угол не пропустит воду насквозь: из верхней клетки нельзя уйти вниз
    expect(solve(board(['└'], 0, 0))).toBeNull();
  });

  it('совпадает с полным перебором на 400 случайных маленьких полях', () => {
    let solvable = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const [cols, rows] = (
        [
          [2, 2],
          [2, 3],
          [3, 2],
          [1, 4],
          [4, 1],
        ] as const
      )[seed % 5] ?? [2, 2];
      const b = randomBoard(seed, cols, rows, 0.15);
      const expected = bruteForce(b);
      const got = solve(b);
      expect(got?.moves ?? null, `сид ${seed}\n${draw(b)}`).toBe(expected);
      if (got) {
        solvable++;
        expect(got.exact).toBe(true);
        expect(got.turns.reduce((a, t) => a + Math.abs(t), 0)).toBe(got.moves);
        expect(flow(applyTurns(b, got.turns)).solved, `сид ${seed}`).toBe(true);
      }
    }
    expect(solvable).toBeGreaterThan(100);
  });

  it('совпадает с полным перебором на полях 3×3', () => {
    for (let seed = 1000; seed < 1012; seed++) {
      const b = randomBoard(seed, 3, 3, 0.1);
      expect(solve(b)?.moves ?? null, `сид ${seed}\n${draw(b)}`).toBe(bruteForce(b));
    }
  });

  it('при исчерпанном бюджете честно говорит, что минимум не доказан', () => {
    const b = board(['│┬┐', '─┤│', '─··'], 0, 0);
    expect(solve(b, 1)?.exact ?? false).toBe(false);
  });

  it('путь решения идёт от клетки под родником до клетки над колесом', () => {
    // прямой под родником — 1 ход, угол — 1 ход против часовой, дальше всё на месте
    const b = board(['·─·', '·┌┐', '··│'], 1, 2);
    const s = solve(b);
    expect(s?.path).toEqual([1, 4, 5, 8]);
    expect(s?.moves).toBe(2);
  });
});

describe('подсказка', () => {
  /** Разворот уровня: каждая клетка повёрнута случайно — проверяем «с любого поля». */
  const shaken = (b: Board, seed: number): Board => {
    const rng = mulberry32(seed);
    return { ...b, cells: b.cells.map((c) => ({ kind: c.kind, rot: Math.floor(rng() * 4) })) };
  };

  it(
    'следование подсказкам решает уровень с любого поля ровно за минимум',
    { timeout: 60_000 },
    () => {
      for (let seed = 1; seed <= 200; seed++) {
        const level = seed % 4 ? endlessLevel(seed) : dailyLevel(addDays('2026-01-01', seed));
        let b = seed % 2 ? level.board : shaken(level.board, seed);
        if (flow(b).solved) continue;
        const min = solve(b)?.moves ?? 0;
        let steps = 0;
        while (!flow(b).solved) {
          const move = hintMove(b);
          expect(move, `сид ${seed}\n${draw(b)}`).not.toBeNull();
          if (!move) break;
          b = rotateCell(b, move.cell, move.spin);
          steps++;
          expect(steps).toBeLessThanOrEqual(min);
        }
        expect(steps, `сид ${seed}`).toBe(min);
      }
    },
  );

  it('против часовой, если так короче; решённому и нерешаемому полю подсказки нет', () => {
    expect(hintMove(board(['┌└', '│·', '│·'], 1, 0))).toEqual({ cell: 1, spin: CCW });
    expect(hintMove(board(['│·', '└┐'], 0, 1))).toBeNull();
    expect(hintMove(board(['│·', '··'], 0, 1))).toBeNull();
  });

  it('не зависит от исходного решения: считает от текущего поля', () => {
    const level = endlessLevel(30);
    const first = level.solution.path.find((c) => (level.solution.turns[c] ?? 0) !== 0) ?? 0;
    const turned = rotateCell(
      level.board,
      first,
      (level.solution.turns[first] ?? 0) < 0 ? CCW : CW,
    );
    expect(hintMove(turned)?.cell).not.toBe(undefined);
    expect(solve(turned)?.moves).toBe(level.solution.moves - 1);
  });

  it('считается без заметной задержки на поле 7×7', () => {
    let worst = 0;
    for (let n = 1; n <= 100; n++) {
      const b = shaken(endlessLevel(n + 100).board, n);
      const t0 = performance.now();
      hintMove(b);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(50);
  });
});

describe('счётчик путей', () => {
  it('считает все пути и те, что в минимум', () => {
    // левый столбец — 2 хода; второй путь — через верхний ряд и правый столбец
    const b = board(['│┬┐', '─┤│', '─··'], 0, 0);
    expect(countPaths(b)).toEqual(bruteForcePaths(b));
    expect(countPaths(b).moves).toBe(2);
  });

  it('нерешаемое поле — путей нет', () => {
    expect(countPaths(board(['│·', '··'], 0, 1))).toEqual({
      moves: null,
      total: 0,
      shortest: 0,
      near: 0,
      exact: true,
    });
  });

  it('совпадает с полным перебором на 400 случайных маленьких полях', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const [cols, rows] = (
        [
          [2, 2],
          [2, 3],
          [3, 2],
          [1, 4],
          [4, 1],
        ] as const
      )[seed % 5] ?? [2, 2];
      const b = randomBoard(seed, cols, rows, 0.15);
      expect(countPaths(b), `сид ${seed}\n${draw(b)}`).toEqual(bruteForcePaths(b));
    }
  });

  it('совпадает с полным перебором на полях из развилок', { timeout: 60_000 }, () => {
    let forked = 0;
    let tied = 0;
    let most = 0;
    for (let seed = 3000; seed < 3060; seed++) {
      const [cols, rows] = seed < 3006 ? [3, 3] : seed % 2 ? [2, 4] : [4, 2];
      const b = forkedBoard(seed, cols, rows);
      const expected = bruteForcePaths(b);
      expect(countPaths(b), `сид ${seed}\n${draw(b)}`).toEqual(expected);
      if (expected.total > 1) forked++;
      if (expected.shortest > 1) tied++;
      most = Math.max(most, expected.total);
    }
    // иначе проверка была бы пустой: нужны и обходы, и равные кратчайшие
    expect(forked).toBeGreaterThan(20);
    expect(tied).toBeGreaterThan(5);
    expect(most).toBeGreaterThan(3);
  });

  it('на настоящих уровнях счёт полон и минимум совпадает с решением', { timeout: 60_000 }, () => {
    const levels = Array.from({ length: 300 }, (_, i) => endlessLevel(i + 1));
    let date = '2026-01-01';
    for (let i = 0; i < 100; i++, date = addDays(date, 1)) levels.push(dailyLevel(date));
    for (const level of levels) {
      const count = countPaths(level.board);
      expect(count.exact, draw(level.board)).toBe(true);
      expect(count.moves, draw(level.board)).toBe(level.solution.moves);
    }
  });

  it('совпадает с полным перебором на полях 3×3', { timeout: 60_000 }, () => {
    let most = 0;
    for (let seed = 1000; seed < 1012; seed++) {
      const b = randomBoard(seed, 3, 3, 0.1);
      const expected = bruteForcePaths(b);
      expect(countPaths(b), `сид ${seed}\n${draw(b)}`).toEqual(expected);
      most = Math.max(most, expected.total);
    }
    expect(most).toBeGreaterThan(1);
  });

  it('минимум совпадает с решателем на случайных полях', () => {
    for (let seed = 2000; seed < 2300; seed++) {
      const b = randomBoard(seed, 5, 5, 0.2);
      const moves = solve(b)?.moves ?? null;
      expect(countPaths(b).moves, `сид ${seed}\n${draw(b)}`).toBe(moves);
    }
  });

  it('при исчерпанном бюджете честно говорит, что счёт не полон', () => {
    const b = board(['│┬┐', '─┤│', '─··'], 0, 0);
    expect(countPaths(b, 1).exact).toBe(false);
  });
});

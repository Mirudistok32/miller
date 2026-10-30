/**
 * Решатель: наименьшее число ходов, после которых вода дойдёт до колеса. Он не знает,
 * как уровень строился, и ищет сам — поэтому им проверяют генератор.
 *
 * В решённом поле всегда есть простой путь от родника до колеса, а клетки вне пути можно
 * не трогать. Значит, минимум ходов — самый дешёвый простой путь, где цена клетки — сколько
 * раз её повернуть в более короткую сторону, чтобы открылись две нужные стороны. Перебор путей
 * с отсечением: оценка снизу — тот же путь без запрета проходить клетку дважды (её считаем
 * заранее).
 */

import {
  BASE_MASK,
  type Board,
  CCW,
  type Cell,
  cellOf,
  CW,
  DIRS,
  millIndex,
  N,
  neighbor,
  sourceIndex,
  type Spin,
  turnMask,
} from './grid';

export interface Solution {
  /** Наименьшее число ходов. */
  moves: number;
  /** Сколько раз повернуть каждую клетку: 1 и 2 — по часовой, −1 — против, 0 — не трогать. */
  turns: number[];
  /** Клетки пути воды от родника до колеса. */
  path: number[];
  /** false — поиск упёрся в бюджет, и минимум не доказан. */
  exact: boolean;
}

/** Предел перебора: на полях до 7×7 его не достигает ни один уровень (tests/unit/generator). */
export const SOLVER_BUDGET = 400_000;

export interface PathCount {
  /** Наименьшая цена пути в ходах; null — путей нет. */
  moves: number | null;
  /** Сколько всего простых путей можно выложить. */
  total: number;
  /** Сколько из них в минимум ходов. */
  shortest: number;
  /** Сколько из них в минимум + 2 хода: обходы, почти равные кратчайшему. */
  near: number;
  /** false — счёт упёрся в бюджет: путей может быть больше, а минимум меньше. */
  exact: boolean;
}

/** Индексы сторон в DIRS: вверх 0, вправо 1, вниз 2, влево 3. */
const UP = 0;
const DOWN = 2;
const back = (side: number) => (side + 2) % 4;

/** Повороты от меньшего к большему: каждый ход — четверть оборота в любую сторону. */
const SHORTEST_TURNS = [0, 1, -1, 2] as const;

/** Короткий поворот, после которого у жёлоба открыты все стороны need; Infinity — никак. */
export function spinToFit(cell: Cell, need: number): number {
  if (cell.kind === 'empty') return Infinity;
  for (const t of SHORTEST_TURNS) {
    if ((turnMask(BASE_MASK[cell.kind], cell.rot + t) & need) === need) return t;
  }
  return Infinity;
}

/** Сколько ходов нужно, чтобы у жёлоба открылись все стороны need; Infinity — никак. */
export const turnsToFit = (cell: Cell, need: number): number => Math.abs(spinToFit(cell, need));

/** Цена прохода по клеткам и оценка снизу: общее для поиска минимума и счёта путей. */
function pricing(board: Board) {
  const n = board.cells.length;
  const mill = millIndex(board);
  const side = (i: number) => DIRS[i] ?? 0;
  const next = (c: number, b: number) => neighbor(board, c, DIRS[b] ?? N);

  // cost[(c·4 + a)·4 + b] — повороты, чтобы пройти клетку c: войти со стороны a, выйти в b.
  const cost = new Float64Array(n * 16).fill(Infinity);
  for (let c = 0; c < n; c++) {
    const cell = cellOf(board, c);
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        if (a !== b) cost[(c * 4 + a) * 4 + b] = turnsToFit(cell, side(a) | side(b));
      }
    }
  }
  const price = (c: number, a: number, b: number) => cost[(c * 4 + a) * 4 + b] ?? Infinity;

  // rest[c·4 + a] — оценка снизу: сколько ещё поворотов до колеса, если вода вошла в c с a.
  const rest = new Float64Array(n * 4).fill(Infinity);
  for (let a = 0; a < 4; a++) rest[mill * 4 + a] = price(mill, a, DOWN);
  for (let changed = true, round = 0; changed && round <= n * 4; round++) {
    changed = false;
    for (let c = 0; c < n; c++) {
      for (let a = 0; a < 4; a++) {
        let best = rest[c * 4 + a] ?? Infinity;
        for (let b = 0; b < 4; b++) {
          if (b === a) continue;
          const nb = next(c, b);
          if (nb < 0) continue;
          best = Math.min(best, price(c, a, b) + (rest[nb * 4 + back(b)] ?? Infinity));
        }
        if (best < (rest[c * 4 + a] ?? Infinity)) {
          rest[c * 4 + a] = best;
          changed = true;
        }
      }
    }
  }
  return { side, next, price, rest };
}

export function solve(board: Board, budget = SOLVER_BUDGET): Solution | null {
  const n = board.cells.length;
  const start = sourceIndex(board);
  const mill = millIndex(board);
  const { side, next, price, rest } = pricing(board);
  if ((rest[start * 4 + UP] ?? Infinity) === Infinity) return null;

  const visited = new Uint8Array(n);
  const cells: number[] = [];
  const needs: number[] = [];
  let best = Infinity;
  let bestCells: number[] = [];
  let bestNeeds: number[] = [];
  let nodes = 0;
  let aborted = false;

  const dfs = (c: number, a: number, spent: number) => {
    if (++nodes > budget) {
      aborted = true;
      return;
    }
    visited[c] = 1;
    cells.push(c);
    const options: { b: number; bound: number; nb: number }[] = [];
    for (let b = 0; b < 4; b++) {
      if (b === a) continue;
      const k = price(c, a, b);
      if (k === Infinity) continue;
      if (c === mill && b === DOWN) {
        options.push({ b, bound: spent + k, nb: -1 });
        continue;
      }
      const nb = next(c, b);
      if (nb < 0 || visited[nb]) continue;
      const tail = rest[nb * 4 + back(b)] ?? Infinity;
      if (tail !== Infinity) options.push({ b, bound: spent + k + tail, nb });
    }
    options.sort((x, y) => x.bound - y.bound);
    for (const o of options) {
      if (aborted || o.bound >= best) break;
      needs.push(side(a) | side(o.b));
      if (o.nb < 0) {
        best = o.bound;
        bestCells = [...cells];
        bestNeeds = [...needs];
      } else {
        dfs(o.nb, back(o.b), spent + price(c, a, o.b));
      }
      needs.pop();
    }
    cells.pop();
    visited[c] = 0;
  };
  dfs(start, UP, 0);

  if (best === Infinity) return null;
  const turns = new Array<number>(n).fill(0);
  bestCells.forEach((c, i) => {
    turns[c] = spinToFit(cellOf(board, c), bestNeeds[i] ?? 0);
  });
  return { moves: best, turns, path: bestCells, exact: !aborted };
}

/** Обходит все простые пути, которые можно выложить поворотами; false — упёрся в бюджет. */
function walkPaths(
  board: Board,
  budget: number,
  found: (route: readonly number[], cost: number) => void,
): boolean {
  const n = board.cells.length;
  const start = sourceIndex(board);
  const mill = millIndex(board);
  const { next, price, rest } = pricing(board);
  const visited = new Uint8Array(n);
  const route: number[] = [];
  let nodes = 0;
  let aborted = false;

  const walk = (c: number, a: number, spent: number) => {
    if (++nodes > budget) {
      aborted = true;
      return;
    }
    visited[c] = 1;
    route.push(c);
    for (let b = 0; b < 4 && !aborted; b++) {
      if (b === a) continue;
      const k = price(c, a, b);
      if (k === Infinity) continue;
      if (c === mill) {
        // из клетки колеса вода уходит только вниз: вернуться к ней простой путь не может
        if (b === DOWN) found(route, spent + k);
        continue;
      }
      const nb = next(c, b);
      if (nb < 0 || visited[nb] || (rest[nb * 4 + back(b)] ?? Infinity) === Infinity) continue;
      walk(nb, back(b), spent + k);
    }
    route.pop();
    visited[c] = 0;
  };
  if ((rest[start * 4 + UP] ?? Infinity) !== Infinity) walk(start, UP, 0);
  return !aborted;
}

/**
 * Все простые пути от родника до колеса, которые можно выложить поворотами, и их цена в ходах.
 * Настоящему уровню хватает 10 тысяч узлов (замер на 20 000 уровней, PLAN-LOG, пункт 0.2).
 */
export function countPaths(board: Board, budget = SOLVER_BUDGET): PathCount {
  const costs: number[] = [];
  const exact = walkPaths(board, budget, (_, cost) => costs.push(cost));
  const cheapest = costs.reduce((a, k) => Math.min(a, k), Infinity);
  return {
    moves: costs.length > 0 ? cheapest : null,
    total: costs.length,
    shortest: costs.filter((k) => k === cheapest).length,
    near: costs.filter((k) => k <= cheapest + 2).length,
    exact,
  };
}

/** Клетки каждого пути: по ним генератор выбирает, какую обманку заменить. */
export function listRoutes(board: Board, budget = SOLVER_BUDGET) {
  const routes: number[][] = [];
  const exact = walkPaths(board, budget, (route) => routes.push([...route]));
  return { routes, exact };
}

/** Подсказка: что повернуть и в какую сторону. */
export interface HintMove {
  cell: number;
  spin: Spin;
}

/** Ход от текущего поля к минимуму: решатель считает заново, null — поворачивать нечего. */
export function hintMove(board: Board): HintMove | null {
  const solution = solve(board);
  if (!solution) return null;
  for (const cell of solution.path) {
    const t = solution.turns[cell] ?? 0;
    if (t !== 0) return { cell, spin: t < 0 ? CCW : CW };
  }
  return null;
}

/** Поле после решения: каждая клетка повёрнута столько раз, сколько велит решение. */
export function applyTurns(board: Board, turns: readonly number[]): Board {
  const cells = board.cells.map((c, i) =>
    c.kind === 'empty' ? c : { kind: c.kind, rot: (c.rot + (turns[i] ?? 0) + 4) % 4 },
  );
  return { ...board, cells };
}

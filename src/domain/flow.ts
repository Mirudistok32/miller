/**
 * Куда дошла вода: обход от родника по стыкующимся жёлобам. Уровень решён, когда вода
 * выходит из нижней клетки столбца мельницы вниз — на колесо. Пролитая вода (открытый
 * конец, край поля) не мешает, но видна: из неё ачивка «Ни капли мимо».
 */

import {
  type Board,
  cellOf,
  type Dir,
  DIRS,
  maskOf,
  millIndex,
  N,
  neighbor,
  opposite,
  S,
  sourceIndex,
} from './grid';

/** Сколько секунд вода бежит через одну клетку. */
export const FLOW_CELL = 0.07;

export interface Leak {
  cell: number;
  dir: Dir;
}

export interface Flow {
  /** Сколько клеток вода прошла от родника до этой; -1 — сухо. */
  dist: number[];
  /** С какой стороны вода вошла в клетку; 0 — сухо. */
  from: number[];
  /** Клетка, из которой вода затекла; -1 — родник или сухо. */
  parent: number[];
  /** Мокрые клетки в порядке растекания. */
  order: number[];
  /** Где вода проливается мимо: открытый конец жёлоба или край поля. */
  leaks: Leak[];
  /** Вода дошла до колеса. */
  solved: boolean;
}

export function flow(board: Board): Flow {
  const n = board.cells.length;
  const dist = new Array<number>(n).fill(-1);
  const from = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  const order: number[] = [];
  const leaks: Leak[] = [];
  const start = sourceIndex(board);
  const mill = millIndex(board);
  let solved = false;
  if (!(maskOf(cellOf(board, start)) & N)) return { dist, from, parent, order, leaks, solved };

  dist[start] = 0;
  from[start] = N;
  order.push(start);
  for (let head = 0; head < order.length; head++) {
    const c = order[head] ?? 0;
    const mask = maskOf(cellOf(board, c));
    for (const d of DIRS) {
      if (!(mask & d)) continue;
      if (c === start && d === N) continue; // сюда льётся родник
      if (c === mill && d === S) {
        solved = true; // вода уходит на колесо
        continue;
      }
      const nb = neighbor(board, c, d);
      if (nb < 0 || !(maskOf(cellOf(board, nb)) & opposite(d))) {
        leaks.push({ cell: c, dir: d });
        continue;
      }
      if ((dist[nb] ?? -1) >= 0) continue;
      dist[nb] = (dist[c] ?? 0) + 1;
      from[nb] = opposite(d);
      parent[nb] = c;
      order.push(nb);
    }
  }
  return { dist, from, parent, order, leaks, solved };
}

/**
 * Когда вода приходит в каждую клетку (секунды игры): мокрые раньше — как были, новые —
 * через FLOW_CELL после клетки, из которой вода в них затекла, но не раньше start.
 * Сухие — Infinity.
 */
export function wetTimes(prev: readonly number[] | null, f: Flow, start: number): number[] {
  const out = new Array<number>(f.dist.length).fill(Infinity);
  for (const c of f.order) {
    const before = prev?.[c] ?? Infinity;
    if (Number.isFinite(before)) {
      out[c] = before;
      continue;
    }
    const p = f.parent[c] ?? -1;
    // Обход идёт от родника, поэтому время клетки-источника уже посчитано.
    out[c] = p < 0 ? start : Math.max(start, (out[p] ?? start) + FLOW_CELL);
  }
  return out;
}

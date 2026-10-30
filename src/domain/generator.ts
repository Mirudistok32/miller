/**
 * Уровень из сида. Задуманный ход воды — путь от родника до мельницы по случайному остовному
 * дереву (алгоритм Уилсона), удлинённый «выпячиваниями». От пути растёт новое дерево: его
 * ветви — жёлоба-обманки, правдоподобные отводы. Обманки, открывающие лишние обходы, меняют
 * форму. Затем жёлоба поворачиваются как попало, клетки пути — чаще неправильно.
 *
 * Гарантии (tests/unit/generator.test.ts): уровень решаем — решатель находит путь сам; на
 * старте не решён; минимум ходов доказан перебором; кратчайший путь один, всего путей не больше
 * порога. Генерация ограничена по шагам и не зависает ни на каком сиде.
 */

import { flow } from './flow';
import {
  BASE_MASK,
  bitCount,
  type Board,
  type Cell,
  cellForMask,
  type Dir,
  DIRS,
  EMPTY,
  type Kind,
  N,
  neighbor,
  opposite,
  S,
  turnMask,
} from './grid';
import { intBetween, mulberry32, pick, type Rng, shuffle } from './random';
import { countPaths, listRoutes, type Solution, solve } from './solver';

export interface LevelParams {
  cols: number;
  rows: number;
  /** Доля клеток пути, которые становятся развилками. */
  teeShare: number;
  /** Доля пустых клеток среди тех, что не на пути воды. */
  emptyShare: number;
  /** Желаемая длина пути воды в долях клеток поля: от и до. */
  pathShare: readonly [number, number];
  /** Доля клеток пути, которые при перемешивании точно встанут неправильно. */
  misturnShare: number;
  /** Сколько ходов должно понадобиться: окно, в которое метит перемешивание. */
  minMoves: number;
  maxMoves: number;
  /** Сколько путей от родника до колеса можно выложить, считая единственный кратчайший. */
  maxPaths: number;
}

export interface Level {
  seed: number;
  params: LevelParams;
  /** Поле в начале: жёлоба перемешаны. */
  board: Board;
  /** Минимум ходов и одно из лучших решений — для автопилота и проверок. */
  solution: Solution;
}

export const MIN_SIDE = 2;
export const MAX_SIDE = 9;
/** Сколько деревьев перебрать в поисках короткого пути, который потом удлиняется. */
const TREE_TRIES = 8;
/** Сколько раскладок попробовать, если порог путей или окно ходов не сошлись. */
const LAYOUT_TRIES = 4;
/** Сколько раз перемешать поле, добиваясь минимума ходов из окна minMoves–maxMoves. */
const SCRAMBLE_TRIES = 16;
/** Сколько обманок с наибольшим числом обходов примерять за шаг прореживания. */
const THIN_CANDIDATES = 4;
/** Предел перебора при прореживании: полю, где его не хватает, нужна замена, а не точный счёт. */
const THIN_BUDGET = 20_000;
/** Какие формы примерить вместо обманки: другой жёлоб на том же месте. */
const SWAPS: Readonly<Record<Kind, readonly Kind[]>> = {
  empty: [],
  straight: ['corner'],
  corner: ['straight'],
  tee: ['straight', 'corner'],
};

/** Каркас поля без жёлобов — для обхода соседей. */
const shell = (cols: number, rows: number): Board => ({
  cols,
  rows,
  cells: [],
  source: 0,
  mill: 0,
});

/**
 * Остовное дерево (алгоритм Уилсона): для каждой клетки — маска сторон, по которым она
 * связана с соседями. Если задан путь, дерево растёт от него: путь — его ствол.
 */
function spanningTree(rng: Rng, cols: number, rows: number, trunk: readonly number[] = []) {
  const n = cols * rows;
  const grid = shell(cols, rows);
  const links = new Array<number>(n).fill(0);
  const inTree = new Uint8Array(n);
  const step = new Array<Dir>(n).fill(N);
  const order = shuffle(
    rng,
    Array.from({ length: n }, (_, i) => i),
  );
  inTree[trunk[0] ?? order[0] ?? 0] = 1;
  for (let i = 1; i < trunk.length; i++) {
    const a = trunk[i - 1] ?? 0;
    const b = trunk[i] ?? 0;
    const d = sideTo(cols, a, b);
    links[a] = (links[a] ?? 0) | d;
    links[b] = (links[b] ?? 0) | opposite(d);
    inTree[b] = 1;
  }
  // Случайное блуждание заканчивается почти наверняка; предел шагов — страховка от зависания.
  let budget = n * 4000;
  for (const first of order) {
    let u = first;
    while (!inTree[u]) {
      const d = pick(
        rng,
        DIRS.filter((dir) => neighbor(grid, u, dir) >= 0),
      );
      step[u] = d;
      u = neighbor(grid, u, d);
      if (--budget < 0) return combTree(cols, rows);
    }
    u = first;
    while (!inTree[u]) {
      inTree[u] = 1;
      const d = step[u] ?? N;
      const v = neighbor(grid, u, d);
      links[u] = (links[u] ?? 0) | d;
      links[v] = (links[v] ?? 0) | opposite(d);
      u = v;
    }
  }
  return links;
}

/** Запасное дерево-гребёнка: ряды целиком и левый столбец. */
function combTree(cols: number, rows: number): number[] {
  const links = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (x > 0) links[i] = (links[i] ?? 0) | 8;
      if (x < cols - 1) links[i] = (links[i] ?? 0) | 2;
      if (x === 0 && y > 0) links[i] = (links[i] ?? 0) | 1;
      if (x === 0 && y < rows - 1) links[i] = (links[i] ?? 0) | 4;
    }
  }
  return links;
}

/** Путь по дереву от клетки from до клетки to. */
function treePath(links: readonly number[], cols: number, rows: number, from: number, to: number) {
  const grid = shell(cols, rows);
  const prev = new Array<number>(links.length).fill(-1);
  const seen = new Uint8Array(links.length);
  const queue = [from];
  seen[from] = 1;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] ?? from;
    if (c === to) break;
    for (const d of DIRS) {
      if (!((links[c] ?? 0) & d)) continue;
      const nb = neighbor(grid, c, d);
      if (nb < 0 || seen[nb]) continue;
      seen[nb] = 1;
      prev[nb] = c;
      queue.push(nb);
    }
  }
  const path = [to];
  while ((path[0] ?? from) !== from) path.unshift(prev[path[0] ?? from] ?? from);
  return path;
}

/**
 * Удлиняет путь «выпячиваниями»: ребро a→b заменяется на a→a′→b′→b, где a′ и b′ — свободные
 * соседи сбоку. Путь остаётся простым, концы не двигаются; число попыток ограничено.
 */
function stretch(rng: Rng, cols: number, rows: number, path: readonly number[], target: number) {
  const grid = shell(cols, rows);
  const used = new Uint8Array(cols * rows);
  for (const c of path) used[c] = 1;
  const out = path.slice();
  for (let tries = 0; out.length < target && tries < 60 * target; tries++) {
    const i = intBetween(rng, 0, out.length - 2);
    const a = out[i] ?? 0;
    const b = out[i + 1] ?? 0;
    const along = sideTo(cols, a, b);
    const d = pick(rng, along === N || along === S ? ([2, 8] as const) : ([N, S] as const));
    const a2 = neighbor(grid, a, d);
    const b2 = neighbor(grid, b, d);
    if (a2 < 0 || b2 < 0 || used[a2] || used[b2]) continue;
    used[a2] = 1;
    used[b2] = 1;
    out.splice(i + 1, 0, a2, b2);
  }
  return out;
}

/** Сторона клетки a, за которой лежит соседняя клетка b. */
function sideTo(cols: number, a: number, b: number): Dir {
  if (b === a - cols) return N;
  if (b === a + cols) return S;
  return b === a + 1 ? 2 : 8;
}

function checkParams(p: LevelParams) {
  const side = (v: number) => Number.isInteger(v) && v >= MIN_SIDE && v <= MAX_SIDE;
  if (!side(p.cols) || !side(p.rows)) {
    throw new Error(`generateLevel: поле ${p.cols}×${p.rows} вне ${MIN_SIDE}–${MAX_SIDE}`);
  }
}

/** Раскладка уровня: путь воды и жёлоба в решённом виде. */
interface Layout {
  path: number[];
  cells: Cell[];
  /** Стороны, нужные клетке пути; -1 — клетка не на пути. */
  needs: number[];
}

function makeLayout(rng: Rng, params: LevelParams, from: number, to: number): Layout {
  const { cols, rows } = params;
  const n = cols * rows;

  // 1. Путь воды: путь по случайному дереву, удлинённый до случайной длины из pathShare.
  const lo = Math.max(2, Math.round(params.pathShare[0] * n));
  const hi = Math.max(lo, Math.round(params.pathShare[1] * n));
  let path: number[] = [];
  for (let t = 0; t < TREE_TRIES; t++) {
    const p = treePath(spanningTree(rng, cols, rows), cols, rows, from, to);
    if (path.length === 0 || Math.abs(p.length - lo) < Math.abs(path.length - lo)) path = p;
    if (path.length <= hi) break;
  }
  path = stretch(rng, cols, rows, path, intBetween(rng, lo, hi));
  // Обманки — ветви дерева, растущего от пути.
  const links = spanningTree(rng, cols, rows, path);

  // 2. Жёлоба пути: вход и выход, часть — развилки с третьей стороной.
  const masks = new Array<number>(n).fill(0);
  const needs = new Array<number>(n).fill(-1);
  path.forEach((c, i) => {
    const prev = path[i - 1];
    const next = path[i + 1];
    const inSide = prev === undefined ? N : sideTo(cols, c, prev);
    const outSide = next === undefined ? S : sideTo(cols, c, next);
    masks[c] = inSide | outSide;
    needs[c] = inSide | outSide;
  });
  for (const c of path) {
    if (rng() >= params.teeShare) continue;
    const free = DIRS.filter((d) => !((masks[c] ?? 0) & d));
    const branches = free.filter((d) => (links[c] ?? 0) & d);
    masks[c] = (masks[c] ?? 0) | pick(rng, branches.length > 0 ? branches : free);
  }

  // 3. Обманки: ветви дерева вне пути, часть клеток пустует.
  for (let c = 0; c < n; c++) {
    if ((needs[c] ?? -1) >= 0) continue;
    if (rng() < params.emptyShare) continue;
    let m = links[c] ?? 0;
    if (bitCount(m) === 4) m &= ~pick(rng, DIRS);
    if (bitCount(m) === 3 && rng() > params.teeShare)
      m &= ~pick(
        rng,
        DIRS.filter((d) => m & d),
      );
    if (bitCount(m) === 1)
      m |= pick(
        rng,
        DIRS.filter((d) => !(m & d)),
      );
    masks[c] = m;
  }
  return { path, needs, cells: masks.map((m) => cellForMask(m) ?? EMPTY) };
}

/**
 * Снимает лишние обходы: у клетки, через которую их идёт больше всего, меняет форму, пока путей
 * не станет не больше порога. Первыми меняются обманки, затем развилки на пути воды, пустая
 * клетка — крайний случай. Число путей зависит только от форм, поэтому поворот здесь не важен.
 */
function thinRoutes(rng: Rng, board: Board, layout: Layout, maxPaths: number): readonly Cell[] {
  const onPath = (c: number) => (layout.needs[c] ?? -1) >= 0;
  let cells: readonly Cell[] = layout.cells;
  const routesOf = (next: readonly Cell[]) => listRoutes({ ...board, cells: next }, THIN_BUDGET);
  const replaced = (c: number, cell: Cell) => cells.map((old, i) => (i === c ? cell : old));

  for (let step = 0; step < cells.length * 2; step++) {
    const { routes, exact } = routesOf(cells);
    if (exact && routes.length <= maxPaths) break;
    const load = new Array<number>(cells.length).fill(0);
    for (const route of routes) for (const c of route) load[c] = (load[c] ?? 0) + 1;
    const loaded = shuffle(
      rng,
      cells.flatMap((_, c) => ((load[c] ?? 0) > 0 ? [c] : [])),
    ).sort((a, b) => (load[b] ?? 0) - (load[a] ?? 0));
    const decoys = loaded.filter((c) => !onPath(c));
    const tees = loaded.filter((c) => onPath(c) && cells[c]?.kind === 'tee');

    // Первая замена, после которой путей меньше: примерять все дороже, а итог почти тот же.
    let bestCells: readonly Cell[] | null = null;
    const limit = exact ? routes.length : Infinity;
    search: for (const c of decoys.slice(0, THIN_CANDIDATES)) {
      for (const kind of SWAPS[cells[c]?.kind ?? 'empty']) {
        const next = replaced(c, { kind, rot: 0 });
        const r = routesOf(next);
        if (r.exact && r.routes.length < limit) {
          bestCells = next;
          break search;
        }
      }
    }
    if (!bestCells) {
      // Форма обманки не помогла: развилка на пути теряет отвод, иначе обманка уходит совсем.
      const tee = tees[0];
      const decoy = decoys[0];
      if (tee !== undefined) {
        bestCells = replaced(tee, cellForMask(layout.needs[tee] ?? 0) ?? EMPTY);
      } else if (decoy !== undefined) {
        bestCells = replaced(decoy, EMPTY);
      } else {
        break;
      }
    }
    cells = bestCells;
  }
  return cells;
}

export function generateLevel(seed: number, params: LevelParams): Level {
  checkParams(params);
  const { cols, rows } = params;
  const rng = mulberry32(seed);
  const source = intBetween(rng, 0, cols - 1);
  let mill = intBetween(rng, 0, cols - 2);
  if (mill >= source) mill += 1; // родник и колесо — в разных столбцах
  const from = source;
  const to = (rows - 1) * cols + mill;
  const frame: Board = { cols, rows, cells: [], source, mill };

  // Перемешивание: поле не решено, кратчайший путь один, минимум ходов в окне, если выйдет.
  const miss = (moves: number) =>
    moves < params.minMoves ? params.minMoves - moves : Math.max(0, moves - params.maxMoves);
  let best: { board: Board; solution: Solution; fair: boolean } | null = null;
  for (let l = 0; l < LAYOUT_TRIES; l++) {
    const layout = makeLayout(rng, params, from, to);
    const solved = thinRoutes(rng, frame, layout, params.maxPaths);
    for (let t = 0; t < SCRAMBLE_TRIES; t++) {
      const cells = solved.map((cell, c) =>
        scrambled(rng, cell, layout.needs[c] ?? -1, params.misturnShare),
      );
      const board = unsolve(rng, { ...frame, cells }, layout.path);
      const count = countPaths(board);
      if (count.moves === null) continue; // не бывает: задуманный путь всегда проходим
      const fair = count.exact && count.total <= params.maxPaths && count.shortest === 1;
      const better =
        !best ||
        (fair && !best.fair) ||
        (fair === best.fair &&
          ((count.exact && !best.solution.exact) ||
            (count.exact === best.solution.exact &&
              miss(count.moves) < miss(best.solution.moves))));
      if (!better) continue;
      const solution = solve(board);
      if (!solution) continue;
      best = { board, solution, fair };
      if (fair && solution.exact && miss(solution.moves) === 0) {
        return { seed, params, board, solution };
      }
    }
  }
  if (!best) throw new Error(`generateLevel: сид ${seed} не дал решаемого поля`);
  return { seed, params, board: best.board, solution: best.solution };
}

/** Случайный поворот; клетка пути (need ≥ 0) чаще встаёт так, что нужные стороны закрыты. */
function scrambled(rng: Rng, cell: Cell, need: number, misturn: number): Cell {
  if (cell.kind === 'empty') return cell;
  const all = [0, 1, 2, 3];
  const wrong = all.filter((r) => need >= 0 && (turnMask(BASE_MASK[cell.kind], r) & need) !== need);
  const rot = wrong.length > 0 && rng() < misturn ? pick(rng, wrong) : pick(rng, all);
  return { kind: cell.kind, rot };
}

/** Если вода уже доходит до колеса — довернуть клетки пути; в крайнем случае закрыть родник. */
function unsolve(rng: Rng, board: Board, path: readonly number[]): Board {
  let b = board;
  for (let k = 0; k < 8 && flow(b).solved; k++) {
    const c = pick(rng, path);
    const cell = b.cells[c] ?? EMPTY;
    const cells = b.cells.slice();
    cells[c] = { kind: cell.kind, rot: (cell.rot + 1) % 4 };
    b = { ...b, cells };
  }
  if (!flow(b).solved) return b;
  const cells = b.cells.slice();
  const top = cells[b.source] ?? EMPTY;
  const rot = [0, 1, 2, 3].find((r) => !(turnMask(BASE_MASK[top.kind], r) & N)) ?? 0;
  cells[b.source] = { kind: top.kind, rot };
  return { ...b, cells };
}

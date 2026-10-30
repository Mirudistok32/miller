/**
 * Поле с жёлобами. Стороны клетки — биты маски: вверх 1, вправо 2, вниз 4, влево 8.
 * Поворот на четверть оборота по часовой стрелке сдвигает маску на один бит.
 * Родник всегда над верхним рядом, мельница — под нижним: вода течёт сверху вниз.
 */

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
export type Dir = typeof N | typeof E | typeof S | typeof W;
export const DIRS: readonly Dir[] = [N, E, S, W];

export const opposite = (d: Dir): Dir => (d === N ? S : d === S ? N : d === E ? W : E);

const DX: Readonly<Record<Dir, number>> = { [N]: 0, [E]: 1, [S]: 0, [W]: -1 };
const DY: Readonly<Record<Dir, number>> = { [N]: -1, [E]: 0, [S]: 1, [W]: 0 };

/** Маска после turns четвертей оборота по часовой стрелке. */
export function turnMask(mask: number, turns = 1): number {
  let m = mask & 15;
  const k = ((turns % 4) + 4) % 4;
  for (let i = 0; i < k; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

export const KINDS = ['empty', 'straight', 'corner', 'tee'] as const;
export type Kind = (typeof KINDS)[number];

/** Форма жёлоба без поворота: прямой — сверху вниз, угол — вверх и вправо, развилка — без левой стороны. */
export const BASE_MASK: Readonly<Record<Kind, number>> = {
  empty: 0,
  straight: N | S,
  corner: N | E,
  tee: N | E | S,
};

export interface Cell {
  kind: Kind;
  /** Четверти оборота по часовой стрелке от базовой формы, 0–3. */
  rot: number;
}

export interface Board {
  cols: number;
  rows: number;
  /** Клетки по рядам: индекс = ряд × cols + столбец. */
  cells: readonly Cell[];
  /** Столбец родника: вода входит в верхнюю клетку этого столбца сверху. */
  source: number;
  /** Столбец мельницы: из нижней клетки этого столбца вода уходит вниз, на колесо. */
  mill: number;
}

export const EMPTY: Cell = { kind: 'empty', rot: 0 };

export const maskOf = (cell: Cell): number => turnMask(BASE_MASK[cell.kind], cell.rot);

export const cellOf = (board: Board, index: number): Cell => board.cells[index] ?? EMPTY;

export const sourceIndex = (board: Board): number => board.source;

export const millIndex = (board: Board): number => (board.rows - 1) * board.cols + board.mill;

export const colOf = (board: Board, index: number): number => index % board.cols;

export const rowOf = (board: Board, index: number): number => Math.floor(index / board.cols);

/** Соседняя клетка в сторону d или -1, если там край поля. */
export function neighbor(board: Board, index: number, d: Dir): number {
  const x = colOf(board, index) + DX[d];
  const y = rowOf(board, index) + DY[d];
  if (x < 0 || y < 0 || x >= board.cols || y >= board.rows) return -1;
  return y * board.cols + x;
}

export const bitCount = (mask: number): number =>
  (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);

/** Какой жёлоб и в каком повороте даёт эту маску; null — такой формы нет (тупик, крест). */
export function cellForMask(mask: number): Cell | null {
  if (mask === 0) return EMPTY;
  for (const kind of KINDS) {
    if (kind === 'empty') continue;
    for (let rot = 0; rot < 4; rot++) {
      if (turnMask(BASE_MASK[kind], rot) === mask) return { kind, rot };
    }
  }
  return null;
}

/** Направление поворота: по часовой и против. */
export type Spin = 1 | -1;
export const CW: Spin = 1;
export const CCW: Spin = -1;

/** Поворачивает жёлоб на четверть оборота; пустая клетка не меняется. */
export function rotateCell(board: Board, index: number, spin: Spin = CW): Board {
  const cell = board.cells[index];
  if (!cell || cell.kind === 'empty') return board;
  const cells = board.cells.slice();
  cells[index] = { kind: cell.kind, rot: (cell.rot + spin + 4) % 4 };
  return { ...board, cells };
}

/** Повороты всех клеток строкой цифр — для сохранения и сравнения. */
export const rotsOf = (board: Board): string => board.cells.map((c) => String(c.rot)).join('');

/** Те же жёлоба с поворотами из строки; null — строка не подходит к полю. */
export function withRots(board: Board, rots: string): Board | null {
  if (rots.length !== board.cells.length || !/^[0-3]*$/.test(rots)) return null;
  const cells = board.cells.map((c, i) =>
    c.kind === 'empty' ? c : { kind: c.kind, rot: Number(rots[i]) },
  );
  return { ...board, cells };
}

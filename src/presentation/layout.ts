/**
 * Раскладка холста. Холст во всё окно, рисуется в «пикселях игры» и растягивается без
 * сглаживания. Масштаб выбирается так, чтобы поле с родником сверху и мельницей снизу
 * влезло в свободную от панелей часть окна; если можно без большой потери — целым числом
 * пикселей экрана на пиксель игры, чтобы пиксели были ровными. На низком экране (телефон
 * боком) клетки важнее декора: пруд и мельница могут уйти за край, но лоток родника и верх
 * колеса остаются видны, а клетка растёт до размера пальца.
 */

/** Клетка поля, пикселей игры. */
export const CELL = 16;
/** Полоса над полем: пруд родника и лоток. */
export const SPRING_H = 18;
/** Полоса под полем: лоток, колесо и мельница. */
export const MILL_H = 30;
/** Поля вокруг. */
export const PAD = 4;
/** Крупнее не нужно: клетка 96 CSS-пикселей. */
export const MAX_SCALE = 6;
/** Клетка удобна пальцу, CSS-пикселей. */
export const TAP = 44;
/** На низком экране над полем видно хотя бы лоток родника, под полем — верх колеса. */
export const MIN_ABOVE = 8;
export const MIN_BELOW = 18;

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

/** Сколько CSS-пикселей с каждой стороны заняты панелями. */
export interface Reserve {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_RESERVE: Reserve = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Layout {
  /** CSS-пикселей на пиксель игры. */
  scale: number;
  /** Холст, пикселей игры. */
  width: number;
  height: number;
  /** Левый верхний угол поля, пикселей игры. */
  boardX: number;
  boardY: number;
  cols: number;
  rows: number;
}

export function computeLayout(
  view: Viewport,
  board: { cols: number; rows: number },
  reserve: Reserve = NO_RESERVE,
): Layout {
  const { cols, rows } = board;
  const availW = Math.max(1, view.width - reserve.left - reserve.right);
  const availH = Math.max(1, view.height - reserve.top - reserve.bottom);
  const needW = cols * CELL + 2 * PAD;
  const needH = SPRING_H + rows * CELL + MILL_H + 2 * PAD;
  const tightH = MIN_ABOVE + rows * CELL + MIN_BELOW + 2 * PAD;
  const full = Math.min(availW / needW, availH / needH, MAX_SCALE);
  const tight = Math.min(availW / needW, availH / tightH, MAX_SCALE);
  let scale = full * CELL >= TAP ? full : Math.min(tight, Math.max(full, TAP / CELL));
  const device = scale * Math.max(1, view.dpr);
  const whole = Math.floor(device);
  if (whole >= 2 && whole / device >= 0.85) scale = whole / Math.max(1, view.dpr);

  const width = Math.ceil(view.width / scale);
  const height = Math.ceil(view.height / scale);
  const left = reserve.left / scale;
  const top = reserve.top / scale;
  const room = availH / scale;
  const boardX = Math.round(left + (availW / scale - cols * CELL) / 2);
  // Влезает целиком — по центру; нет — пруд и мельница уходят за край, каждый по своей высоте.
  const above =
    room >= needH
      ? (room - needH) / 2 + PAD + SPRING_H
      : Math.max(MIN_ABOVE + PAD, ((room - rows * CELL) * SPRING_H) / (SPRING_H + MILL_H));
  const boardY = Math.round(top + above);
  return { scale, width, height, boardX, boardY, cols, rows };
}

/** Клетка под точкой (CSS-пиксели от левого верхнего угла холста); null — мимо поля. */
export function cellAt(layout: Layout, x: number, y: number): number | null {
  const col = Math.floor((x / layout.scale - layout.boardX) / CELL);
  const row = Math.floor((y / layout.scale - layout.boardY) / CELL);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  return row * layout.cols + col;
}

/** Центр клетки в CSS-пикселях от левого верхнего угла холста. */
export function cellCenter(layout: Layout, index: number): { x: number; y: number } {
  const col = index % layout.cols;
  const row = Math.floor(index / layout.cols);
  return {
    x: (layout.boardX + col * CELL + CELL / 2) * layout.scale,
    y: (layout.boardY + row * CELL + CELL / 2) * layout.scale,
  };
}

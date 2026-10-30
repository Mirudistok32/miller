/**
 * Уровень в игре: поле, ходы, время, попытки. Чистые функции — время приходит аргументом.
 * Часы идут с первого хода и останавливаются, когда вода дошла до колеса.
 */

import { flow } from './flow';
import { type Board, CCW, CW, rotateCell, type Spin } from './grid';

export interface Play {
  board: Board;
  /** Поле на старте — для «начать заново». */
  start: Board;
  moves: number;
  /** Секунды с первого хода. */
  time: number;
  /** Первый ход сделан — часы идут. */
  started: boolean;
  /** Сколько раз уровень начинали: «начать заново» прибавляет попытку. */
  attempts: number;
  solved: boolean;
  /** Сделанные повороты для отмены; не сохраняются: после перезагрузки отменять нечего. */
  history: readonly Turn[];
  /** Сколько подсказок взято; «заново» не обнуляет, иначе подсказка была бы бесплатной. */
  hints: number;
}

/** Один сделанный поворот. */
export interface Turn {
  cell: number;
  spin: Spin;
}

export const startPlay = (board: Board): Play => ({
  board,
  start: board,
  moves: 0,
  time: 0,
  started: false,
  attempts: 1,
  solved: flow(board).solved,
  history: [],
  hints: 0,
});

/**
 * Поворот жёлоба в любую сторону — один ход; null — поворачивать нечего (пустая клетка, край)
 * или уровень решён.
 */
export function rotateAt(play: Play, index: number, spin: Spin = CW): Play | null {
  if (play.solved) return null;
  const cell = play.board.cells[index];
  if (!cell || cell.kind === 'empty') return null;
  const board = rotateCell(play.board, index, spin);
  return {
    ...play,
    board,
    moves: play.moves + 1,
    started: true,
    solved: flow(board).solved,
    history: [...play.history, { cell: index, spin }],
  };
}

/**
 * Отмена последнего поворота: поле возвращается, а счётчик ходов и часы нет. Потраченный ход
 * остаётся потраченным, поэтому с отменой минимум ходов недостижим. null — отменять нечего.
 */
export function undoPlay(play: Play): Play | null {
  const last = play.history.at(-1);
  if (!last || play.solved) return null;
  const board = rotateCell(play.board, last.cell, last.spin === CW ? CCW : CW);
  return { ...play, board, solved: flow(board).solved, history: play.history.slice(0, -1) };
}

/** Заново: поле как на старте, ходы и время с нуля, попытка +1. */
export const restartPlay = (play: Play): Play => ({
  ...play,
  board: play.start,
  moves: 0,
  time: 0,
  started: false,
  attempts: play.attempts + 1,
  solved: flow(play.start).solved,
  history: [],
});

/** Подсказка взята: поле не меняется, счётчик растёт. */
export const countHint = (play: Play): Play => ({ ...play, hints: play.hints + 1 });

/** Прибавляет время, если часы идут. */
export const advance = (play: Play, seconds: number): Play =>
  play.started && !play.solved && seconds > 0 ? { ...play, time: play.time + seconds } : play;

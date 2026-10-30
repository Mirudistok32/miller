/** Итог решённого уровня: что записывается в рекорды и что уходит в текст для друзей. */

import type { Season } from './season';

export type Mode = 'daily' | 'endless';

export interface SolveResult {
  mode: Mode;
  /** Дата уровня дня (ГГГГ-ММ-ДД); у бесконечного режима — null. */
  date: string | null;
  /** Номер уровня бесконечного режима; у уровня дня — null. */
  level: number | null;
  /** Размер поля «6x7»: рекорды бесконечного режима ведутся по размеру. */
  size: string;
  moves: number;
  minMoves: number;
  /** Секунды с первого хода до решения, с точностью до десятых. */
  time: number;
  attempts: number;
  /** Сколько подсказок взято: с ними не больше двух капель, без «perfect» и рекорда по ходам. */
  hints: number;
  /** Вода нигде не проливалась мимо. */
  dry: boolean;
  season: Season;
  /** Повороты решённого поля — чтобы показать его снова. */
  rots: string;
}

export const roundTime = (seconds: number): number => Math.round(seconds * 10) / 10;

/** Ходы сверх минимума. */
export const extraOf = (r: Pick<SolveResult, 'moves' | 'minMoves'>): number =>
  Math.max(0, r.moves - r.minMoves);

/**
 * Капли для текста результата: три — без лишних ходов, две — лишних не больше трети
 * минимума (но хотя бы два хода допуска), одна — решено. С подсказкой — не больше двух.
 */
export function dropsOf(moves: number, minMoves: number, hints = 0): 1 | 2 | 3 {
  const extra = Math.max(0, moves - minMoves);
  if (extra === 0) return hints > 0 ? 2 : 3;
  return extra <= Math.max(2, Math.floor(minMoves / 3)) ? 2 : 1;
}

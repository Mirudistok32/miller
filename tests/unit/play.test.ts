import { describe, expect, it } from 'vitest';

import { flow } from '@/domain/flow';
import { CCW, CW, maskOf } from '@/domain/grid';
import { endlessLevel } from '@/domain/levels';
import { advance, restartPlay, rotateAt, startPlay, undoPlay } from '@/domain/play';
import { extraOf } from '@/domain/result';

import { board } from './helpers';

describe('партия', () => {
  const b = board(['─··', '└─┐', '··│'], 0, 2);

  it('поворот — ход; пустая клетка — не ход', () => {
    const p = startPlay(b);
    expect(p.solved).toBe(false);
    const next = rotateAt(p, 0);
    expect(next?.moves).toBe(1);
    expect(maskOf(next?.board.cells[0] ?? { kind: 'empty', rot: 0 })).not.toBe(
      maskOf(p.board.cells[0] ?? { kind: 'empty', rot: 0 }),
    );
    expect(rotateAt(p, 1)).toBeNull();
    expect(rotateAt(p, 99)).toBeNull();
  });

  it('поворот против часовой — тоже один ход, и он решает уровень', () => {
    // '─' в клетке 0 встаёт в '│' одним поворотом в любую сторону
    const next = rotateAt(startPlay(b), 0, CCW);
    expect(next?.moves).toBe(1);
    expect(next?.started).toBe(true);
    expect(next?.solved).toBe(true);
    expect(rotateAt(startPlay(b), 1, CCW)).toBeNull();
  });

  it('часы стоят до первого хода и останавливаются, когда вода дошла до колеса', () => {
    let p = advance(startPlay(b), 5);
    expect(p.time).toBe(0);
    p = rotateAt(p, 0) ?? p;
    expect(p.solved).toBe(true);
    expect(advance(p, 3).time).toBe(0);
    const q = advance({ ...p, solved: false }, 3);
    expect(q.time).toBe(3);
  });

  it('после решения поворачивать нельзя', () => {
    const solved = rotateAt(startPlay(b), 0);
    expect(solved?.solved).toBe(true);
    expect(rotateAt(solved ?? startPlay(b), 4)).toBeNull();
  });

  it('заново: поле как на старте, ходы и время с нуля, попытка +1', () => {
    let p = startPlay(b);
    p = rotateAt(p, 3) ?? p;
    p = rotateAt(p, 4) ?? p;
    p = advance(p, 12);
    const again = restartPlay(p);
    expect(again.board).toEqual(b);
    expect(again.moves).toBe(0);
    expect(again.time).toBe(0);
    expect(again.started).toBe(false);
    expect(again.attempts).toBe(2);
  });

  it('отмена возвращает поле, но не ход и не время: и по часовой, и против', () => {
    for (const spin of [CW, CCW]) {
      const p = startPlay(b);
      const turned = advance(rotateAt(rotateAt(p, 3, spin) ?? p, 4, spin) ?? p, 5);
      const once = undoPlay(turned);
      expect(once?.board.cells[4]).toEqual(p.board.cells[4]);
      expect(once?.board.cells[3]).toEqual(turned.board.cells[3]);
      expect(once?.moves).toBe(2);
      expect(once?.time).toBe(5);
      const twice = once && undoPlay(once);
      expect(twice?.board).toEqual(p.board);
      expect(twice?.moves).toBe(2);
      expect(twice?.started).toBe(true);
      expect(twice && undoPlay(twice)).toBeNull();
    }
  });

  it('отмена не решает уровень без лишних ходов: минимум с отменой недостижим', () => {
    for (const n of [1, 5, 12, 30]) {
      const level = endlessLevel(n);
      let p = startPlay(level.board);
      const c = level.solution.path[0] ?? 0;
      p = rotateAt(p, c) ?? p;
      p = undoPlay(p) ?? p;
      expect(p.board).toEqual(level.board);
      level.solution.turns.forEach((t, i) => {
        for (let k = 0; k < Math.abs(t); k++) p = rotateAt(p, i, t < 0 ? CCW : CW) ?? p;
      });
      expect(p.solved).toBe(true);
      expect(extraOf({ moves: p.moves, minMoves: level.solution.moves })).toBe(1);
    }
  });

  it('заново стирает историю, а решённый уровень не отменяется', () => {
    const p = rotateAt(startPlay(b), 0);
    expect(p && undoPlay(restartPlay(p))).toBeNull();
    const level = endlessLevel(1);
    let q = startPlay(level.board);
    level.solution.turns.forEach((t, i) => {
      for (let k = 0; k < Math.abs(t); k++) q = rotateAt(q, i, t < 0 ? CCW : CW) ?? q;
    });
    expect(q.solved).toBe(true);
    expect(undoPlay(q)).toBeNull();
  });

  it('решение решателя, сыгранное кликами, собирает путь ровно за минимум ходов', () => {
    for (const n of [1, 5, 12, 30]) {
      const level = endlessLevel(n);
      let p = startPlay(level.board);
      level.solution.turns.forEach((t, i) => {
        for (let k = 0; k < Math.abs(t); k++) p = rotateAt(p, i, t < 0 ? CCW : CW) ?? p;
      });
      expect(p.solved, `уровень ${n}`).toBe(true);
      expect(p.moves).toBe(level.solution.moves);
      expect(flow(p.board).solved).toBe(true);
    }
  });
});

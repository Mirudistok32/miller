import { describe, expect, it } from 'vitest';

import { flow, FLOW_CELL, wetTimes } from '@/domain/flow';
import { E, N, rotateCell, S, W } from '@/domain/grid';

import { board } from './helpers';

describe('вода', () => {
  it('путь собран: вода от родника доходит до колеса, ничего не проливается', () => {
    const b = board(['│··', '└─┐', '··│'], 0, 2);
    const f = flow(b);
    expect(f.solved).toBe(true);
    expect(f.leaks).toEqual([]);
    expect(f.order).toEqual([0, 3, 4, 5, 8]);
    expect(f.dist[8]).toBe(4);
    expect(f.from[3]).toBe(N);
    expect(f.from[4]).toBe(W);
    expect(f.parent[5]).toBe(4);
    expect(f.dist[1]).toBe(-1);
  });

  it('один повёрнутый жёлоб — и вода дальше не идёт', () => {
    const b = rotateCell(board(['│··', '└─┐', '··│'], 0, 2), 4);
    const f = flow(b);
    expect(f.solved).toBe(false);
    expect(f.dist[4]).toBe(-1);
    expect(f.dist[8]).toBe(-1);
    expect(f.leaks).toEqual([{ cell: 3, dir: E }]);
  });

  it('родник упирается в закрытый жёлоб — сухо всё поле', () => {
    const f = flow(board(['─·', '││'], 0, 1));
    expect(f.order).toEqual([]);
    expect(f.solved).toBe(false);
  });

  it('развилка проливает воду в открытый конец и за край поля', () => {
    const b = board(['├┐', '││'], 0, 0);
    const f = flow(b);
    expect(f.solved).toBe(true);
    // правая колонка: из ┐ вода падает в │, а та — за нижний край, мимо колеса
    expect(f.leaks).toEqual([{ cell: 3, dir: S }]);
  });

  it('вода дошла до нижней клетки столбца мельницы, но вниз не выходит — колесо стоит', () => {
    const f = flow(board(['│·', '└┘'], 0, 1));
    expect(f.dist[3]).toBe(2);
    expect(f.solved).toBe(false);
  });

  it('колесо — только под своим столбцом', () => {
    expect(flow(board(['│·', '││'], 0, 1)).solved).toBe(false);
    expect(flow(board(['│·', '││'], 0, 0)).solved).toBe(true);
  });

  it('время прихода воды: клетка за клеткой, мокрые остаются как были, сухие — Infinity', () => {
    const b = board(['│··', '└─┐', '··│'], 0, 2);
    const first = wetTimes(null, flow(b), 10);
    expect(first[0]).toBe(10);
    expect(first[3]).toBeCloseTo(10 + FLOW_CELL);
    expect(first[8]).toBeCloseTo(10 + 4 * FLOW_CELL);
    expect(first[1]).toBe(Infinity);

    // Повернули середину: дальше неё сухо, до неё — как было.
    const cut = wetTimes(first, flow(rotateCell(b, 4)), 20);
    expect(cut[0]).toBe(10);
    expect(cut[4]).toBe(Infinity);
    expect(cut[8]).toBe(Infinity);

    // Вернули на место — новая вода идёт от момента поворота, а не от старого времени.
    let back = rotateCell(b, 4);
    back = rotateCell(rotateCell(rotateCell(back, 4), 4), 4);
    const again = wetTimes(cut, flow(back), 30);
    expect(again[3]).toBe(10 + FLOW_CELL);
    expect(again[4]).toBe(30);
    expect(again[5]).toBeCloseTo(30 + FLOW_CELL);
  });
});

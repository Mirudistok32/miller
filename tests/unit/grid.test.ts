import { describe, expect, it } from 'vitest';

import {
  BASE_MASK,
  CCW,
  cellForMask,
  CW,
  DIRS,
  E,
  type Kind,
  maskOf,
  N,
  neighbor,
  opposite,
  rotateCell,
  rotsOf,
  S,
  turnMask,
  W,
  withRots,
} from '@/domain/grid';

import { board } from './helpers';

describe('поворот жёлоба', () => {
  it('четверть оборота по часовой стрелке: вверх → вправо → вниз → влево → вверх', () => {
    expect(turnMask(N)).toBe(E);
    expect(turnMask(E)).toBe(S);
    expect(turnMask(S)).toBe(W);
    expect(turnMask(W)).toBe(N);
    expect(turnMask(N | E)).toBe(E | S);
  });

  it('четыре поворота возвращают любую форму на место', () => {
    for (let mask = 0; mask < 16; mask++) expect(turnMask(mask, 4)).toBe(mask);
  });

  it('прямой жёлоб различим в двух положениях, угол и развилка — в четырёх', () => {
    const shapes = (kind: Kind) => new Set([0, 1, 2, 3].map((r) => maskOf({ kind, rot: r }))).size;
    expect(shapes('straight')).toBe(2);
    expect(shapes('corner')).toBe(4);
    expect(shapes('tee')).toBe(4);
    expect(shapes('empty')).toBe(1);
  });

  it('у развилки три стороны, у угла и прямого — две', () => {
    expect(BASE_MASK.tee).toBe(N | E | S);
    for (const kind of ['straight', 'corner'] as const) {
      for (let r = 0; r < 4; r++) {
        const m = maskOf({ kind, rot: r });
        expect(DIRS.filter((d) => m & d)).toHaveLength(2);
      }
    }
  });

  it('противоположные стороны', () => {
    expect(DIRS.map(opposite)).toEqual([S, W, N, E]);
  });

  it('форма по маске: двух- и трёхсторонние есть, тупика и креста нет', () => {
    for (let mask = 1; mask < 15; mask++) {
      const sides = DIRS.filter((d) => mask & d).length;
      const cell = cellForMask(mask);
      if (sides === 2 || sides === 3) expect(cell && maskOf(cell)).toBe(mask);
      else expect(cell).toBeNull();
    }
    expect(cellForMask(0)?.kind).toBe('empty');
    expect(cellForMask(15)).toBeNull();
  });

  it('клик поворачивает клетку, не трогая исходное поле; пустая не поворачивается', () => {
    const b = board(['│·'], 0, 0);
    const turned = rotateCell(b, 0);
    expect(maskOf(turned.cells[0] ?? { kind: 'empty', rot: 0 })).toBe(E | W);
    expect(maskOf(b.cells[0] ?? { kind: 'empty', rot: 0 })).toBe(N | S);
    expect(rotateCell(b, 1)).toBe(b);
    let full = b;
    for (let i = 0; i < 4; i++) full = rotateCell(full, 0);
    expect(full.cells[0]).toEqual(b.cells[0]);
  });

  it('против часовой — обратно по часовой; пустая клетка не поворачивается', () => {
    const b = board(['└·'], 0, 0);
    const back = rotateCell(b, 0, CCW);
    expect(maskOf(back.cells[0] ?? { kind: 'empty', rot: 0 })).toBe(W | N);
    expect(back.cells[0]?.rot).toBe(((b.cells[0]?.rot ?? 0) + 3) % 4);
    expect(rotateCell(back, 0, CW).cells[0]).toEqual(b.cells[0]);
    expect(rotateCell(b, 1, CCW)).toBe(b);
  });

  it('соседи и края поля', () => {
    const b = board(['│─', '││'], 0, 1);
    expect(neighbor(b, 0, E)).toBe(1);
    expect(neighbor(b, 0, S)).toBe(2);
    expect(neighbor(b, 0, N)).toBe(-1);
    expect(neighbor(b, 0, W)).toBe(-1);
    expect(neighbor(b, 3, E)).toBe(-1);
    expect(neighbor(b, 3, S)).toBe(-1);
  });

  it('повороты строкой: туда и обратно, чужая строка не подходит', () => {
    const b = board(['┌┐', '└┘'], 0, 1);
    const rots = rotsOf(b);
    expect(withRots(rotateCell(b, 0), rots)).toEqual(b);
    expect(withRots(b, '012')).toBeNull();
    expect(withRots(b, '01x3')).toBeNull();
  });
});

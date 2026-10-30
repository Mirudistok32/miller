import { describe, expect, it } from 'vitest';

import {
  CELL,
  cellAt,
  cellCenter,
  computeLayout,
  MILL_H,
  MIN_ABOVE,
  MIN_BELOW,
  type Reserve,
  SPRING_H,
  type Viewport,
} from '@/presentation/layout';

/** Где HUD: на телефоне — полоса сверху, на широком экране — колонка слева (как в styles.css). */
const hudReserve = (v: Viewport): Reserve =>
  v.width > v.height && v.width >= 640
    ? { top: 0, right: 0, bottom: 0, left: Math.min(220, Math.max(160, v.width * 0.18)) + 16 }
    : { top: 64, right: 0, bottom: 0, left: 0 };

const PHONES: Viewport[] = [
  { width: 390, height: 844, dpr: 3 },
  { width: 360, height: 640, dpr: 2 },
  { width: 844, height: 390, dpr: 3 },
  { width: 667, height: 375, dpr: 2 },
];
const LARGE: Viewport[] = [
  { width: 1280, height: 720, dpr: 1 },
  { width: 1920, height: 1080, dpr: 1 },
  { width: 1440, height: 900, dpr: 2 },
  { width: 768, height: 1024, dpr: 2 },
];
const BOARDS = [
  { cols: 4, rows: 4 },
  { cols: 5, rows: 6 },
  { cols: 6, rows: 7 },
  { cols: 7, rows: 7 },
];

describe('раскладка поля', () => {
  for (const v of [...PHONES, ...LARGE]) {
    for (const b of BOARDS) {
      const name = `${v.width}×${v.height}, поле ${b.cols}×${b.rows}`;
      it(`${name}: поле целиком в свободной части окна, лоток и верх колеса видны`, () => {
        const r = hudReserve(v);
        const L = computeLayout(v, b, r);
        const s = L.scale;
        expect(L.boardX * s).toBeGreaterThanOrEqual(r.left - 0.5);
        expect((L.boardX + b.cols * CELL) * s).toBeLessThanOrEqual(v.width + 0.5);
        expect((L.boardY - MIN_ABOVE) * s).toBeGreaterThanOrEqual(r.top - 0.5);
        expect((L.boardY + b.rows * CELL + MIN_BELOW) * s).toBeLessThanOrEqual(v.height + 0.5);
        // холст закрывает всё окно
        expect(L.width * s).toBeGreaterThanOrEqual(v.width);
        expect(L.height * s).toBeGreaterThanOrEqual(v.height);
      });
    }
  }

  it('на телефоне в любой ориентации клетка не меньше 40 CSS-пикселей', () => {
    for (const v of PHONES) {
      for (const b of BOARDS)
        expect(computeLayout(v, b, hudReserve(v)).scale * CELL).toBeGreaterThanOrEqual(40);
    }
  });

  it('на больших экранах видна вся сцена: пруд сверху и мельница снизу', () => {
    for (const v of LARGE) {
      for (const b of BOARDS) {
        const r = hudReserve(v);
        const L = computeLayout(v, b, r);
        expect((L.boardY - SPRING_H) * L.scale).toBeGreaterThanOrEqual(r.top - 0.5);
        expect((L.boardY + b.rows * CELL + MILL_H) * L.scale).toBeLessThanOrEqual(v.height + 0.5);
        expect(L.scale * CELL).toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('пиксели ровные: целое число пикселей экрана на пиксель игры', () => {
    for (const v of [...PHONES, ...LARGE]) {
      const L = computeLayout(v, { cols: 6, rows: 7 }, hudReserve(v));
      expect(Number.isInteger(Math.round(L.scale * v.dpr * 1000) / 1000)).toBe(true);
    }
  });

  it('нажатие в центр клетки попадает в неё, мимо поля — никуда', () => {
    const L = computeLayout({ width: 390, height: 844, dpr: 3 }, { cols: 6, rows: 7 });
    for (let i = 0; i < 42; i++) {
      const { x, y } = cellCenter(L, i);
      expect(cellAt(L, x, y)).toBe(i);
    }
    expect(cellAt(L, 1, 1)).toBeNull();
    const last = cellCenter(L, 41);
    expect(cellAt(L, last.x + CELL * L.scale, last.y)).toBeNull();
  });
});

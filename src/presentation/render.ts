/**
 * Отрисовка кадра: деревня сверху, поле с жёлобами, родник, мельница с колесом, вода и
 * погода — всё кодом, пикселями. Неподвижное (земля, деревья, избы, плитки поля, мельница)
 * рисуется в запасной холст и перерисовывается, только когда меняются размер, уровень или
 * время года. Остальное вычисляется из кадра: одинаковый кадр выглядит одинаково.
 */

import { type Frame, type Session, TURN_TIME } from '@/application/game';
import { FLOW_CELL } from '@/domain/flow';
import { type Board, cellOf, CW, type Dir, DIRS, E, maskOf, N, S } from '@/domain/grid';
import type { HintMove } from '@/domain/solver';

import { CELL, type Layout, MILL_H, SPRING_H } from './layout';
import { mix, PALETTES, type ScenePalette } from './palette';

type Ctx = CanvasRenderingContext2D;

/** Детерминированный шум 0–1 по целому числу. */
function noise(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const noise2 = (x: number, y: number) =>
  noise(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663));

const WOOD = '#8A5A3C';
const WOOD_DARK = '#6E4630';
const WOOD_LIGHT = '#B07C50';
const WOOD_DEEP = '#3E271B';
const TROUGH = '#54362A';
const ROOF = '#6B4A34';
const ROOF_LIGHT = '#82593C';
const STONE = '#8E9198';
const STONE_DARK = '#666971';
const STONE_LIGHT = '#B7BAC0';
const WINDOW = '#F2C14E';
const WINDOW_LIT = '#FFE08A';
const SNOW = '#F7FAFD';
const BIRCH = '#EDEBE4';
const CURSOR = '#F2D16B';
const SHADOW = 'rgba(20, 16, 12, 0.22)';

export const WHEEL_R = 11;
const HOUSE_W = 30;
const HOUSE_H = 22;

/** Где что стоит на холсте при этой раскладке, пикселей игры. */
interface Scene {
  bx: number;
  by: number;
  bw: number;
  bh: number;
  springX: number;
  poolY: number;
  wheelX: number;
  wheelY: number;
  houseX: number;
  houseY: number;
  /** Мельница справа от колеса (колесо в левой половине поля). */
  houseRight: boolean;
}

function sceneOf(L: Layout, b: Board): Scene {
  const bx = L.boardX;
  const by = L.boardY;
  const bw = b.cols * CELL;
  const bh = b.rows * CELL;
  const wheelX = bx + b.mill * CELL + CELL / 2;
  const wheelY = by + bh + 5 + WHEEL_R;
  const houseRight = b.mill * 2 < b.cols - 1 || (b.mill * 2 === b.cols - 1 && b.source > b.mill);
  return {
    bx,
    by,
    bw,
    bh,
    springX: bx + b.source * CELL + CELL / 2,
    poolY: by - 10,
    wheelX,
    wheelY,
    houseX: houseRight ? wheelX + WHEEL_R - 2 : wheelX - WHEEL_R + 2 - HOUSE_W,
    houseY: wheelY + WHEEL_R + 1 - HOUSE_H,
    houseRight,
  };
}

/** Ручей сверху: от края холста к пруду родника, плавно петляет. */
const upperX = (s: Scene, y: number) => {
  const d = s.poolY - y;
  return s.springX + Math.sin(d * 0.08 + s.springX * 0.3) * 6 * Math.min(1, d / 24);
};
/** Ручей снизу: из-под колеса к краю холста. */
const lowerTop = (s: Scene) => s.wheelY + 4;
const lowerX = (s: Scene, y: number) => {
  const d = y - lowerTop(s);
  return s.wheelX + Math.sin(d * 0.07 + s.wheelX * 0.2) * 7 * Math.min(1, d / 20);
};

/* ---------- кисть ---------- */

interface Pen {
  ctx: Ctx;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  disc(cx: number, cy: number, rx: number, ry: number, color: string): void;
  line(x0: number, y0: number, x1: number, y1: number, color: string): void;
}

function pen(ctx: Ctx): Pen {
  return {
    ctx,
    rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    },
    disc(cx, cy, rx, ry, color) {
      ctx.fillStyle = color;
      for (let dy = -ry; dy <= ry; dy++) {
        const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
        ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, 1);
      }
    },
    /** Отрезок пикселями (Брезенхэм): спицы колеса остаются пиксельными. */
    line(x0, y0, x1, y1, color) {
      ctx.fillStyle = color;
      let x = Math.round(x0);
      let y = Math.round(y0);
      const xe = Math.round(x1);
      const ye = Math.round(y1);
      const dx = Math.abs(xe - x);
      const dy = -Math.abs(ye - y);
      const sx = x < xe ? 1 : -1;
      const sy = y < ye ? 1 : -1;
      let err = dx + dy;
      for (let i = 0; i < 200; i++) {
        ctx.fillRect(x, y, 1, 1);
        if (x === xe && y === ye) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y += sy;
        }
      }
    },
  };
}

/* ---------- жёлоб ---------- */

/**
 * Прямоугольник вдоль плеча жёлоба в сторону d: a — от края клетки к центру (0…16),
 * b — поперёк, от оси (−8…8). Клетка 16×16, центр в (8, 8).
 */
function seg(
  ctx: Ctx,
  x0: number,
  y0: number,
  d: Dir,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
) {
  if (a1 <= a0) return;
  if (d === N) ctx.fillRect(x0 + 8 + b0, y0 + a0, b1 - b0, a1 - a0);
  else if (d === S) ctx.fillRect(x0 + 8 + b0, y0 + 16 - a1, b1 - b0, a1 - a0);
  else if (d === E) ctx.fillRect(x0 + 16 - a1, y0 + 8 + b0, a1 - a0, b1 - b0);
  else ctx.fillRect(x0 + a0, y0 + 8 + b0, a1 - a0, b1 - b0);
}

/** Все плечи маски полосой ширины 2·half: от края клетки до центра и чуть дальше. */
function shape(ctx: Ctx, x0: number, y0: number, mask: number, half: number, color: string) {
  ctx.fillStyle = color;
  for (const d of DIRS) if (mask & d) seg(ctx, x0, y0, d, 0, 8 + half, -half, half);
}

/** Деревянный жёлоб сверху: тень, борта, внутренняя стенка, дно. */
function trough(ctx: Ctx, x0: number, y0: number, mask: number, shadow: boolean) {
  if (shadow) shape(ctx, x0 + 1, y0 + 1, mask, 5, SHADOW);
  shape(ctx, x0, y0, mask, 5, WOOD_DEEP);
  shape(ctx, x0, y0, mask, 4, WOOD_LIGHT);
  shape(ctx, x0, y0, mask, 3, WOOD_DARK);
  shape(ctx, x0, y0, mask, 2, TROUGH);
  // стыки досок на бортах
  ctx.fillStyle = WOOD;
  for (const d of DIRS) {
    if (!(mask & d)) continue;
    seg(ctx, x0, y0, d, 3, 4, -4, -3);
    seg(ctx, x0, y0, d, 3, 4, 3, 4);
  }
}

/**
 * Вода в жёлобе: сперва плечо, откуда она пришла (от края к центру), потом остальные (от
 * центра к краям). f — доля заполнения 0–1. Блики бегут по течению.
 */
function water(
  ctx: Ctx,
  x0: number,
  y0: number,
  mask: number,
  from: number,
  f: number,
  t: number,
  pal: ScenePalette,
  phase: number,
) {
  const inLen = Math.min(1, f * 2) * 10;
  const outLen = Math.max(0, f * 2 - 1) * 10;
  ctx.fillStyle = pal.water;
  for (const d of DIRS) {
    if (!(mask & d)) continue;
    if (d === from) seg(ctx, x0, y0, d, 0, inLen, -2, 2);
    else seg(ctx, x0, y0, d, 10 - outLen, 10, -2, 2);
  }
  ctx.fillStyle = pal.waterLight;
  for (const d of DIRS) {
    if (!(mask & d)) continue;
    const entry = d === from;
    const lo = entry ? 0 : 10 - outLen;
    const hi = entry ? inLen : 10;
    for (let k = 0; k < 2; k++) {
      const run = (t * 18 + k * 5 + phase) % 10;
      const a = entry ? lo + run : hi - 2 - run;
      if (a < lo || a + 2 > hi) continue;
      seg(ctx, x0, y0, d, a, a + 2, k === 0 ? -1 : 0, k === 0 ? 0 : 1);
    }
  }
}

/* ---------- деревня ---------- */

type DecorKind = 'fir' | 'birch' | 'bush' | 'izba' | 'hay' | 'stones' | 'fence' | 'stump';

/** Ширина и высота предмета; якорь — середина нижнего края. */
const FOOT: Readonly<Record<DecorKind, readonly [number, number]>> = {
  fir: [13, 20],
  birch: [12, 19],
  bush: [11, 7],
  izba: [24, 21],
  hay: [12, 11],
  stones: [9, 4],
  fence: [21, 8],
  stump: [7, 5],
};

function decorKind(n: number): DecorKind | null {
  if (n < 0.28) return 'fir';
  if (n < 0.44) return 'birch';
  if (n < 0.6) return 'bush';
  if (n < 0.66) return 'izba';
  if (n < 0.71) return 'hay';
  if (n < 0.79) return 'stones';
  if (n < 0.83) return 'fence';
  if (n < 0.87) return 'stump';
  return null;
}

function drawDecor(P: Pen, kind: DecorKind, x: number, y: number, pal: ScenePalette) {
  const [w] = FOOT[kind];
  if (kind !== 'stones' && kind !== 'fence') P.disc(x, y, Math.ceil(w / 2), 2, SHADOW);
  switch (kind) {
    case 'fir': {
      P.rect(x - 1, y - 4, 3, 4, WOOD_DARK);
      const tiers: [number, number, number][] = [
        [y - 11, y - 3, 6],
        [y - 16, y - 9, 5],
        [y - 20, y - 14, 3],
      ];
      for (const [top, bottom, half] of tiers) {
        const h = bottom - top;
        for (let r = 0; r <= h; r++) {
          const wr = Math.max(1, Math.round(half * (0.2 + 0.8 * (r / h))));
          P.rect(x - wr, top + r, wr, 1, pal.fir);
          P.rect(x, top + r, wr + 1, 1, pal.firDark);
        }
        if (pal.snow)
          P.rect(x - Math.max(1, half - 2), top + 2, Math.max(2, half * 2 - 3), 1, SNOW);
      }
      break;
    }
    case 'birch': {
      P.rect(x - 1, y - 9, 2, 9, BIRCH);
      P.rect(x - 1, y - 6, 1, 1, '#2A2A2A');
      P.rect(x, y - 3, 1, 1, '#2A2A2A');
      P.disc(x, y - 13, 6, 6, pal.crownDark);
      P.disc(x - 1, y - 14, 4, 4, pal.crown);
      if (pal.snow) P.rect(x - 3, y - 19, 6, 1, SNOW);
      break;
    }
    case 'bush': {
      P.disc(x, y - 3, 5, 3, pal.crownDark);
      P.disc(x - 1, y - 4, 3, 2, pal.crown);
      if (pal.snow) P.rect(x - 3, y - 7, 6, 1, SNOW);
      else if (pal.flowers[0]) P.rect(x + 1, y - 5, 1, 1, pal.flowers[0]);
      break;
    }
    case 'izba': {
      const left = x - 10;
      const wallTop = y - 10;
      P.rect(left, wallTop, 20, 10, WOOD);
      for (let r = wallTop + 1; r < y; r += 2) P.rect(left, r, 20, 1, WOOD_DARK);
      P.rect(left + 7, wallTop + 3, 6, 5, '#EDE4D0');
      P.rect(left + 8, wallTop + 4, 4, 3, WINDOW);
      for (let r = 0; r <= 9; r++) {
        const half = Math.round(12 * (r / 9));
        P.rect(
          x - half,
          y - 20 + r,
          half * 2,
          1,
          pal.snow && r < 6 ? SNOW : r % 3 === 0 ? ROOF_LIGHT : ROOF,
        );
      }
      P.rect(x + 5, y - 21, 3, 5, '#7A4A3A');
      break;
    }
    case 'hay': {
      for (let r = 0; r < 10; r++) {
        const half = Math.round(2 + r * 0.45);
        P.rect(x - half, y - 10 + r, half * 2, 1, r % 3 === 0 ? '#B08A3A' : '#D9B45A');
      }
      if (pal.snow) P.rect(x - 3, y - 11, 6, 2, SNOW);
      break;
    }
    case 'stones': {
      P.disc(x - 2, y - 2, 3, 2, STONE_DARK);
      P.disc(x - 2, y - 2, 2, 1, STONE);
      P.disc(x + 3, y - 1, 2, 1, STONE_DARK);
      P.rect(x - 3, y - 3, 1, 1, STONE_LIGHT);
      if (pal.snow) P.rect(x - 4, y - 4, 4, 1, SNOW);
      break;
    }
    case 'fence': {
      for (let i = 0; i < 5; i++) P.rect(x - 10 + i * 5, y - 8, 2, 8, WOOD);
      P.rect(x - 11, y - 6, 22, 1, WOOD_LIGHT);
      P.rect(x - 11, y - 3, 22, 1, WOOD_LIGHT);
      if (pal.snow) for (let i = 0; i < 5; i++) P.rect(x - 10 + i * 5, y - 9, 2, 1, SNOW);
      break;
    }
    case 'stump': {
      P.rect(x - 3, y - 4, 6, 4, WOOD_DARK);
      P.rect(x - 3, y - 5, 6, 2, pal.snow ? SNOW : '#C9A26E');
      P.rect(x - 1, y - 4, 2, 1, WOOD);
      break;
    }
  }
}

export function createRenderer(canvas: HTMLCanvasElement, opts: { reducedMotion: () => boolean }) {
  const maybe = canvas.getContext('2d');
  const back = document.createElement('canvas');
  const maybeBack = back.getContext('2d');
  if (!maybe || !maybeBack) throw new Error('canvas 2d недоступен');
  const ctx: Ctx = maybe;
  const P = pen(ctx);
  const B = pen(maybeBack);
  let layout: Layout | null = null;
  let backKey = '';

  /* ---------- неподвижное: в запасной холст ---------- */

  function streamBed(
    pal: ScenePalette,
    x: (y: number) => number,
    y0: number,
    y1: number,
    w: number,
  ) {
    for (let y = Math.max(0, Math.floor(y0)); y < y1; y++) {
      const cx = Math.round(x(y));
      B.rect(cx - Math.ceil(w / 2) - 1, y, w + 2, 1, pal.bank);
      B.rect(cx - Math.ceil(w / 2), y, w, 1, pal.water);
      if (noise2(cx, y) < 0.12) B.rect(cx - Math.ceil(w / 2), y, 1, 1, pal.waterDeep);
    }
  }

  function buildBack(L: Layout, s: Session) {
    const pal = PALETTES[s.season];
    const b = s.play.board;
    const sc = sceneOf(L, b);
    back.width = L.width;
    back.height = L.height;
    B.ctx.imageSmoothingEnabled = false;

    // земля: трава или снег с крапинками, цветы и листья
    B.rect(0, 0, L.width, L.height, pal.grass);
    for (let y = 0; y < L.height; y += 2) {
      for (let x = 0; x < L.width; x += 2) {
        const n = noise2(x, y);
        if (n < 0.07) B.rect(x, y, 2, 1, pal.grassDark);
        else if (n > 0.955) B.rect(x, y, 1, 1, pal.grassLight);
        else if (n > 0.94 && pal.flowers.length > 0) {
          B.rect(x, y, 1, 1, pal.flowers[Math.floor(noise2(y, x) * pal.flowers.length)] ?? SNOW);
        }
      }
    }

    // ручьи: сверху в пруд родника, снизу из-под колеса
    streamBed(pal, (y) => upperX(sc, y), 0, sc.poolY - 3, 4);
    streamBed(pal, (y) => lowerX(sc, y), lowerTop(sc), L.height, 6);

    // деревня вокруг поля: случайно, но одинаково для одного уровня
    const keepOut = [
      [sc.bx - 8, sc.by - SPRING_H - 6, sc.bw + 16, sc.bh + SPRING_H + MILL_H + 10],
      [sc.houseX - 3, sc.houseY - 8, HOUSE_W + 6, HOUSE_H + 10],
    ] as const;
    const free = (x: number, y: number, w: number, h: number) => {
      for (const [kx, ky, kw, kh] of keepOut) {
        if (x < kx + kw && x + w > kx && y < ky + kh && y + h > ky) return false;
      }
      for (let yy = y; yy <= y + h; yy += 2) {
        if (yy < sc.poolY && Math.abs(upperX(sc, yy) - (x + w / 2)) < w / 2 + 5) return false;
        if (yy > lowerTop(sc) && Math.abs(lowerX(sc, yy) - (x + w / 2)) < w / 2 + 6) return false;
      }
      return x > -w / 2 && x + w < L.width + w / 2;
    };
    const items: { kind: DecorKind; x: number; y: number }[] = [];
    const step = 17;
    for (let gy = 0; gy * step < L.height + 24; gy++) {
      for (let gx = 0; gx * step < L.width + 8; gx++) {
        const n = noise2(gx * 31 + s.generated.seed, gy * 17);
        const kind = decorKind(n);
        if (!kind) continue;
        const [w, h] = FOOT[kind];
        const x = gx * step + Math.floor(noise2(gx, gy * 3) * 10);
        const y = gy * step + Math.floor(noise2(gx * 5, gy) * 10);
        if (free(x - w / 2, y - h, w, h)) items.push({ kind, x, y });
      }
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) drawDecor(B, it.kind, it.x, it.y, pal);

    springStatic(pal, sc);
    millStatic(pal, sc);
    boardStatic(pal, sc, b, s.generated.seed);
  }

  function springStatic(pal: ScenePalette, sc: Scene) {
    const { springX: x, poolY: y } = sc;
    B.disc(x, y + 1, 10, 5, SHADOW);
    B.disc(x, y, 9, 5, STONE_DARK);
    B.disc(x, y, 7, 4, pal.waterDeep);
    B.disc(x, y - 1, 5, 2, pal.water);
    // камни по краю пруда
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      const sx = x + Math.cos(a) * 9;
      const sy = y + Math.sin(a) * 5;
      if (sy > y + 3 && Math.abs(sx - x) < 6) continue; // тут выходит лоток
      B.disc(sx, sy, 2, 1, STONE);
      B.rect(sx - 1, sy - 1, 1, 1, pal.snow ? SNOW : STONE_LIGHT);
    }
    // лоток из пруда к полю
    const top = y + 3;
    B.ctx.fillStyle = WOOD_DEEP;
    B.ctx.fillRect(x - 5, top, 10, sc.by - top);
    B.ctx.fillStyle = WOOD_LIGHT;
    B.ctx.fillRect(x - 4, top, 8, sc.by - top);
    B.ctx.fillStyle = WOOD_DARK;
    B.ctx.fillRect(x - 3, top, 6, sc.by - top);
  }

  function millStatic(pal: ScenePalette, sc: Scene) {
    const { houseX: hx, houseY: hy } = sc;
    const bottom = hy + HOUSE_H;
    B.disc(hx + HOUSE_W / 2, bottom, HOUSE_W / 2 + 2, 2, SHADOW);
    // сруб
    const wallTop = hy + 9;
    B.rect(hx, wallTop, HOUSE_W, bottom - wallTop, WOOD);
    for (let r = wallTop + 1; r < bottom; r += 2) B.rect(hx, r, HOUSE_W, 1, WOOD_DARK);
    // дверь и окно
    const doorX = sc.houseRight ? hx + HOUSE_W - 11 : hx + 5;
    B.rect(doorX, bottom - 8, 6, 8, WOOD_DEEP);
    B.rect(doorX + 1, bottom - 7, 4, 7, '#4A3020');
    const winX = sc.houseRight ? hx + 7 : hx + HOUSE_W - 13;
    B.rect(winX, wallTop + 3, 6, 5, '#EDE4D0');
    // крыша
    for (let r = 0; r <= 10; r++) {
      const half = Math.round((HOUSE_W / 2 + 2) * (0.35 + 0.65 * (r / 10)));
      const color = pal.snow && r < 7 ? SNOW : r % 3 === 0 ? ROOF_LIGHT : ROOF;
      B.rect(hx + HOUSE_W / 2 - half, hy - 1 + r, half * 2, 1, color);
    }
    // брус от стены к колесу — до обода: дальше его закрывает колесо
    const wall = sc.houseRight ? hx : hx + HOUSE_W;
    const rim = sc.wheelX + (sc.houseRight ? WHEEL_R - 1 : -(WHEEL_R - 1));
    B.rect(Math.min(wall, rim), sc.wheelY - 1, Math.abs(wall - rim), 2, WOOD_DEEP);
    // лоток от поля к колесу
    const top = sc.by + sc.bh;
    const end = sc.wheelY - WHEEL_R;
    B.ctx.fillStyle = WOOD_DEEP;
    B.ctx.fillRect(sc.wheelX - 5, top, 10, end - top);
    B.ctx.fillStyle = WOOD_LIGHT;
    B.ctx.fillRect(sc.wheelX - 4, top, 8, end - top);
    B.ctx.fillStyle = WOOD_DARK;
    B.ctx.fillRect(sc.wheelX - 3, top, 6, end - top);
    B.ctx.fillStyle = TROUGH;
    B.ctx.fillRect(sc.wheelX - 2, top, 4, end - top);
  }

  function boardStatic(pal: ScenePalette, sc: Scene, b: Board, seed: number) {
    const { bx, by, bw, bh } = sc;
    B.rect(bx - 2, by + bh + 3, bw + 6, 2, SHADOW);
    B.rect(bx - 3, by - 3, bw + 6, bh + 6, WOOD_DEEP);
    B.rect(bx - 2, by - 2, bw + 4, bh + 4, WOOD);
    for (let x = bx; x < bx + bw; x += 8) {
      B.rect(x, by - 2, 1, 1, WOOD_DARK);
      B.rect(x + 4, by + bh + 1, 1, 1, WOOD_DARK);
    }
    for (let y = 0; y < b.rows; y++) {
      for (let x = 0; x < b.cols; x++) {
        const i = y * b.cols + x;
        const cx = bx + x * CELL;
        const cy = by + y * CELL;
        B.rect(cx, cy, CELL, CELL, (x + y) % 2 === 0 ? pal.tile : mix(pal.tile, pal.tileDark, 0.3));
        B.rect(cx, cy + CELL - 1, CELL, 1, pal.tileDark);
        B.rect(cx + CELL - 1, cy, 1, CELL, pal.tileDark);
        for (let k = 0; k < 3; k++) {
          const n = noise2(i * 7 + k, seed);
          B.rect(
            cx + 1 + Math.floor(n * 13),
            cy + 1 + Math.floor(noise((n * 1e6) | 0) * 13),
            1,
            1,
            pal.grassDark,
          );
        }
        if (b.cells[i]?.kind !== 'empty') continue;
        // пустая клетка: камень, кочка с цветами или пень — сюда жёлоб не поставить
        const n = noise2(i, seed + 11);
        if (n < 0.4) {
          B.disc(cx + 8, cy + 10, 5, 3, STONE_DARK);
          B.disc(cx + 7, cy + 9, 4, 2, STONE);
          B.rect(cx + 5, cy + 8, 2, 1, pal.snow ? SNOW : STONE_LIGHT);
        } else if (n < 0.75) {
          B.disc(cx + 8, cy + 9, 5, 3, pal.crownDark);
          B.disc(cx + 7, cy + 8, 3, 2, pal.crown);
          const flower = pal.snow
            ? SNOW
            : pal.flowers[Math.floor(n * 10) % Math.max(1, pal.flowers.length)];
          if (flower) {
            B.rect(cx + 6, cy + 7, 1, 1, flower);
            B.rect(cx + 10, cy + 9, 1, 1, flower);
          }
        } else {
          B.rect(cx + 5, cy + 7, 6, 6, WOOD_DARK);
          B.rect(cx + 5, cy + 6, 6, 2, pal.snow ? SNOW : '#C9A26E');
          B.rect(cx + 7, cy + 7, 2, 1, WOOD);
        }
      }
    }
  }

  /* ---------- живое: каждый кадр ---------- */

  function streams(pal: ScenePalette, sc: Scene, t: number, fast: boolean) {
    ctx.fillStyle = pal.waterLight;
    const upper = sc.poolY - 4;
    for (let k = 0; k < Math.floor(upper / 7); k++) {
      const y = (t * 12 + k * 7) % Math.max(1, upper);
      ctx.fillRect(Math.round(upperX(sc, y) - 1 + (k % 2)), Math.round(y), 1, 2);
    }
    const top = lowerTop(sc) + 2;
    const len = (layout?.height ?? 0) - top;
    if (len > 0) {
      for (let k = 0; k < Math.floor(len / 6); k++) {
        const y = top + ((t * (fast ? 26 : 10) + k * 6) % len);
        ctx.fillRect(Math.round(lowerX(sc, y) - 2 + (k % 3)), Math.round(y), 1, 2);
      }
    }
    // пруд родника: блики
    for (let k = 0; k < 3; k++) {
      const a = t * 0.8 + k * 2.1;
      ctx.fillRect(
        Math.round(sc.springX + Math.cos(a) * 4),
        Math.round(sc.poolY + Math.sin(a) * 2),
        2,
        1,
      );
    }
  }

  /** Вода в лотке от пруда к полю — течёт всегда. */
  function spout(pal: ScenePalette, sc: Scene, t: number, board: Board) {
    const top = sc.poolY + 3;
    const h = sc.by - top;
    P.rect(sc.springX - 2, top, 4, h, pal.water);
    ctx.fillStyle = pal.waterLight;
    for (let k = 0; k < 2; k++) {
      const y = top + ((t * 16 + k * 4) % Math.max(1, h));
      ctx.fillRect(sc.springX - 1 + k, Math.round(y), 1, 2);
    }
    // жёлоб под родником закрыт сверху — вода плещет о борт
    if (!(maskOf(cellOf(board, board.source)) & N)) splash(pal, sc.springX, sc.by, t, 0);
  }

  function splash(pal: ScenePalette, x: number, y: number, t: number, seed: number) {
    ctx.fillStyle = pal.waterLight;
    for (let k = 0; k < 4; k++) {
      const p = (t * 2.2 + k / 4 + seed * 0.37) % 1;
      const dx = (k - 1.5) * 2.2 * p * 2;
      const dy = -4 * p + 7 * p * p;
      ctx.fillRect(Math.round(x + dx), Math.round(y - 1 + dy), 1, 1);
    }
  }

  function pieces(s: Session, pal: ScenePalette, sc: Scene, t: number, reduced: boolean) {
    const b = s.play.board;
    for (let i = 0; i < b.cells.length; i++) {
      const cell = cellOf(b, i);
      if (cell.kind === 'empty') continue;
      const x0 = sc.bx + (i % b.cols) * CELL;
      const y0 = sc.by + Math.floor(i / b.cols) * CELL;
      const mask = maskOf(cell);
      const since = t - (s.turnedAt[i] ?? -Infinity);
      if (!reduced && since < TURN_TIME) {
        const p = since / TURN_TIME;
        const eased = 1 - (1 - p) * (1 - p);
        ctx.save();
        ctx.translate(x0 + 8, y0 + 8);
        ctx.rotate(-(s.turnedSpin[i] ?? CW) * (1 - eased) * (Math.PI / 2));
        trough(ctx, -8, -8, mask, false);
        ctx.restore();
        continue;
      }
      trough(ctx, x0, y0, mask, true);
      const wetAt = s.wet[i] ?? Infinity;
      if (t < wetAt) continue;
      const f = Math.min(1, (t - wetAt) / FLOW_CELL);
      water(ctx, x0, y0, mask, s.flow.from[i] ?? N, f, t, pal, i * 3);
    }
  }

  /** Вода мимо: из открытого конца жёлоба капает, внизу — лужица. */
  function leaks(s: Session, pal: ScenePalette, sc: Scene, t: number) {
    const b = s.play.board;
    for (const leak of s.flow.leaks) {
      const wetAt = s.wet[leak.cell] ?? Infinity;
      if (t < wetAt + FLOW_CELL) continue;
      const x0 = sc.bx + (leak.cell % b.cols) * CELL;
      const y0 = sc.by + Math.floor(leak.cell / b.cols) * CELL;
      const [ex, ey] =
        leak.dir === N
          ? [x0 + 8, y0 + 1]
          : leak.dir === S
            ? [x0 + 8, y0 + 15]
            : leak.dir === E
              ? [x0 + 15, y0 + 8]
              : [x0 + 1, y0 + 8];
      P.disc(ex, ey + 6, 3, 1, pal.waterDeep);
      ctx.fillStyle = pal.waterLight;
      for (let k = 0; k < 2; k++) {
        const p = (t * 2.4 + k / 2 + leak.cell * 0.31) % 1;
        ctx.fillRect(Math.round(ex - 1 + k), Math.round(ey + p * 5), 1, 2);
      }
    }
  }

  function mill(s: Session, pal: ScenePalette, sc: Scene, t: number, reduced: boolean) {
    const top = sc.by + sc.bh;
    const end = sc.wheelY - WHEEL_R;
    const at = s.wheelAt;
    const spinning = at !== null && t >= at;
    // вода в лотке к колесу
    if (at !== null && t >= at - FLOW_CELL) {
      const f = Math.min(1, (t - (at - FLOW_CELL)) / FLOW_CELL);
      P.rect(sc.wheelX - 2, top, 4, (end - top) * f, pal.water);
    }
    // колесо: обод, спицы, лопасти
    const run = spinning ? t - at : 0;
    const speed = reduced ? 1.2 : 2.4;
    const angle = spinning ? speed * (run - 0.5 * (1 - Math.exp(-run / 0.5))) : 0;
    const { wheelX: x, wheelY: y } = sc;
    for (let k = 0; k < 4; k++) {
      const a = angle + (k * Math.PI) / 4;
      P.line(
        x - Math.cos(a) * (WHEEL_R - 2),
        y - Math.sin(a) * (WHEEL_R - 2),
        x + Math.cos(a) * (WHEEL_R - 2),
        y + Math.sin(a) * (WHEEL_R - 2),
        WOOD,
      );
    }
    ring(x, y, WHEEL_R - 1, WOOD_DEEP);
    ring(x, y, WHEEL_R - 2, WOOD_DARK);
    for (let k = 0; k < 8; k++) {
      const a = angle + (k * Math.PI) / 4 + Math.PI / 8;
      const px = x + Math.cos(a) * WHEEL_R;
      const py = y + Math.sin(a) * WHEEL_R;
      P.rect(px - 2, py - 2, 4, 4, WOOD_DEEP);
      P.rect(px - 1, py - 1, 2, 2, WOOD_LIGHT);
      if (spinning && Math.cos(a) > 0.1 && Math.sin(a) > -0.7)
        P.rect(px - 1, py - 1, 2, 1, pal.waterLight);
    }
    P.rect(x - 1, y - 1, 3, 3, WOOD_DEEP);
    if (!spinning) return;
    // брызги под колесом и мука из двери
    splash(pal, x + 3, y + WHEEL_R + 1, t, 1);
    splash(pal, x - 2, y + WHEEL_R, t + 0.4, 2);
    const doorX = sc.houseRight ? sc.houseX + HOUSE_W - 8 : sc.houseX + 8;
    const doorY = sc.houseY + HOUSE_H - 8;
    for (let k = 0; k < (reduced ? 2 : 5); k++) {
      const p = (run * 0.5 + k / 5) % 1;
      ctx.fillStyle = `rgba(255, 252, 240, ${(0.85 * (1 - p)).toFixed(2)})`;
      const size = 1 + Math.floor(p * 2);
      ctx.fillRect(
        Math.round(doorX + (noise(k) - 0.5) * 6 + p * 4),
        Math.round(doorY - p * 10),
        size,
        size,
      );
    }
    const winX = sc.houseRight ? sc.houseX + 7 : sc.houseX + HOUSE_W - 13;
    P.rect(winX + 1, sc.houseY + 13, 4, 3, WINDOW_LIT);
  }

  /** Окружность в один пиксель толщиной. */
  function ring(cx: number, cy: number, r: number, color: string) {
    ctx.fillStyle = color;
    let x = r;
    let y = 0;
    let err = 1 - r;
    while (x >= y) {
      for (const [px, py] of [
        [x, y],
        [y, x],
        [-y, x],
        [-x, y],
        [-x, -y],
        [-y, -x],
        [y, -x],
        [x, -y],
      ] as const) {
        ctx.fillRect(Math.round(cx + px), Math.round(cy + py), 1, 1);
      }
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  /** Подсказка: медовая заливка и рамка по всей клетке, стрелка на тёмной планке — куда крутить. */
  function hintAt(sc: Scene, cols: number, hint: HintMove, t: number, reduced: boolean) {
    const x = sc.bx + (hint.cell % cols) * CELL;
    const y = sc.by + Math.floor(hint.cell / cols) * CELL;
    const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 5);
    ctx.globalAlpha = 0.3 * pulse;
    P.rect(x, y, CELL - 1, CELL - 1, CURSOR);
    ctx.globalAlpha = pulse;
    for (const [color, off, side] of [
      [WOOD_DEEP, 1, CELL - 3],
      [CURSOR, 0, CELL - 1],
    ] as const) {
      P.rect(x + off, y + off, side, 1, color);
      P.rect(x + off, y + off + side - 1, side, 1, color);
      P.rect(x + off, y + off, 1, side, color);
      P.rect(x + off + side - 1, y + off, 1, side, color);
    }
    // Верхняя кромка жёлоба при повороте по часовой уходит вправо: туда и смотрит стрелка.
    const mid = x + Math.floor((CELL - 1) / 2);
    const dir = hint.spin === CW ? 1 : -1;
    ctx.globalAlpha = 1;
    P.rect(mid - 5, y + 2, 11, 5, WOOD_DEEP);
    P.rect(mid - 3, y + 4, 7, 1, CURSOR);
    P.rect(mid + 2 * dir, y + 3, 1, 3, CURSOR);
  }

  /** Курсор клавиатуры: медовые уголки с тенью. */
  function cursorAt(sc: Scene, cols: number, cell: number, t: number, reduced: boolean) {
    const x0 = sc.bx + (cell % cols) * CELL;
    const y0 = sc.by + Math.floor(cell / cols) * CELL;
    const x1 = x0 + CELL - 1;
    const y1 = y0 + CELL - 1;
    ctx.globalAlpha = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 6);
    for (const [color, off] of [
      [WOOD_DEEP, 1],
      [CURSOR, 0],
    ] as const) {
      for (const [cx, cy, dx, dy] of [
        [x0, y0, 1, 1],
        [x1, y0, -1, 1],
        [x0, y1, 1, -1],
        [x1, y1, -1, -1],
      ] as const) {
        P.rect((dx > 0 ? cx : cx - 4) + off, cy + off, 5, 1, color);
        P.rect(cx + off, (dy > 0 ? cy : cy - 4) + off, 1, 5, color);
      }
    }
    ctx.globalAlpha = 1;
  }

  function weather(pal: ScenePalette, season: Session['season'], t: number, reduced: boolean) {
    const L = layout;
    if (!L) return;
    const n = Math.round(
      ((L.width * L.height) / 1600) * (reduced ? 0.3 : season === 'summer' ? 0.5 : 1),
    );
    for (let i = 0; i < n; i++) {
      const fall =
        season === 'winter'
          ? 9 + noise(i) * 10
          : season === 'summer'
            ? 3 + noise(i) * 3
            : 6 + noise(i) * 6;
      const drift = 4 + noise(i + 50) * 8;
      const x = (((noise(i + 100) * L.width * 1.5 - t * drift) % L.width) + L.width) % L.width;
      const y = (noise(i + 200) * L.height + t * fall) % L.height;
      const sway = Math.sin(t * 1.3 + i) * 3;
      const color = pal.particles[i % pal.particles.length] ?? '#FFFFFF';
      const big = season === 'autumn' || (season === 'spring' && i % 2 === 0);
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.round(x + sway),
        Math.round(y),
        big ? 2 : 1,
        big && Math.floor(t * 4 + i) % 2 === 0 ? 2 : 1,
      );
    }
  }

  return {
    get layout() {
      return layout;
    },
    setLayout(next: Layout) {
      layout = next;
      canvas.width = next.width;
      canvas.height = next.height;
      canvas.style.width = `${next.width * next.scale}px`;
      canvas.style.height = `${next.height * next.scale}px`;
      ctx.imageSmoothingEnabled = false;
      backKey = '';
    },
    draw(frame: Frame, hover: number | null) {
      const L = layout;
      if (!L) return;
      const s = frame.session;
      const b = s.play.board;
      if (L.cols !== b.cols || L.rows !== b.rows) return;
      const pal = PALETTES[s.season];
      const reduced = opts.reducedMotion();
      const empties = b.cells.map((c) => (c.kind === 'empty' ? 1 : 0)).join('');
      const key = [
        L.width,
        L.height,
        L.boardX,
        L.boardY,
        b.source,
        b.mill,
        s.season,
        s.generated.seed,
        empties,
      ].join();
      if (key !== backKey) {
        buildBack(L, s);
        backKey = key;
      }
      const sc = sceneOf(L, b);
      const t = frame.time;
      ctx.drawImage(back, 0, 0);
      streams(pal, sc, t, s.wheelAt !== null && t >= s.wheelAt);
      spout(pal, sc, t, b);
      pieces(s, pal, sc, t, reduced);
      leaks(s, pal, sc, t);
      mill(s, pal, sc, t, reduced);
      if (hover !== null && b.cells[hover]?.kind !== 'empty' && !s.play.solved) {
        // под мышью — светлая рамка по краю клетки
        const hx = sc.bx + (hover % b.cols) * CELL + 1;
        const hy = sc.by + Math.floor(hover / b.cols) * CELL + 1;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillRect(hx, hy, CELL - 3, 1);
        ctx.fillRect(hx, hy + CELL - 4, CELL - 3, 1);
        ctx.fillRect(hx, hy + 1, 1, CELL - 5);
        ctx.fillRect(hx + CELL - 4, hy + 1, 1, CELL - 5);
      }
      if (s.hint) hintAt(sc, b.cols, s.hint, t, reduced);
      if (frame.cursor !== null) cursorAt(sc, b.cols, frame.cursor, t, reduced);
      weather(pal, s.season, t, reduced);
    },
  };
}

export type Renderer = ReturnType<typeof createRenderer>;

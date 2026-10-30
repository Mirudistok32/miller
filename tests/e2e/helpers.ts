import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Page } from '@playwright/test';

export const SAVE_KEY = 'miller:save';
export const CORRUPT_KEY = 'miller:save-corrupt';
export const URL = pathToFileURL(resolve('dist/index.html')).href;
/** Тесты живут 30 октября 2026 года, в полдень по местному времени. */
export const TODAY = '2026-10-30';

/** Собирает ошибки консоли и страницы — в конце теста их должно быть ноль. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Открывает игру с диска с управляемыми часами: время крутим сами через page.clock. */
export async function open(page: Page, query = '') {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.goto(URL + query);
  await page.clock.runFor(200);
}

export async function seed(page: Page, value: string) {
  await page.addInitScript(
    ([key, v]) => {
      if (!localStorage.getItem(key as string)) localStorage.setItem(key as string, v as string);
    },
    [SAVE_KEY, value],
  );
}

export const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_KEY);

/**
 * Состояние поля из data-атрибутов сцены: геометрия в CSS-пикселях, повороты, ходы. Вид
 * обновляет их на кадре анимации, поэтому сначала прокручиваем один кадр.
 */
export async function board(page: Page) {
  await page.clock.runFor(20);
  const d = await page.locator('#stage').evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  return {
    cols: Number(d.cols),
    rows: Number(d.rows),
    cell: Number(d.cell),
    left: Number(d.left),
    top: Number(d.top),
    rots: d.rots ?? '',
    moves: Number(d.moves),
    cursor: Number(d.cursor),
  };
}

/** Центр клетки в координатах страницы: холст лежит в левом верхнем углу окна. */
export async function cellPoint(page: Page, index: number) {
  const b = await board(page);
  return {
    x: b.left + ((index % b.cols) + 0.5) * b.cell,
    y: b.top + (Math.floor(index / b.cols) + 0.5) * b.cell,
  };
}

export async function clickCell(page: Page, index: number, times = 1) {
  const { x, y } = await cellPoint(page, index);
  for (let i = 0; i < times; i++) {
    await page.mouse.click(x, y);
    await page.clock.runFor(30);
  }
}

/** Держать палец через CDP: у page.touchscreen есть только тап. */
export async function finger(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    touchPoints: { x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    down: () => send('touchStart', [{ x, y }]),
    move: (dx: number, dy: number) => send('touchMove', [{ x: x + dx, y: y + dy }]),
    up: () => send('touchEnd', []),
    cancel: () => send('touchCancel', []),
  };
}

/** Сыграть решение кликами: левая кнопка — по часовой, правая — против; как велит решатель. */
export async function playTurns(page: Page, turns: readonly number[]) {
  for (const [cell, t] of turns.entries()) {
    if (t > 0) await clickCell(page, cell, t);
    if (t < 0) {
      const { x, y } = await cellPoint(page, cell);
      await page.mouse.click(x, y, { button: 'right' });
      await page.clock.runFor(30);
    }
  }
}

import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { generateLevel } from '../../src/domain/generator';
import { rotsOf } from '../../src/domain/grid';
import { dailyLevel, endlessLevel, endlessParams } from '../../src/domain/levels';
import {
  board,
  cellPoint,
  clickCell,
  CORRUPT_KEY,
  finger,
  open,
  playTurns,
  SAVE_KEY,
  seed,
  stored,
  TODAY,
  trackErrors,
} from './helpers';

/** Первая непустая клетка пути решения — её точно можно повернуть. */
const firstPathCell = (level: ReturnType<typeof dailyLevel>) => level.solution.path[0] ?? 0;

test('открывается с диска: меню, шрифты встроены, без ошибок и внешних запросов', async ({
  page,
}) => {
  const errors = trackErrors(page);
  const external: string[] = [];
  page.on('request', (r) => !/^(file|data|blob):/.test(r.url()) && external.push(r.url()));
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Мельник' })).toBeVisible();
  await expect(page.locator('#daily-note')).toContainText('30 октября');
  expect(await page.evaluate(() => document.fonts.check('16px Tektur'))).toBe(true);
  // демо в меню решается само и не ломается
  await page.clock.runFor(15_000);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('мышь: клик по жёлобу поворачивает его и считает ход, по камню — нет', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await expect(page.locator('#hint')).toBeVisible();
  const level = dailyLevel(TODAY);
  const cell = firstPathCell(level);
  const before = await board(page);
  await clickCell(page, cell);
  const after = await board(page);
  expect(after.moves).toBe(1);
  expect(Number(after.rots[cell])).toBe((Number(before.rots[cell]) + 1) % 4);
  await expect(page.locator('#hud-moves')).toHaveText('1');
  await expect(page.locator('#hint')).toBeHidden();

  const empty = level.board.cells.findIndex((c) => c.kind === 'empty');
  await clickCell(page, empty);
  expect((await board(page)).moves).toBe(1);
  // часы идут с первого хода
  await page.clock.runFor(3_000);
  await expect(page.locator('#hud-time')).toHaveText('0:03');
  expect(errors).toEqual([]);
});

test('мышь: правая кнопка поворачивает против часовой, меню браузера не открывается', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await page.evaluate(() => {
    const w = window as unknown as { menus: boolean[] };
    w.menus = [];
    window.addEventListener('contextmenu', (e) => w.menus.push(e.defaultPrevented));
  });
  const cell = firstPathCell(dailyLevel(TODAY));
  const before = await board(page);
  const { x, y } = await cellPoint(page, cell);
  await page.mouse.click(x, y, { button: 'right' });
  await page.clock.runFor(30);
  const after = await board(page);
  expect(after.moves).toBe(1);
  expect(Number(after.rots[cell])).toBe((Number(before.rots[cell]) + 3) % 4);
  // левая возвращает обратно: тот же жёлоб, второй ход
  await clickCell(page, cell);
  const back = await board(page);
  expect(back.moves).toBe(2);
  expect(back.rots[cell]).toBe(before.rots[cell]);
  const menus = await page.evaluate(() => (window as unknown as { menus: boolean[] }).menus);
  expect(menus.length).toBeGreaterThan(0);
  expect(menus.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

test('отмена мышью и клавиатурой: поле назад, ход и часы остаются', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const undo = page.locator('#hud-undo');
  await expect(undo).toBeDisabled();
  const cell = firstPathCell(dailyLevel(TODAY));
  const before = await board(page);
  await clickCell(page, cell);
  await page.clock.runFor(2_000);
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.clock.runFor(30);
  const undone = await board(page);
  expect(undone.rots).toBe(before.rots);
  expect(undone.moves).toBe(1);
  await expect(page.locator('#hud-time')).not.toHaveText('0:00');
  await expect(undo).toBeDisabled();

  // Z и Ctrl+Z — два хода назад, третий раз отменять нечего
  await clickCell(page, cell);
  await clickCell(page, cell);
  await page.keyboard.press('z');
  await page.clock.runFor(30);
  await page.keyboard.press('Control+z');
  await page.clock.runFor(30);
  await page.keyboard.press('z');
  await page.clock.runFor(30);
  const keys = await board(page);
  expect(keys.rots).toBe(before.rots);
  expect(keys.moves).toBe(3);
  expect(errors).toEqual([]);
});

test('подсказка кнопкой и клавишей H: подсветка, цена в тексте результата', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const level = dailyLevel(TODAY);
  const hinted = () => page.locator('#stage').getAttribute('data-hint');
  await page.clock.runFor(30);
  expect(await hinted()).toBe('-1');
  const before = await board(page);
  await page.locator('#hud-hint').click();
  await page.clock.runFor(30);
  const shown = Number(await hinted());
  expect(level.solution.path).toContain(shown);
  expect((await board(page)).rots).toBe(before.rots);
  expect((await board(page)).moves).toBe(0);
  await expect(page.locator('#announcer')).toContainText('Подсказка');
  await expect(page.locator('.toast').last()).toContainText('Поверните подсвеченный жёлоб');
  await playTurns(page, level.solution.turns);
  await page.clock.runFor(6_000);
  await expect(page.locator('#screen-solved')).toBeVisible();
  await expect(page.locator('#solved-stats')).toContainText('Подсказки');
  const saved = await stored(page);
  expect(saved.daily[TODAY].hints).toBe(1);
  expect(saved.stats.perfect).toBe(0);
  await page.locator('#btn-copy').click();
  await page.clock.runFor(100);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('💡 1');
  expect(text).toContain('💧💧 ');
  expect(text).not.toContain('💧💧💧');
  expect(errors).toEqual([]);
});

test('H на клавиатуре: подсказка и курсор на подсвеченной клетке', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await page.clock.runFor(30);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('h');
  await page.clock.runFor(30);
  const stage = page.locator('#stage');
  const cell = await stage.getAttribute('data-hint');
  expect(Number(cell)).toBeGreaterThanOrEqual(0);
  expect(await stage.getAttribute('data-cursor')).toBe(cell);
  await page.keyboard.press('h');
  await page.clock.runFor(30);
  expect((await stored(page)).progress.daily.hints).toBe(1);
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [844, 390],
  [1280, 720],
] as const) {
  test(`шапка ${width}×${height}: кнопки целы и не перекрыты плашкой`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await page.getByRole('button', { name: /Уровень дня/ }).click();
    await page.clock.runFor(30);
    await expect(page.locator('#hint')).toBeVisible();
    const plate = await page.locator('#hint').boundingBox();
    const boxes = await page.locator('.hud .icon-btn').evaluateAll((all) =>
      all.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width };
      }),
    );
    expect(boxes).toHaveLength(5);
    for (const b of boxes) {
      expect(b.w).toBeGreaterThanOrEqual(44);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(width);
      if (plate) expect(b.bottom).toBeLessThanOrEqual(plate.y);
    }
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(width);
  });
}

test('все уровни из сценария живой проверки открываются из свежей сборки', async ({ page }) => {
  const errors = trackErrors(page);
  const plan = readFileSync('docs/playtest.md', 'utf8');
  const links = [...plan.matchAll(/`(\?seed=(\d+)&level=(\d+))`/g)];
  expect(links.length).toBeGreaterThanOrEqual(4);
  for (const [, query, seedText, levelText] of links) {
    await open(page, query);
    const level = generateLevel(Number(seedText), endlessParams(Number(levelText)));
    const b = await board(page);
    expect(b.cols, query).toBe(level.params.cols);
    expect(b.rots, query).toBe(rotsOf(level.board));
    await expect(page.locator('#hud-title'), query).toContainText(`сид ${seedText}`);
  }
  expect(errors).toEqual([]);
});

test('отмена не возвращается после перезагрузки', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await clickCell(page, firstPathCell(dailyLevel(TODAY)));
  await page.reload();
  await page.clock.runFor(200);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await page.clock.runFor(30);
  expect((await board(page)).moves).toBe(1);
  await expect(page.locator('#hud-undo')).toBeDisabled();
});

test.describe('палец', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('подсказка тапом', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /Уровень дня/ }).tap();
    await page.locator('#hud-hint').tap();
    await page.clock.runFor(30);
    const cell = await page.locator('#stage').getAttribute('data-hint');
    expect(Number(cell)).toBeGreaterThanOrEqual(0);
    const hud = await page.locator('#hud-hint').boundingBox();
    expect(hud?.width).toBeGreaterThanOrEqual(44);
    // тост внизу и одной плашкой: шапку и поле он не закрывает
    const toast = await page.locator('.toast').last().boundingBox();
    expect(toast?.height).toBeLessThan(80);
    expect(toast?.y).toBeGreaterThan(600);
  });

  test('отмена тапом; кнопки помещаются на 390 px без прокрутки вбок', async ({ page }) => {
    const errors = trackErrors(page);
    await open(page);
    await page.getByRole('button', { name: /Уровень дня/ }).tap();
    const cell = firstPathCell(dailyLevel(TODAY));
    const before = await board(page);
    const { x, y } = await cellPoint(page, cell);
    await page.touchscreen.tap(x, y);
    await page.clock.runFor(30);
    expect((await board(page)).moves).toBe(1);
    const undo = page.locator('#hud-undo');
    await undo.tap();
    await page.clock.runFor(30);
    const after = await board(page);
    expect(after.rots).toBe(before.rots);
    expect(after.moves).toBe(1);
    const box = await undo.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });

  test('тап по жёлобу поворачивает его; страница не прокручивается вбок', async ({ page }) => {
    const errors = trackErrors(page);
    await open(page);
    await page.getByRole('button', { name: /Уровень дня/ }).tap();
    const cell = firstPathCell(dailyLevel(TODAY));
    const before = await board(page);
    const { x, y } = await cellPoint(page, cell);
    await page.touchscreen.tap(x, y);
    await page.clock.runFor(100);
    const after = await board(page);
    expect(after.moves).toBe(1);
    expect(Number(after.rots[cell])).toBe((Number(before.rots[cell]) + 1) % 4);
    expect(after.cell).toBeGreaterThanOrEqual(44);
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(scroll).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

test.describe('долгое нажатие', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  const start = async (page: Page) => {
    await open(page);
    await page.getByRole('button', { name: /Уровень дня/ }).tap();
    const cell = firstPathCell(dailyLevel(TODAY));
    const { x, y } = await cellPoint(page, cell);
    return { cell, before: await board(page), touch: await finger(page, x, y) };
  };

  test('поворачивает против часовой один раз: отпускание не добавляет короткий поворот', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const { cell, before, touch } = await start(page);
    await page.evaluate(() => {
      const w = window as unknown as { menus: boolean[] };
      w.menus = [];
      window.addEventListener('contextmenu', (e) => w.menus.push(e.defaultPrevented));
    });
    await touch.down();
    await page.clock.runFor(300);
    expect((await board(page)).moves).toBe(0);
    await page.clock.runFor(200);
    const held = await board(page);
    expect(held.moves).toBe(1);
    expect(Number(held.rots[cell])).toBe((Number(before.rots[cell]) + 3) % 4);
    // настоящее долгое нажатие браузера: жест распознаётся по его часам, не по page.clock
    await new Promise((r) => setTimeout(r, 900));
    await page.clock.runFor(1_000);
    await touch.up();
    await page.clock.runFor(100);
    const after = await board(page);
    expect(after.moves).toBe(1);
    expect(after.rots).toBe(held.rots);
    const state = await page.evaluate(() => ({
      menus: (window as unknown as { menus: boolean[] }).menus,
      selected: getSelection()?.toString() ?? '',
      select: getComputedStyle(document.querySelector('.app') as Element).userSelect,
    }));
    expect(state.menus.every(Boolean)).toBe(true);
    expect(state.selected).toBe('');
    expect(state.select).toBe('none');
    expect(errors).toEqual([]);
  });

  test('короткое нажатие — по часовой и только при отпускании', async ({ page }) => {
    const { cell, before, touch } = await start(page);
    await touch.down();
    await page.clock.runFor(150);
    expect((await board(page)).moves).toBe(0);
    await touch.up();
    await page.clock.runFor(1_000);
    const after = await board(page);
    expect(after.moves).toBe(1);
    expect(Number(after.rots[cell])).toBe((Number(before.rots[cell]) + 1) % 4);
  });

  test('палец съехал или касание сорвалось — поворота нет', async ({ page }) => {
    const { touch } = await start(page);
    await touch.down();
    await touch.move(30, 0);
    await page.clock.runFor(1_000);
    await touch.up();
    await page.clock.runFor(100);
    expect((await board(page)).moves).toBe(0);
    await touch.down();
    await touch.cancel();
    await page.clock.runFor(1_000);
    expect((await board(page)).moves).toBe(0);
  });
});

test('клавиатура: стрелки ведут курсор, Enter поворачивает жёлоб под ним', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const level = dailyLevel(TODAY);
  const start = await board(page);
  expect(start.cursor).toBe(-1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  // родник может стоять в левом столбце: тогда курсор упирается в край
  const col = Math.max(0, level.board.source - 1);
  const at = level.board.cols + col;
  expect((await board(page)).cursor).toBe(at);
  await expect(page.locator('#announcer')).toContainText('Ряд 2');
  await page.keyboard.press('Enter');
  const after = await board(page);
  if (level.board.cells[at]?.kind === 'empty') {
    expect(after.moves).toBe(0);
  } else {
    expect(after.moves).toBe(1);
    expect(Number(after.rots[at])).toBe((Number(start.rots[at]) + 1) % 4);
  }
  // Shift+Enter — обратно, это ещё один ход
  await page.keyboard.press('Shift+Enter');
  const reverted = await board(page);
  expect(reverted.rots).toBe(start.rots);
  expect(reverted.moves).toBe(level.board.cells[at]?.kind === 'empty' ? 0 : 2);
  // упираемся в край — курсор остаётся на поле
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  expect((await board(page)).cursor).toBe(col);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Пауза' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Пауза' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('тестовый сид: уровень решается кликами, вода доходит до колеса, итог', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, '?seed=12345&level=6');
  const level = generateLevel(12345, endlessParams(6));
  await expect(page.locator('#hud-title')).toContainText('сид 12345');
  expect((await board(page)).rots).toBe(level.board.cells.map((c) => c.rot).join(''));
  await playTurns(page, level.solution.turns);
  expect((await board(page)).moves).toBe(level.solution.moves);
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeHidden();
  await page.clock.runFor(4_000);
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeVisible();
  await expect(page.locator('#solved-stats')).toContainText(
    `${level.solution.moves} — это минимум`,
  );
  // тестовый уровень не пишется в рекорды
  expect(await stored(page)).toBeNull();
  await page.getByRole('button', { name: 'Ещё раз' }).click();
  expect((await board(page)).moves).toBe(0);
  expect(errors).toEqual([]);
});

test('рестарт: жёлоба возвращаются на места, ходы и время с нуля', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const level = dailyLevel(TODAY);
  const start = await board(page);
  await clickCell(page, level.solution.path[0] ?? 0);
  await clickCell(page, level.solution.path[1] ?? 0, 2);
  await page.clock.runFor(2_000);
  expect((await board(page)).moves).toBe(3);
  await page.getByRole('button', { name: 'Начать уровень заново' }).click();
  const after = await board(page);
  expect(after.moves).toBe(0);
  expect(after.rots).toBe(start.rots);
  await expect(page.locator('#hud-time')).toHaveText('0:00');
  // и из паузы
  await clickCell(page, level.solution.path[0] ?? 0);
  await page.keyboard.press('Escape');
  await page
    .locator('#screen-paused')
    .getByRole('button', { name: 'Начать уровень заново' })
    .click();
  expect((await board(page)).moves).toBe(0);
  expect((await stored(page)).progress.daily.attempts).toBe(3);
});

test('недоигранный уровень и настройки переживают перезагрузку', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const level = dailyLevel(TODAY);
  await clickCell(page, level.solution.path[0] ?? 0);
  await clickCell(page, level.solution.path[1] ?? 0);
  await page.clock.runFor(5_000);
  const before = await board(page);
  await page.getByRole('button', { name: /Звук/ }).click();
  await page.getByRole('button', { name: 'Пауза (Esc)' }).click();
  await page.getByRole('button', { name: 'В меню' }).click();

  await page.reload();
  await page.clock.runFor(200);
  await expect(page.locator('#daily-note')).toContainText('начат');
  await expect(page.getByRole('button', { name: 'Звук: выключен' })).toBeVisible();
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const after = await board(page);
  expect(after.rots).toBe(before.rots);
  expect(after.moves).toBe(2);
  await expect(page.locator('#hud-time')).toHaveText('0:05');
});

test('уровень дня: решить, скопировать результат; после перезагрузки он решён', async ({
  page,
  context,
}) => {
  const errors = trackErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  const level = dailyLevel(TODAY);
  await playTurns(page, level.solution.turns);
  await page.clock.runFor(4_000);
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeVisible();
  await expect(page.locator('#solved-unlocked')).toContainText('Хлеб насущный');

  await page.getByRole('button', { name: 'Скопировать результат' }).click();
  await expect(page.getByText('Результат скопирован')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Мельник · уровень дня 30.10.2026');
  expect(text).toContain(`${level.solution.moves} ходов (минимум ${level.solution.moves})`);
  expect(text).toContain('💧💧💧');
  expect(text).toContain('https://mirudistok32.github.io/miller/');
  // решение в тексте не выдаётся: ни поворотов, ни рисунка поля
  expect(text.split('\n')).toHaveLength(3);

  const saved = await stored(page);
  expect(saved.daily[TODAY].moves).toBe(level.solution.moves);
  expect(saved.achievements).toHaveProperty('perfect');

  await page.reload();
  await page.clock.runFor(200);
  await expect(page.locator('#daily-note')).toContainText('решён');
  await expect(page.locator('#ach-count')).toHaveText(/[1-9]\d? из 11/);
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeVisible();
  await expect(page.locator('#solved-note')).toContainText('завтра');
  expect(errors).toEqual([]);
});

test('бесконечный режим: решил уровень — следующий, рекорд поля записан', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Бесконечный/ }).click();
  await expect(page.locator('#hud-title')).toHaveText('Уровень 1 · поле 3×3');
  await playTurns(page, endlessLevel(1).solution.turns);
  await page.clock.runFor(4_000);
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeVisible();
  await expect(page.locator('#solved-record')).toBeVisible();
  await page.getByRole('button', { name: 'Следующий уровень' }).click();
  await expect(page.locator('#hud-title')).toHaveText('Уровень 2 · поле 3×3');
  const saved = await stored(page);
  expect(saved.endless.level).toBe(2);
  expect(saved.best['3x3'].extra).toBe(0);
});

test('сохранение с прошлой версии сида: итог дня и номер уровня на месте, недоигранное забыто', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seed(
    page,
    JSON.stringify({
      schemaVersion: 1,
      daily: { [TODAY]: { moves: 21, min: 17, time: 83.6, attempts: 1, rots: '0'.repeat(42) } },
      endless: { level: 12 },
      progress: {
        endless: {
          key: 'endless:v2:12',
          rots: '0'.repeat(42),
          moves: 5,
          time: 12.4,
          started: true,
          attempts: 1,
        },
      },
    }),
  );
  await open(page);
  await expect(page.locator('#daily-note')).toContainText('решён: 21');
  await expect(page.locator('#endless-note')).toHaveText('Уровень 12 · поле 4×5');
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeVisible();
  await page.getByRole('button', { name: 'В меню' }).last().click();
  await page.getByRole('button', { name: /Бесконечный/ }).click();
  await expect(page.locator('#hud-title')).toHaveText('Уровень 12 · поле 4×5');
  await expect(page.locator('#hud-moves')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('недоигранный уровень дня с прошлой версии сида: меню не обещает продолжение', async ({
  page,
}) => {
  await seed(
    page,
    JSON.stringify({
      schemaVersion: 1,
      progress: {
        daily: {
          key: `daily:v2:${TODAY}`,
          rots: '0'.repeat(42),
          moves: 5,
          time: 12.4,
          started: true,
          attempts: 1,
        },
      },
    }),
  );
  await open(page);
  await expect(page.locator('#daily-note')).not.toContainText('начат');
  await page.getByRole('button', { name: /Уровень дня/ }).click();
  await expect(page.locator('#hud-moves')).toHaveText('0');
});

test('повреждённое сохранение: игра начинается заново, старые данные отложены', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seed(page, '{"schemaVersion":1,"daily":{"вчера":');
  await open(page);
  await expect(page.locator('#save-notice')).toContainText('не прочиталось');
  expect(await page.evaluate((key) => localStorage.getItem(key), CORRUPT_KEY)).toBe(
    '{"schemaVersion":1,"daily":{"вчера":',
  );
  await page.getByRole('button', { name: /Бесконечный/ }).click();
  await clickCell(page, endlessLevel(1).solution.path[0] ?? 0);
  expect((await stored(page)).progress.endless.moves).toBe(1);
  expect(errors).toEqual([]);
});

test('без localStorage игра всё равно играется и честно предупреждает', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await open(page);
  await expect(page.locator('#save-notice')).toContainText('не даёт сохранять');
  await page.getByRole('button', { name: /Бесконечный/ }).click();
  await clickCell(page, endlessLevel(1).solution.path[0] ?? 0);
  expect((await board(page)).moves).toBe(1);
  expect(errors).toEqual([]);
});

test('резервная копия: скачать, испорченный файл не подходит, своя копия загружается', async ({
  page,
}) => {
  await seed(
    page,
    JSON.stringify({
      schemaVersion: 1,
      endless: { level: 6 },
      best: { '5x5': { time: 41.5, extra: 2 } },
      achievements: {
        'first-mill': '2026-10-29T10:00:00.000Z',
        perfect: '2026-10-29T10:00:00.000Z',
      },
      stats: { solved: 5, perfect: 1, dry: 0, seasons: ['spring'], bestStreak: 0 },
    }),
  );
  await open(page);
  await page.getByRole('button', { name: /Ачивки/ }).click();
  await expect(page.locator('.ach.open')).toHaveCount(2);
  await expect(page.locator('#records')).toContainText('0:41');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать копию' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^miller-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const text = readFileSync(await file.path(), 'utf8');
  expect(JSON.parse(text).data.endless.level).toBe(6);

  await page.locator('#import-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"mil'),
  });
  await expect(page.getByText('Файл «broken.json» не подошёл')).toBeVisible();

  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  const fresh = await page.context().newPage();
  await open(fresh);
  await fresh.getByRole('button', { name: /Ачивки/ }).click();
  await expect(fresh.locator('.ach.open')).toHaveCount(0);
  await fresh.locator('#import-file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(fresh.getByText(/Копия «backup.json» загружена/)).toBeVisible();
  await expect(fresh.locator('.ach.open')).toHaveCount(2);
  expect((await stored(fresh)).endless.level).toBe(6);
});

test('автопилот (?autoplay) решает уровень сам и ничего не записывает', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, '?autoplay');
  await page.getByRole('button', { name: /Бесконечный/ }).click();
  const moves = endlessLevel(1).solution.moves;
  await page.clock.runFor(moves * 400 + 4_000);
  await expect(page.getByRole('heading', { name: 'Колесо закрутилось!' })).toBeVisible();
  await expect(page.locator('#solved-mode')).toContainText('решал автопилот');
  expect(await stored(page)).toBeNull();
  expect(errors).toEqual([]);
});

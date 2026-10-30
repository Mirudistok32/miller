// Снимки собранной игры (dist/index.html по file://) в .screenshots/: экраны × 1280×720,
// 390×844, 844×390 × тёмная/светлая, плюс времена года и большое поле. Заодно — ошибки
// консоли и прокрутка вбок. Запуск после `npm run build`: `npm run shots [фильтр]`.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const OUT = resolve('.screenshots');
const URL = pathToFileURL(resolve('dist/index.html')).href;
const TODAY = '2026-10-30';
const filter = process.argv[2] ?? '';

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 720, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '844x390', width: 844, height: 390, mobile: true },
];

/** Сыгранное сохранение: ачивки, рекорды, решённый сегодня уровень дня. */
const PLAYED = {
  schemaVersion: 1,
  sound: true,
  theme: 'system',
  daily: {
    '2026-10-28': { moves: 22, min: 17, time: 131.4, attempts: 1, rots: '0' },
    '2026-10-29': { moves: 19, min: 19, time: 88.2, attempts: 1, rots: '0' },
    [TODAY]: { moves: 21, min: 17, time: 83.6, attempts: 2, rots: '0' },
  },
  endless: { level: 12 },
  best: {
    daily: { time: 83.6, extra: 0 },
    '4x4': { time: 9.1, extra: 0 },
    '5x5': { time: 24.8, extra: 1 },
    '6x6': { time: 51.2, extra: 3 },
  },
  progress: {},
  achievements: {
    'first-mill': '2026-10-28T10:00:00.000Z',
    daily: '2026-10-28T10:00:00.000Z',
    'streak-3': '2026-10-30T10:00:00.000Z',
    perfect: '2026-10-29T10:00:00.000Z',
    'level-10': '2026-10-30T09:00:00.000Z',
  },
  stats: { solved: 14, perfect: 3, dry: 0, seasons: ['spring', 'summer', 'autumn'], bestStreak: 3 },
};

const menuButton = (page, name) => page.getByRole('button', { name }).first();

/** Состояния: имя → как до него дойти. */
const STATES = {
  menu: async () => {},
  help: (page) => menuButton(page, 'Как играть').click(),
  achievements: (page) => menuButton(page, /Ачивки/).click(),
  playing: (page) => menuButton(page, /Уровень дня/).click(),
  moves: async (page) => {
    await menuButton(page, /Уровень дня/).click();
    const d = await page.locator('#stage').evaluate((el) => ({ ...el.dataset }));
    // первые клетки верхнего ряда — вода побежит, если повезёт с поворотом
    for (let i = 0; i < Number(d.cols); i++) {
      const x = Number(d.left) + (i + 0.5) * Number(d.cell);
      const y = Number(d.top) + 0.5 * Number(d.cell);
      await page.mouse.click(x, y);
      await page.clock.runFor(150);
    }
  },
  keyboard: async (page) => {
    await menuButton(page, /Уровень дня/).click();
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowLeft', 'Enter']) {
      await page.keyboard.press(key);
      await page.clock.runFor(100);
    }
  },
  paused: async (page) => {
    await STATES.moves(page);
    await page.keyboard.press('Escape');
  },
  solved: (page) => menuButton(page, /Уровень дня/).click(),
  next: async (page) => {
    await menuButton(page, /Бесконечный/).click();
    await page.clock.runFor(30_000);
  },
};

mkdirSync(OUT, { recursive: true });
if (!filter) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
let count = 0;

async function shoot({ viewport, scheme, state, query = '', save = null, name: custom }) {
  const name = custom ?? `${state}-${viewport.name}-${scheme}`;
  if (filter && !name.includes(filter)) return;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 3 : 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  if (save !== null) {
    await page.addInitScript((value) => localStorage.setItem('miller:save', value), save);
  }
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.goto(URL + query);
  await page.clock.runFor(1500);
  await STATES[state](page);
  await page.clock.runFor(state === 'solved' ? 1800 : 900);
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (scroll > 0) problems.push(`${name}: прокрутка вбок на ${scroll}px`);
  for (const e of errors) problems.push(`${name}: ${e}`);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  count++;
  await context.close();
}

const played = JSON.stringify(PLAYED);
for (const viewport of VIEWPORTS) {
  for (const scheme of ['dark', 'light']) {
    for (const state of ['menu', 'help', 'playing', 'moves', 'keyboard', 'paused']) {
      await shoot({ viewport, scheme, state });
    }
    await shoot({ viewport, scheme, state: 'achievements', save: played });
    await shoot({ viewport, scheme, state: 'solved', save: played });
  }
  await shoot({
    viewport,
    scheme: 'dark',
    state: 'next',
    query: '?autoplay',
    name: `endless-solved-${viewport.name}-dark`,
  });
  for (const season of ['winter', 'spring', 'summer', 'autumn']) {
    await shoot({
      viewport,
      scheme: 'dark',
      state: 'menu',
      query: `?seed=2026&level=13&season=${season}`,
      name: `season-${season}-${viewport.name}`,
    });
  }
  await shoot({
    viewport,
    scheme: 'dark',
    state: 'menu',
    query: '?seed=77&level=1',
    name: `first-level-${viewport.name}`,
  });
  await shoot({
    viewport,
    scheme: 'light',
    state: 'menu',
    save: '{"schemaVersion":1,"daily":',
    name: `corrupt-${viewport.name}`,
  });
}

await browser.close();
console.log(`shots: ${count} снимков в ${OUT}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

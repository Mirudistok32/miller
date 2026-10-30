// Картинка превью ссылки public/og.png (1200×630): уровень дня в разгар лета, автопилот
// довёл воду до колеса. Запуск после `npm run build`: `npm run og`.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.clock.install({ time: new Date('2026-07-15T12:00:00') });
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?autoplay');
await page.getByRole('button', { name: /Уровень дня/ }).click();
await page.clock.runFor(30_000);
await page
  .locator('.screen, #hint, #toasts')
  .evaluateAll((els) => els.forEach((el) => (el.hidden = true)));
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('og: public/og.png');

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { trackErrors } from './helpers';

const TYPES: Record<string, string> = { '.html': 'text/html', '.png': 'image/png' };

/** Статический хостинг: dist/ по пути base — как на Vercel (корень) и на Pages (подпапка). */
function host(base: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!path.startsWith(base)) return res.writeHead(404).end();
    const name = path.slice(base.length) || 'index.html';
    try {
      const body = readFileSync(join('dist', name));
      const type = TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}` }),
    ),
  );
}

for (const [where, base] of [
  ['корень, как на Vercel', '/'],
  ['подпапка, как на GitHub Pages', '/miller/'],
] as const) {
  test(`сайт с сервера: ${where}`, async ({ page, request }) => {
    const { server, url } = await host(base);
    try {
      const errors = trackErrors(page);
      const outside: string[] = [];
      page.on('request', (r) => {
        if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(url)) outside.push(r.url());
      });
      await page.goto(url);
      await page.getByRole('button', { name: /Уровень дня/ }).click();
      await expect(page.locator('#hud-title')).toContainText('Уровень дня');
      await page.locator('#hud-hint').click();
      await expect(page.locator('#stage')).not.toHaveAttribute('data-hint', '-1');
      expect((await request.get(`${url}og.png`)).status()).toBe(200);
      expect(outside).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      server.close();
    }
  });
}

test('настройки хостингов смотрят в ту же папку сборки', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as Record<string, unknown>;
  expect(vercel.outputDirectory).toBe('dist');
  expect(vercel.buildCommand).toBe('npm run build');
  const pages = readFileSync('.github/workflows/pages.yml', 'utf8');
  expect(pages).toMatch(/upload-pages-artifact[\s\S]*?path: dist/);
  expect(pages).toContain('run: npm run build');
});

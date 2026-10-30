// Делает dist/index.html самодостаточным: открывается двойным кликом, без сервера.
// Vite кладёт рядом один JS и один CSS (см. vite.config.ts), скрипт вкладывает их
// в HTML и удаляет. Ссылки внутри приложения — через # (createWebHashHistory),
// поэтому файл работает и с диска, и на любом статическом хостинге без настроек.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const htmlPath = join(DIST, 'index.html');
const inlined = [];

const read = (href) => {
  const file = join(DIST, href.replace(/^\.\//, ''));
  inlined.push(file);
  return readFileSync(file, 'utf8');
};

let html = readFileSync(htmlPath, 'utf8')
  .replace(/<link rel="stylesheet"[^>]*? href="([^"]+\.css)"[^>]*>/g, (_, href) => {
    const css = read(href).replace(/\/\*# sourceMappingURL=.*?\*\//g, '');
    return `<style>${css}</style>`;
  })
  .replace(/<script type="module"[^>]*? src="([^"]+\.js)"[^>]*><\/script>/g, (_, src) => {
    const js = read(src)
      .replace(/\/\/# sourceMappingURL=.*$/gm, '')
      .replace(/<\/script/gi, '<\\/script');
    return `<script type="module">${js}</script>`;
  });

const leftovers = html.match(/(?:src|href)="\.?\/?assets\/[^"]+"/g);
if (inlined.length === 0 || leftovers) {
  console.error('postbuild: не удалось встроить', leftovers ?? 'ни одного файла');
  process.exit(1);
}

writeFileSync(htmlPath, html);
for (const file of inlined) rmSync(file);
rmSync(join(DIST, 'assets'), { recursive: true, force: true });

const size = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
console.log(`postbuild: ${htmlPath} собран в один файл (${size} МБ) — открывается двойным кликом`);

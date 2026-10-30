import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

// Игра открывается двойным кликом по dist/index.html (file://). С диска браузер не грузит
// модули и шрифты отдельными файлами, поэтому всё собирается в один JS и один CSS, шрифты
// встраиваются как data:, а scripts/postbuild.mjs вкладывает JS и CSS прямо в index.html.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});

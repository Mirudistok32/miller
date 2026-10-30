import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Границы слоёв (agent-base, docs/architecture.md): зависимости направлены только внутрь.
const SRC = path.resolve(import.meta.dirname, '../../src');

const sources = (layer: string): [string, string][] => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.ts$/.test(name) ? [full] : [];
    });
  return walk(path.join(SRC, layer)).map((file) => [
    path.relative(SRC, file),
    readFileSync(file, 'utf8'),
  ]);
};

const RULES: [layer: string, forbidden: RegExp, why: string][] = [
  [
    'domain',
    /from ['"]@\/(application|infrastructure|presentation|content)\/|\b(window|document|localStorage|requestAnimationFrame)\b|Date\.now\(|new Date\(|Math\.random\(/,
    'домен — чистые функции: без браузера, часов, случайности и внешних слоёв',
  ],
  [
    'application',
    /from ['"]@\/(infrastructure|presentation)\/|\b(document|localStorage)\b/,
    'игра работает через порты, без DOM',
  ],
  ['infrastructure', /from ['"]@\/(presentation|content)\//, 'адаптеры не знают про интерфейс'],
  ['presentation', /from ['"]@\/infrastructure\//, 'вид получает адаптеры только через main.ts'],
];

describe('границы слоёв', () => {
  for (const [layer, forbidden, why] of RULES) {
    it(`${layer}: ${why}`, () => {
      const files = sources(layer);
      expect(files.length).toBeGreaterThan(0);
      for (const [file, text] of files) expect(text, file).not.toMatch(forbidden);
    });
  }
});

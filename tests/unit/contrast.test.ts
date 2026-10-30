import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Контраст токенов из styles.css в обеих темах — WCAG AA для обычного текста.
const CSS = readFileSync(
  path.resolve(import.meta.dirname, '../../src/presentation/styles.css'),
  'utf8',
);

const tokens = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, hex]) => [name, hex]),
  );
const light = tokens(CSS.match(/^:root\s*\{([^}]*)\}/m)?.[1] ?? '');
const dark = {
  ...light,
  ...tokens(CSS.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1] ?? ''),
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
/** Полупрозрачная подложка HUD над самым светлым небом. */
const over = (hex: string, alpha: number, under = '#ffffff') => {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = [1, 3, 5].map((i) => Math.round(ch(hex, i) * alpha + ch(under, i) * (1 - alpha)));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const PAIRS: [text: string, background: string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text-dim', 'surface'],
  ['text-dim', 'surface-2'],
  ['on-accent', 'accent'],
  ['danger', 'surface'],
];

describe('контраст токенов', () => {
  for (const [theme, t] of [
    ['светлая', light],
    ['тёмная', dark],
  ] as const) {
    it(`${theme}: все пары не ниже 4.5`, () => {
      for (const [fg, bg] of PAIRS) {
        expect(t[fg], `нет токена --${fg}`).toBeDefined();
        expect(t[bg], `нет токена --${bg}`).toBeDefined();
        expect(ratio(t[fg] as string, t[bg] as string), `${fg} на ${bg}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }

  it('тёмная тема по системной настройке совпадает с ручной', () => {
    const system = tokens(
      CSS.match(/prefers-color-scheme:\s*dark\)\s*\{\s*:root[^{]*\{([^}]*)\}/)?.[1] ?? '',
    );
    expect(system).toEqual(
      tokens(CSS.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1] ?? ''),
    );
  });

  it('HUD читается даже над белым небом (подложка 82 %)', () => {
    const bg = over(light['hud-bg'] as string, 0.82);
    expect(ratio(light['hud-text'] as string, bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light['hud-dim'] as string, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

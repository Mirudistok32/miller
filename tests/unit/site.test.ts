import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LINKS } from '@/content/texts';

const HTML = readFileSync('index.html', 'utf8');
const OTHER = 'https://example.com/other/';

/** Как записан адрес сайта в каждом месте index.html: поле и образец с адресом в скобках. */
const PLACES: Record<string, RegExp> = {
  canonical: /<link rel="canonical" href="([^"]*)"/,
  'og:url': /<meta property="og:url" content="([^"]*)"/,
  'og:image': /<meta property="og:image" content="([^"]*?)og\.png"/,
  'JSON-LD': /<script type="application\/ld\+json">[\s\S]*?"url": "([^"]*)"/,
};

/** Места, где адрес не совпал с site или не нашёлся. */
const drifted = (html: string, site: string): string[] =>
  Object.entries(PLACES).flatMap(([where, pattern]) =>
    html.match(pattern)?.[1] === site ? [] : [where],
  );

describe('адрес сайта', () => {
  it('canonical, og:url, og:image, JSON-LD и текст результата указывают на один адрес', () => {
    expect(LINKS.site).toMatch(/^https:\/\/.+\/$/);
    expect(drifted(HTML, LINKS.site)).toEqual([]);
  });

  it('разъехавшаяся ссылка роняет проверку: каждое место по отдельности', () => {
    for (const [where, pattern] of Object.entries(PLACES)) {
      const broken = HTML.replace(pattern, (tag, url: string) => tag.replace(url, OTHER));
      expect(drifted(broken, LINKS.site), where).toEqual([where]);
    }
    // адрес в texts.ts сверяется с теми же местами: разошёлся он — разошлись все
    expect(drifted(HTML, OTHER)).toEqual(Object.keys(PLACES));
  });

  it('картинка превью лежит в public, куда указывает og:image', () => {
    expect(readFileSync('public/og.png').length).toBeGreaterThan(1000);
    expect(HTML).toContain(`content="${LINKS.site}og.png"`);
  });
});

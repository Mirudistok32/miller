import { describe, expect, it } from 'vitest';

import { addDays, dayNumber, isDateKey, keyOfDay, monthOfKey, streakOf } from '@/domain/calendar';
import { maskOf, rotsOf } from '@/domain/grid';
import { DAILY_PARAMS, dailyLevel, dailySeed } from '@/domain/levels';
import { seasonOfLevel, seasonOfMonth } from '@/domain/season';

describe('календарь без Date', () => {
  it('номер дня и обратно — для каждого дня 1900–2200', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(keyOfDay(0)).toBe('1970-01-01');
    expect(dayNumber('2026-10-30')).toBe(20_756);
    for (let d = dayNumber('1900-01-01'); d <= dayNumber('2200-12-31'); d++) {
      expect(dayNumber(keyOfDay(d))).toBe(d);
    }
  });

  it('совпадает с Date в UTC', () => {
    for (let d = -400; d < 30_000; d += 37) {
      expect(keyOfDay(d)).toBe(new Date(d * 86_400_000).toISOString().slice(0, 10));
    }
  });

  it('високосные годы и несуществующие даты', () => {
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2000-02-29')).toBe(true);
    expect(isDateKey('1900-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey(20261030)).toBe(false);
  });

  it('сдвиг по дням через месяц и год', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(monthOfKey('2026-10-30')).toBe(9);
  });

  it('серия: сколько дней подряд до этого включительно', () => {
    const days = new Set(['2026-10-27', '2026-10-28', '2026-10-30', '2026-10-31']);
    const has = (d: string) => days.has(d);
    expect(streakOf(has, '2026-10-31')).toBe(2);
    expect(streakOf(has, '2026-10-28')).toBe(2);
    expect(streakOf(has, '2026-10-29')).toBe(0);
  });
});

describe('уровень дня', () => {
  it('одна дата — один и тот же уровень, сколько ни генерируй', () => {
    const a = dailyLevel('2026-10-30');
    const b = dailyLevel('2026-10-30');
    expect(a).toEqual(b);
    expect(a.params).toEqual(DAILY_PARAMS);
  });

  it('у каждой даты свой уровень', () => {
    const seen = new Set<string>();
    for (let d = '2026-01-01', i = 0; i < 120; i++, d = addDays(d, 1)) {
      seen.add(dailyLevel(d).board.cells.map(maskOf).join(''));
    }
    expect(seen.size).toBe(120);
  });

  it('уровень 30.10.2026 не меняется от версии к версии (иначе нужен новый SEED_VERSION)', () => {
    const level = dailyLevel('2026-10-30');
    expect(dailySeed('2026-10-30')).toBe(dailySeed('2026-10-30'));
    expect({
      source: level.board.source,
      mill: level.board.mill,
      kinds: level.board.cells.map((c) => c.kind[0]).join(''),
      rots: rotsOf(level.board),
      moves: level.solution.moves,
    }).toMatchSnapshot();
  });

  it('время года уровня дня — по месяцу, бесконечного — по номеру уровня', () => {
    expect(seasonOfMonth(monthOfKey('2026-10-30'))).toBe('autumn');
    expect(seasonOfMonth(monthOfKey('2026-12-01'))).toBe('winter');
    expect([1, 5, 6, 11, 16, 21].map(seasonOfLevel)).toEqual([
      'spring',
      'spring',
      'summer',
      'autumn',
      'winter',
      'spring',
    ]);
  });
});

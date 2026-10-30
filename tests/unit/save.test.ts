import { describe, expect, it } from 'vitest';

import { shareText } from '@/content/texts';
import {
  ACHIEVEMENT_IDS,
  LEVEL_HIGH,
  LEVEL_MID,
  PERFECT_MANY,
  SWIFT_SECONDS,
} from '@/domain/achievements';
import { addDays } from '@/domain/calendar';
import { dropsOf, type SolveResult } from '@/domain/result';
import {
  backupFileName,
  DAILY_KEEP,
  emptySave,
  makeBackup,
  mergeSaves,
  parseSave,
  readBackup,
  recordSolve,
  type Save,
  withProgress,
} from '@/domain/save';
import { SEASONS } from '@/domain/season';

const NOW = '2026-10-30T12:00:00.000Z';

const daily = (patch: Partial<SolveResult> = {}): SolveResult => ({
  mode: 'daily',
  date: '2026-10-30',
  level: null,
  size: '6x7',
  moves: 20,
  minMoves: 15,
  time: 95,
  attempts: 1,
  hints: 0,
  dry: false,
  season: 'autumn',
  rots: '0123',
  ...patch,
});

const endless = (level: number, patch: Partial<SolveResult> = {}): SolveResult =>
  daily({ mode: 'endless', date: null, level, size: '5x5', ...patch });

describe('разбор сохранения', () => {
  it('пустое сохранение проходит туда и обратно', () => {
    const save = emptySave();
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('сыгранное сохранение проходит туда и обратно', () => {
    let save = recordSolve(emptySave(), daily(), NOW).save;
    save = recordSolve(save, endless(3), NOW).save;
    save = withProgress(save, 'endless', {
      key: 'endless:v1:4',
      rots: '0123',
      moves: 2,
      time: 4.5,
      started: true,
      attempts: 1,
    });
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('мусор и чужие данные — null', () => {
    for (const raw of [null, 42, 'save', [], {}, { schemaVersion: 2 }]) {
      expect(parseSave(raw)).toBeNull();
    }
    expect(parseSave({ schemaVersion: 1, daily: { '2026-13-45': {} } })).toBeNull();
    expect(
      parseSave({
        schemaVersion: 1,
        daily: { '2026-10-30': { moves: 'много', min: 1, time: 1, attempts: 1, rots: '0' } },
      }),
    ).toBeNull();
    expect(parseSave({ schemaVersion: 1, endless: { level: 0 } })).toBeNull();
    expect(parseSave({ schemaVersion: 1, best: { '6x6': { time: -1, extra: 0 } } })).toBeNull();
    expect(parseSave({ schemaVersion: 1, best: { чужой: { time: 1, extra: 0 } } })).toBeNull();
    expect(
      parseSave({
        schemaVersion: 1,
        stats: { solved: 1, perfect: 0, dry: 0, bestStreak: 0, seasons: ['лето'] },
      }),
    ).toBeNull();
  });

  it('незнакомые ачивки пропускаются, остальное сохраняется', () => {
    const save = parseSave({ schemaVersion: 1, achievements: { daily: NOW, 'from-future': NOW } });
    expect(save?.achievements).toEqual({ daily: NOW });
  });

  it('повреждённый недоигранный уровень просто забывается, рекорды целы', () => {
    const save = parseSave({
      schemaVersion: 1,
      best: { daily: { time: 50, extra: 2 } },
      progress: { daily: { key: 'daily:v1:2026-10-30', rots: '9', moves: 1 }, endless: 'x' },
    });
    expect(save?.best).toEqual({ daily: { time: 50, extra: 2 } });
    expect(save?.progress).toEqual({});
  });
});

describe('запись решения', () => {
  it('ходов меньше посчитанного минимума: лишних ноль, итог читается обратно', () => {
    const { save, unlocked } = recordSolve(emptySave(), daily({ moves: 12, minMoves: 15 }), NOW);
    expect(save.best.daily?.extra).toBe(0);
    expect(unlocked).toContain('perfect');
    expect(dropsOf(12, 15)).toBe(3);
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('первое решение открывает ачивку один раз', () => {
    const once = recordSolve(emptySave(), endless(1), NOW);
    expect(once.unlocked).toContain('first-mill');
    const twice = recordSolve(once.save, endless(2), '2026-11-01T00:00:00.000Z');
    expect(twice.unlocked).not.toContain('first-mill');
    expect(twice.save.achievements['first-mill']).toBe(NOW);
  });

  it('уровень дня записывается один раз: повтор той же даты не перезаписывает', () => {
    const first = recordSolve(emptySave(), daily({ moves: 22 }), NOW).save;
    expect(first.daily['2026-10-30']).toEqual({
      moves: 22,
      min: 15,
      time: 95,
      attempts: 1,
      rots: '0123',
    });
    const again = recordSolve(first, daily({ moves: 15 }), NOW).save;
    expect(again.daily['2026-10-30']?.moves).toBe(22);
  });

  it('серия дней: три подряд — ачивка, пропуск обнуляет', () => {
    let save = emptySave();
    let r = recordSolve(save, daily({ date: '2026-10-28' }), NOW);
    r = recordSolve(r.save, daily({ date: '2026-10-29' }), NOW);
    expect(r.streak).toBe(2);
    expect(r.unlocked).not.toContain('streak-3');
    r = recordSolve(r.save, daily({ date: '2026-10-30' }), NOW);
    expect(r.streak).toBe(3);
    expect(r.unlocked).toContain('streak-3');
    save = recordSolve(r.save, daily({ date: '2026-11-01' }), NOW).save;
    expect(save.stats.bestStreak).toBe(3);
  });

  it('неделя подряд — «Неделя у жерновов»', () => {
    let r = recordSolve(emptySave(), daily({ date: '2026-10-01' }), NOW);
    for (let i = 1; i < 7; i++)
      r = recordSolve(r.save, daily({ date: addDays('2026-10-01', i) }), NOW);
    expect(r.unlocked).toContain('streak-7');
  });

  it('рекорд поля: лучшее время и меньше всего лишних ходов, по отдельности', () => {
    const a = recordSolve(emptySave(), endless(6, { time: 80, moves: 20, minMoves: 15 }), NOW);
    expect(a.record).toEqual({ time: true, extra: true });
    const b = recordSolve(a.save, endless(7, { time: 60, moves: 25, minMoves: 15 }), NOW);
    expect(b.record).toEqual({ time: true, extra: false });
    expect(b.best).toEqual({ time: 60, extra: 5 });
    expect(b.save.best['5x5']).toEqual({ time: 60, extra: 5 });
    expect(b.save.best.daily).toBeUndefined();
  });

  it('бесконечный режим двигается вперёд и стирает недоигранный уровень', () => {
    let save = withProgress(emptySave(), 'endless', {
      key: 'endless:v1:4',
      rots: '01',
      moves: 3,
      time: 2,
      started: true,
      attempts: 1,
    });
    save = withProgress(save, 'daily', {
      key: 'daily:v1:2026-10-30',
      rots: '01',
      moves: 1,
      time: 1,
      started: true,
      attempts: 1,
    });
    const r = recordSolve(save, endless(4), NOW);
    expect(r.save.endless.level).toBe(5);
    expect(r.save.progress.endless).toBeUndefined();
    expect(r.save.progress.daily).toBeDefined();
    // старый уровень не отбрасывает назад
    expect(recordSolve(r.save, endless(2), NOW).save.endless.level).toBe(5);
  });

  it('без лишних ходов, быстро, ни капли мимо, уровни 10 и 25, четыре сезона', () => {
    let r = recordSolve(
      emptySave(),
      daily({ moves: 15, minMoves: 15, time: SWIFT_SECONDS, dry: true }),
      NOW,
    );
    expect(r.unlocked).toEqual(
      expect.arrayContaining(['first-mill', 'daily', 'perfect', 'swift', 'dry']),
    );
    expect(
      recordSolve(emptySave(), daily({ time: SWIFT_SECONDS + 0.1 }), NOW).unlocked,
    ).not.toContain('swift');
    r = recordSolve(r.save, endless(LEVEL_MID - 1), NOW);
    expect(r.unlocked).not.toContain('level-10');
    r = recordSolve(r.save, endless(LEVEL_MID), NOW);
    expect(r.unlocked).toContain('level-10');
    r = recordSolve(r.save, endless(LEVEL_HIGH), NOW);
    expect(r.unlocked).toContain('level-25');
    for (const season of SEASONS) r = recordSolve(r.save, endless(30, { season }), NOW);
    expect(r.save.achievements['four-seasons']).toBeDefined();
  });

  it(`«Мастер-мельник» — ${PERFECT_MANY} решений без лишних ходов`, () => {
    let save: Save = emptySave();
    for (let i = 0; i < PERFECT_MANY - 1; i++) {
      save = recordSolve(save, endless(i + 1, { moves: 9, minMoves: 9 }), NOW).save;
    }
    expect(save.achievements['perfect-5']).toBeUndefined();
    const last = recordSolve(save, endless(9, { moves: 9, minMoves: 9 }), NOW);
    expect(last.unlocked).toContain('perfect-5');
    expect(last.save.stats.perfect).toBe(PERFECT_MANY);
  });

  it(`история уровня дня не растёт бесконечно: последние ${DAILY_KEEP} дней`, () => {
    let save = emptySave();
    for (let i = 0; i < DAILY_KEEP + 10; i++) {
      save = recordSolve(save, daily({ date: addDays('2025-01-01', i) }), NOW).save;
    }
    const dates = Object.keys(save.daily).sort();
    expect(dates).toHaveLength(DAILY_KEEP);
    expect(dates[0]).toBe(addDays('2025-01-01', 10));
  });

  it('все ачивки достижимы', () => {
    let save = emptySave();
    let r = recordSolve(save, daily({ date: '2026-10-01' }), NOW);
    for (let i = 1; i < 7; i++) {
      r = recordSolve(
        r.save,
        daily({ date: addDays('2026-10-01', i), moves: 15, minMoves: 15, time: 30, dry: true }),
        NOW,
      );
    }
    save = r.save;
    for (const season of SEASONS)
      save = recordSolve(save, endless(LEVEL_HIGH, { season }), NOW).save;
    expect(Object.keys(save.achievements).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  it('решение с подсказкой: без «perfect» и рекорда по ходам, счётчик в записи дня', () => {
    const r = recordSolve(emptySave(), daily({ moves: 15, minMoves: 15, hints: 2 }), NOW);
    expect(r.unlocked).not.toContain('perfect');
    expect(r.save.stats.perfect).toBe(0);
    expect(r.record).toEqual({ time: true, extra: false });
    expect(r.best).toEqual({ time: 95 });
    expect(r.save.daily['2026-10-30']?.hints).toBe(2);
    expect(parseSave(JSON.parse(JSON.stringify(r.save)))).toEqual(r.save);
    // чистое решение после этого — рекорд по ходам
    const clean = recordSolve(r.save, daily({ moves: 16, minMoves: 15, date: '2026-10-31' }), NOW);
    expect(clean.record.extra).toBe(true);
    expect(clean.best.extra).toBe(1);
    // подсказка не портит прежний рекорд
    const later = recordSolve(clean.save, daily({ moves: 15, minMoves: 15, hints: 1 }), NOW);
    expect(later.best.extra).toBe(1);
    expect(later.record.extra).toBe(false);
  });

  it('решение без подсказки поля hints в файл не пишет', () => {
    const { save } = recordSolve(emptySave(), daily(), NOW);
    expect(save.daily['2026-10-30']).not.toHaveProperty('hints');
  });

  it('старое сохранение без hints читается: подсказок ноль, рекорд с extra цел', () => {
    const old = {
      schemaVersion: 1,
      sound: true,
      theme: 'system',
      daily: { '2026-10-29': { moves: 21, min: 17, time: 83.6, attempts: 1, rots: '0123' } },
      endless: { level: 7 },
      best: { daily: { time: 83.6, extra: 4 }, '6x6': { time: 51.2, extra: 3 } },
      progress: {
        endless: {
          key: 'endless:v1:7',
          rots: '2013',
          moves: 5,
          time: 12.4,
          started: true,
          attempts: 1,
        },
      },
      achievements: { 'first-mill': '2026-10-29T12:00:00.000Z' },
      stats: { solved: 6, perfect: 1, dry: 0, seasons: ['spring', 'autumn'], bestStreak: 2 },
    };
    const save = parseSave(old);
    expect(save).not.toBeNull();
    expect(save?.daily['2026-10-29']?.hints).toBeUndefined();
    expect(save?.progress.endless?.hints).toBeUndefined();
    expect(save?.best.daily).toEqual({ time: 83.6, extra: 4 });
    expect(JSON.parse(JSON.stringify(save))).toEqual(old);
  });

  it('повреждённый счётчик подсказок забывается, а рекорд с мусором в extra — нет', () => {
    const entry = { moves: 1, min: 1, time: 1, attempts: 1, rots: '0', hints: 'много' };
    const save = parseSave({ schemaVersion: 1, daily: { '2026-10-29': entry } });
    expect(save?.daily['2026-10-29']).not.toHaveProperty('hints');
    expect(parseSave({ schemaVersion: 1, best: { daily: { time: 1, extra: 'x' } } })).toBeNull();
  });

  it('объединение копий: меньше подсказок важнее меньшего числа ходов', () => {
    const entry = { min: 15, time: 90, attempts: 1, rots: '0' };
    const helped = { ...emptySave(), daily: { '2026-10-30': { ...entry, moves: 15, hints: 2 } } };
    const clean = { ...emptySave(), daily: { '2026-10-30': { ...entry, moves: 20 } } };
    expect(mergeSaves(helped, clean).daily['2026-10-30']?.moves).toBe(20);
    expect(mergeSaves(clean, helped).daily['2026-10-30']?.moves).toBe(20);
    const merged = mergeSaves(helped, clean);
    expect(mergeSaves(merged, clean)).toEqual(merged);
  });

  it('объединение копий: рекорд без extra берёт его у другой копии', () => {
    const a = { ...emptySave(), best: { daily: { time: 50 } } };
    const b = { ...emptySave(), best: { daily: { time: 70, extra: 3 } } };
    const c = { ...emptySave(), best: { daily: { time: 60 } } };
    expect(mergeSaves(a, b).best.daily).toEqual({ time: 50, extra: 3 });
    expect(mergeSaves(a, c).best.daily).toEqual({ time: 50 });
  });

  it('капли с подсказкой — не больше двух', () => {
    expect(dropsOf(15, 15, 1)).toBe(2);
    expect(dropsOf(16, 15, 1)).toBe(2);
    expect(dropsOf(21, 15, 3)).toBe(1);
  });

  it('текст результата показывает подсказки', () => {
    const helped = shareText(daily({ moves: 15, minMoves: 15, hints: 2, attempts: 2 }));
    expect(helped).toContain('💧💧 15 ходов (минимум 15) · 1:35 · 💡 2 · попытка 2');
    expect(helped).not.toContain('💧💧💧');
    expect(shareText(daily())).not.toContain('💡');
  });

  it('капли в тексте результата', () => {
    expect(dropsOf(15, 15)).toBe(3);
    expect(dropsOf(20, 15)).toBe(2);
    expect(dropsOf(21, 15)).toBe(1);
    expect(dropsOf(5, 3)).toBe(2);
    expect(dropsOf(6, 3)).toBe(1);
  });
});

describe('резервная копия', () => {
  const played = recordSolve(
    recordSolve(emptySave(), daily({ moves: 15, minMoves: 15 }), NOW).save,
    endless(4),
    NOW,
  ).save;

  it('имя файла с датой', () => {
    expect(backupFileName(NOW)).toBe('miller-backup-2026-10-30.json');
  });

  it('экспорт → очистка → импорт возвращает рекорды, уровни дня и ачивки', () => {
    const read = readBackup(JSON.stringify(makeBackup(played, NOW, '0.1.0'), null, 2));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const restored = mergeSaves(emptySave(), read.save);
    expect(restored.daily).toEqual(played.daily);
    expect(restored.best).toEqual(played.best);
    expect(restored.achievements).toEqual(played.achievements);
    expect(restored.stats).toEqual(played.stats);
    expect(restored.endless).toEqual(played.endless);
  });

  it('повторный импорт ничего не меняет', () => {
    expect(mergeSaves(played, played)).toEqual(played);
  });

  it('объединение берёт лучшее и самую раннюю дату ачивки', () => {
    const mine: Save = {
      ...emptySave(),
      endless: { level: 3 },
      best: { '5x5': { time: 70, extra: 1 } },
      achievements: { dry: '2026-11-02' },
    };
    const theirs: Save = {
      ...emptySave(),
      endless: { level: 8 },
      best: { '5x5': { time: 50, extra: 4 }, daily: { time: 90, extra: 0 } },
      achievements: { dry: '2026-11-01', perfect: '2026-11-03' },
    };
    const merged = mergeSaves(mine, theirs);
    expect(merged.endless.level).toBe(8);
    expect(merged.best).toEqual({ '5x5': { time: 50, extra: 1 }, daily: { time: 90, extra: 0 } });
    expect(merged.achievements).toEqual({ dry: '2026-11-01', perfect: '2026-11-03' });
  });

  it.each([
    ['', 'empty'],
    ['{"format":"miller', 'not-json'],
    ['{"format":"pigeon-post-backup","schemaVersion":1}', 'foreign'],
    ['{"format":"miller-backup","schemaVersion":9,"data":{}}', 'newer'],
    ['{"format":"miller-backup","schemaVersion":1,"data":{"schemaVersion":1,"best":[]}}', 'broken'],
    ['x'.repeat(400_000), 'too-big'],
  ])('понятная ошибка: %#', (text, problem) => {
    expect(readBackup(text)).toEqual({ ok: false, problem });
  });
});

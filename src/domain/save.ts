/**
 * Сохранение: настройки, уровни дня, бесконечный режим, рекорды, ачивки и недоигранные
 * уровни. Формат описан в docs/save-format.md; поля не переименовываются без миграции.
 */

import { type AchievementId, earnedBy, isAchievementId } from './achievements';
import { isDateKey, streakOf } from './calendar';
import { extraOf, type Mode, type SolveResult } from './result';
import { isSeason, type Season, SEASONS } from './season';

export const SAVE_VERSION = 1;
export const BACKUP_FORMAT = 'miller-backup';
/** Больше этого файл копии точно не наш. */
export const BACKUP_MAX_BYTES = 300_000;
/** Сколько последних дней уровня дня хранить. */
export const DAILY_KEEP = 400;

export type Theme = 'system' | 'light' | 'dark';
const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const MODES: readonly Mode[] = ['daily', 'endless'];

export interface DailyEntry {
  moves: number;
  /** Минимум ходов этого уровня. */
  min: number;
  /** Время решения, с. */
  time: number;
  attempts: number;
  /** Повороты решённого поля — чтобы показать его снова. */
  rots: string;
  /** Сколько подсказок взято; нет поля — ни одной. */
  hints?: number;
}

export interface Best {
  /** Лучшее время, с. */
  time: number;
  /** Меньше всего ходов сверх минимума; нет поля — решали только с подсказками. */
  extra?: number;
}

export interface Progress {
  /** Чей это уровень: `daily:v2:2026-10-30`, `endless:v2:7`. Не совпал — прогресс не нужен. */
  key: string;
  rots: string;
  moves: number;
  time: number;
  started: boolean;
  attempts: number;
  /** Сколько подсказок взято; нет поля — ни одной. */
  hints?: number;
}

export interface Save {
  schemaVersion: typeof SAVE_VERSION;
  sound: boolean;
  theme: Theme;
  /** Уровень дня: дата → первое решение. */
  daily: Record<string, DailyEntry>;
  /** Бесконечный режим: уровень, который играется сейчас, с 1. */
  endless: { level: number };
  /** Рекорды: «daily» для уровня дня и размеры полей «6x7» для бесконечного режима. */
  best: Record<string, Best>;
  /** Недоигранные уровни: продолжаются после перезагрузки. */
  progress: Partial<Record<Mode, Progress>>;
  /** id → когда открыта (ISO). */
  achievements: Partial<Record<AchievementId, string>>;
  stats: {
    solved: number;
    perfect: number;
    dry: number;
    /** Времена года, в которые решён хотя бы один уровень. */
    seasons: Season[];
    bestStreak: number;
  };
}

export const emptySave = (): Save => ({
  schemaVersion: SAVE_VERSION,
  sound: true,
  theme: 'system',
  daily: {},
  endless: { level: 1 },
  best: {},
  progress: {},
  achievements: {},
  stats: { solved: 0, perfect: 0, dry: 0, seasons: [], bestStreak: 0 },
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const whole = (v: unknown, min = 0): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null;
const ROTS = /^[0-3]{1,100}$/;
const BEST_KEY = /^(daily|\d{1,2}x\d{1,2})$/;

/** Необязательный счётчик подсказок: ноль и чужое значение в файл не попадают. */
const hintsOf = (v: unknown): { hints?: number } => {
  const hints = whole(v, 1);
  return hints === null ? {} : { hints };
};

function parseDaily(v: unknown): DailyEntry | null {
  if (!isRecord(v)) return null;
  const moves = whole(v.moves);
  const min = whole(v.min);
  const time = count(v.time);
  const attempts = whole(v.attempts, 1);
  if (moves === null || min === null || time === null || attempts === null) return null;
  if (typeof v.rots !== 'string' || !ROTS.test(v.rots)) return null;
  const hints = hintsOf(v.hints);
  return { moves, min, time, attempts, rots: v.rots, ...hints };
}

function parseProgress(v: unknown): Progress | null {
  if (!isRecord(v) || typeof v.key !== 'string' || v.key.length > 64) return null;
  const moves = whole(v.moves);
  const time = count(v.time);
  const attempts = whole(v.attempts, 1);
  if (moves === null || time === null || attempts === null) return null;
  if (typeof v.rots !== 'string' || !ROTS.test(v.rots) || typeof v.started !== 'boolean') {
    return null;
  }
  const hints = hintsOf(v.hints);
  return { key: v.key, rots: v.rots, moves, time, started: v.started, attempts, ...hints };
}

/** Проверяет форму данных. null — данные чужие или повреждены. */
export function parseSave(raw: unknown): Save | null {
  if (!isRecord(raw) || raw.schemaVersion !== SAVE_VERSION) return null;
  const save = emptySave();
  if (typeof raw.sound === 'boolean') save.sound = raw.sound;
  if (THEMES.includes(raw.theme as Theme)) save.theme = raw.theme as Theme;

  if (raw.daily !== undefined) {
    if (!isRecord(raw.daily)) return null;
    for (const [date, value] of Object.entries(raw.daily)) {
      const entry = parseDaily(value);
      if (!isDateKey(date) || !entry) return null;
      save.daily[date] = entry;
    }
  }
  if (raw.endless !== undefined) {
    const level = isRecord(raw.endless) ? whole(raw.endless.level, 1) : null;
    if (level === null) return null;
    save.endless = { level };
  }
  if (raw.best !== undefined) {
    if (!isRecord(raw.best)) return null;
    for (const [key, value] of Object.entries(raw.best)) {
      if (!BEST_KEY.test(key) || !isRecord(value)) return null;
      const time = count(value.time);
      const extra = value.extra === undefined ? undefined : whole(value.extra);
      if (time === null || extra === null) return null;
      save.best[key] = extra === undefined ? { time } : { time, extra };
    }
  }
  if (isRecord(raw.progress)) {
    // Недоигранный уровень не ценность: повреждённый просто начнётся заново.
    for (const mode of MODES) {
      const p = parseProgress(raw.progress[mode]);
      if (p) save.progress[mode] = p;
    }
  }
  if (raw.achievements !== undefined) {
    if (!isRecord(raw.achievements)) return null;
    for (const [id, at] of Object.entries(raw.achievements)) {
      // Незнакомые id (из версии новее) пропускаем, а не теряем весь файл.
      if (isAchievementId(id) && typeof at === 'string') save.achievements[id] = at;
    }
  }
  if (raw.stats !== undefined) {
    const s = raw.stats;
    if (!isRecord(s)) return null;
    const solved = whole(s.solved);
    const perfect = whole(s.perfect);
    const dry = whole(s.dry);
    const bestStreak = whole(s.bestStreak);
    const seasons: unknown = s.seasons;
    if (solved === null || perfect === null || dry === null || bestStreak === null) return null;
    if (!Array.isArray(seasons) || !seasons.every(isSeason)) return null;
    save.stats = {
      solved,
      perfect,
      dry,
      seasons: SEASONS.filter((x) => seasons.includes(x)),
      bestStreak,
    };
  }
  return save;
}

/** Оставляет последние DAILY_KEEP дней. */
function keepRecent(daily: Record<string, DailyEntry>): Record<string, DailyEntry> {
  const dates = Object.keys(daily).sort();
  if (dates.length <= DAILY_KEEP) return daily;
  const out: Record<string, DailyEntry> = {};
  for (const date of dates.slice(-DAILY_KEEP)) {
    const entry = daily[date];
    if (entry) out[date] = entry;
  }
  return out;
}

/** Серия уровня дня, заканчивающаяся этой датой. */
export const streakAt = (save: Save, date: string): number =>
  streakOf((d) => save.daily[d] !== undefined, date);

export const bestKey = (r: Pick<SolveResult, 'mode' | 'size'>): string =>
  r.mode === 'daily' ? 'daily' : r.size;

export interface RecordedSolve {
  save: Save;
  unlocked: AchievementId[];
  /** Побит рекорд поля: по времени, по ходам сверх минимума. Первое решение — тоже рекорд. */
  record: { time: boolean; extra: boolean };
  best: Best;
  /** Серия уровня дня; 0 — решён не уровень дня. */
  streak: number;
}

/**
 * Записывает решение: рекорд поля, уровень дня (первое решение даты), следующий уровень
 * бесконечного режима, итоги и ачивки. Недоигранный уровень этого режима стирается.
 */
export function recordSolve(save: Save, r: SolveResult, nowIso: string): RecordedSolve {
  const key = bestKey(r);
  const extra = extraOf(r);
  const prev = save.best[key];
  const counted = r.hints === 0; // решение с подсказкой не даёт рекорда по лишним ходам
  const bestExtra = Math.min(prev?.extra ?? Infinity, counted ? extra : Infinity);
  const best: Best = {
    time: Math.min(prev?.time ?? Infinity, r.time),
    ...(bestExtra === Infinity ? {} : { extra: bestExtra }),
  };
  const record = {
    time: prev === undefined || r.time < prev.time,
    extra: counted && extra < (prev?.extra ?? Infinity),
  };

  let daily = save.daily;
  if (r.mode === 'daily' && r.date && !save.daily[r.date]) {
    const entry = { moves: r.moves, min: r.minMoves, time: r.time, attempts: r.attempts };
    const hints = r.hints > 0 ? { hints: r.hints } : {};
    daily = keepRecent({ ...save.daily, [r.date]: { ...entry, rots: r.rots, ...hints } });
  }
  const streak = r.mode === 'daily' && r.date ? streakOf((d) => daily[d] !== undefined, r.date) : 0;
  const endless =
    r.mode === 'endless' && r.level !== null
      ? { level: Math.max(save.endless.level, r.level + 1) }
      : save.endless;

  const stats: Save['stats'] = {
    solved: save.stats.solved + 1,
    perfect: save.stats.perfect + (extra === 0 && counted ? 1 : 0),
    dry: save.stats.dry + (r.dry ? 1 : 0),
    seasons: SEASONS.filter((s) => s === r.season || save.stats.seasons.includes(s)),
    bestStreak: Math.max(save.stats.bestStreak, streak),
  };
  const unlocked = earnedBy(r, {
    perfect: stats.perfect,
    seasons: stats.seasons,
    streak,
  }).filter((id) => save.achievements[id] === undefined);
  const achievements = { ...save.achievements };
  for (const id of unlocked) achievements[id] = nowIso;
  const progress = { ...save.progress };
  delete progress[r.mode];

  return {
    save: {
      ...save,
      daily,
      endless,
      best: { ...save.best, [key]: best },
      progress,
      achievements,
      stats,
    },
    unlocked,
    record,
    best,
    streak,
  };
}

/** Записывает или стирает (null) недоигранный уровень режима. */
export function withProgress(save: Save, mode: Mode, progress: Progress | null): Save {
  const next = { ...save.progress };
  if (progress) next[mode] = progress;
  else delete next[mode];
  return { ...save, progress: next };
}

/* ---------- резервная копия ---------- */

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof SAVE_VERSION;
  exportedAt: string;
  appVersion: string;
  data: Save;
}

export const makeBackup = (save: Save, nowIso: string, appVersion: string): Backup => ({
  format: BACKUP_FORMAT,
  schemaVersion: SAVE_VERSION,
  exportedAt: nowIso,
  appVersion,
  data: save,
});

/** `miller-backup-2026-10-30.json` */
export const backupFileName = (nowIso: string) => `miller-backup-${nowIso.slice(0, 10)}.json`;

export type BackupProblem = 'empty' | 'too-big' | 'not-json' | 'foreign' | 'newer' | 'broken';

export type BackupRead = { ok: true; save: Save } | { ok: false; problem: BackupProblem };

export function readBackup(text: string): BackupRead {
  if (text.trim() === '') return { ok: false, problem: 'empty' };
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, problem: 'too-big' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'not-json' };
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, problem: 'foreign' };
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SAVE_VERSION) {
    return { ok: false, problem: 'newer' };
  }
  const save = parseSave(raw.data);
  return save ? { ok: true, save } : { ok: false, problem: 'broken' };
}

/**
 * Объединение копии с текущим: уровни дня — все даты (при совпадении — решение с меньшим
 * числом подсказок, затем ходов и времени), рекорды — лучшие, ачивки — все с самой ранней датой, итоги — большие.
 * Настройки и недоигранные уровни остаются текущими. Повторный импорт ничего не меняет.
 */
export function mergeSaves(current: Save, incoming: Save): Save {
  const daily = { ...current.daily };
  for (const [date, theirs] of Object.entries(incoming.daily)) {
    const mine = daily[date];
    const lessHelp = (theirs.hints ?? 0) - (mine?.hints ?? 0);
    if (
      !mine ||
      lessHelp < 0 ||
      (lessHelp === 0 &&
        (theirs.moves < mine.moves || (theirs.moves === mine.moves && theirs.time < mine.time)))
    ) {
      daily[date] = theirs;
    }
  }
  const best = { ...current.best };
  for (const [key, theirs] of Object.entries(incoming.best)) {
    const mine = best[key];
    if (!mine) {
      best[key] = theirs;
      continue;
    }
    const extra = Math.min(mine.extra ?? Infinity, theirs.extra ?? Infinity);
    best[key] = {
      time: Math.min(mine.time, theirs.time),
      ...(extra === Infinity ? {} : { extra }),
    };
  }
  const achievements: Save['achievements'] = { ...current.achievements };
  for (const [id, at] of Object.entries(incoming.achievements) as [AchievementId, string][]) {
    const mine = achievements[id];
    achievements[id] = mine === undefined || at < mine ? at : mine;
  }
  return {
    ...current,
    daily: keepRecent(daily),
    endless: { level: Math.max(current.endless.level, incoming.endless.level) },
    best,
    achievements,
    stats: {
      solved: Math.max(current.stats.solved, incoming.stats.solved),
      perfect: Math.max(current.stats.perfect, incoming.stats.perfect),
      dry: Math.max(current.stats.dry, incoming.stats.dry),
      seasons: SEASONS.filter(
        (s) => current.stats.seasons.includes(s) || incoming.stats.seasons.includes(s),
      ),
      bestStreak: Math.max(current.stats.bestStreak, incoming.stats.bestStreak),
    },
  };
}

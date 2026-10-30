/** Тексты, которые подставляются в интерфейс на лету. Статичные — в index.html. */

import {
  type AchievementId,
  LEVEL_HIGH,
  LEVEL_MID,
  PERFECT_MANY,
  STREAK_LONG,
  STREAK_SHORT,
  SWIFT_SECONDS,
} from '@/domain/achievements';
import { dropsOf, type SolveResult } from '@/domain/result';
import type { BackupProblem } from '@/domain/save';
import type { Season } from '@/domain/season';

export const LINKS = {
  site: 'https://mirudistok32.github.io/miller/',
  portfolio: 'https://mirudistok32.github.io/portfolio/',
  telegram: 'https://t.me/postnikov_st',
};

export const SEASON_NAMES: Record<Season, string> = {
  winter: 'Зима',
  spring: 'Весна',
  summer: 'Лето',
  autumn: 'Осень',
};

export const ACHIEVEMENTS: Record<AchievementId, { title: string; desc: string }> = {
  'first-mill': { title: 'Первый помол', desc: 'Довести воду до колеса в первый раз' },
  daily: { title: 'Хлеб насущный', desc: 'Решить уровень дня' },
  'streak-3': { title: 'Три дня подряд', desc: `Решать уровень дня ${STREAK_SHORT} дня подряд` },
  'streak-7': {
    title: 'Неделя у жерновов',
    desc: `Решать уровень дня ${STREAK_LONG} дней подряд`,
  },
  perfect: { title: 'Ни одного лишнего поворота', desc: 'Решить уровень за минимум ходов' },
  'perfect-5': {
    title: 'Мастер-мельник',
    desc: `Решить ${PERFECT_MANY} уровней за минимум ходов`,
  },
  swift: { title: 'Быстрая вода', desc: `Решить уровень дня быстрее ${SWIFT_SECONDS} секунд` },
  dry: { title: 'Ни капли мимо', desc: 'Решить уровень так, чтобы вода нигде не проливалась' },
  'level-10': {
    title: 'Мельница на ходу',
    desc: `Пройти ${LEVEL_MID} уровней бесконечного режима`,
  },
  'level-25': { title: 'Хозяин реки', desc: `Пройти ${LEVEL_HIGH} уровней бесконечного режима` },
  'four-seasons': { title: 'Круглый год', desc: 'Решить уровни зимой, весной, летом и осенью' },
};

export const BACKUP_PROBLEMS: Record<BackupProblem, string> = {
  empty: 'Файл пустой.',
  'too-big': 'Файл слишком большой для копии этой игры.',
  'not-json': 'Это не JSON: файл повреждён или не тот.',
  foreign: 'Это копия не от «Мельника».',
  newer: 'Копия сделана в более новой версии игры — обновите страницу.',
  broken: 'Копия повреждена: часть полей не читается.',
};

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** 1 ход, 2 хода, 5 ходов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const moves = (n: number) => `${n} ${plural(n, 'ход', 'хода', 'ходов')}`;
export const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

/** 83.4 → «1:23». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** «2026-10-30» → «30 октября». */
export const dayMonth = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;

/** «2026-10-30» → «30.10.2026». */
export const numericDate = (date: string) =>
  `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/** «6x7» → «6×7». */
export const sizeLabel = (size: string) => size.replace('x', '×');

/**
 * Текст результата для друзей: без поля и решения, только дата, капли, ходы и время.
 * Капли: три — без лишних ходов, две — почти, одна — решено; 💡 — сколько взято подсказок.
 */
export function shareText(r: SolveResult): string {
  const title =
    r.mode === 'daily' && r.date
      ? `Мельник · уровень дня ${numericDate(r.date)}`
      : `Мельник · уровень ${r.level ?? 1}`;
  const drops = '💧'.repeat(dropsOf(r.moves, r.minMoves, r.hints));
  const help = r.hints > 0 ? ` · 💡 ${r.hints}` : '';
  const attempt = r.attempts > 1 ? ` · попытка ${r.attempts}` : '';
  return [
    title,
    `${drops} ${moves(r.moves)} (минимум ${r.minMoves}) · ${clock(r.time)}${help}${attempt}`,
    LINKS.site,
  ].join('\n');
}

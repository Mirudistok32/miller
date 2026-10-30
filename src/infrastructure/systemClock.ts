import type { Clock } from '@/application/ports/clock';

const pad = (v: number) => String(v).padStart(2, '0');

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  // Уровень дня меняется в полночь по часам игрока, а не по Гринвичу.
  today: () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
};

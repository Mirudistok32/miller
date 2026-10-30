export interface Clock {
  nowIso(): string;
  /** Сегодняшняя дата по часам игрока: ГГГГ-ММ-ДД. */
  today(): string;
}

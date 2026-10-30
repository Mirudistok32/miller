import {
  backupFileName,
  type BackupProblem,
  makeBackup,
  mergeSaves,
  readBackup,
} from '@/domain/save';

import type { Clock } from './ports/clock';
import type { SaveStore } from './saveStore';

export function exportBackup(store: SaveStore, clock: Clock, appVersion: string) {
  const now = clock.nowIso();
  return {
    fileName: backupFileName(now),
    text: JSON.stringify(makeBackup(store.get(), now, appVersion), null, 2),
  };
}

export type ImportOutcome =
  { ok: true; achievements: number; days: number } | { ok: false; problem: BackupProblem };

/** Импорт копии объединяет её с текущим: лучшее из двух, ничего не теряется. */
export function importBackup(store: SaveStore, text: string): ImportOutcome {
  const read = readBackup(text);
  if (!read.ok) return read;
  const merged = store.apply((current) => mergeSaves(current, read.save));
  return {
    ok: true,
    achievements: Object.keys(merged.achievements).length,
    days: Object.keys(merged.daily).length,
  };
}

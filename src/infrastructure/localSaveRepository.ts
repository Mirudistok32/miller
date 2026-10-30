import type { LoadedSave, SaveRepository } from '@/application/ports/saveRepository';
import { emptySave, parseSave, type Save } from '@/domain/save';

/** Префикс обязателен: у всех страниц file:// в Chrome одно хранилище. */
export const SAVE_KEY = 'miller:save';
/** Сюда откладываются данные, которые не прочитались, — чтобы не стереть их молча. */
export const CORRUPT_KEY = 'miller:save-corrupt';

export function createLocalSaveRepository(
  storage: () => Storage = () => localStorage,
): SaveRepository {
  return {
    load(): LoadedSave {
      let raw: string | null;
      try {
        raw = storage().getItem(SAVE_KEY);
      } catch {
        return { save: emptySave(), problem: 'unavailable' };
      }
      if (raw === null) return { save: emptySave(), problem: null };
      let save: Save | null = null;
      try {
        save = parseSave(JSON.parse(raw));
      } catch {
        save = null;
      }
      if (save) return { save, problem: null };
      try {
        storage().setItem(CORRUPT_KEY, raw);
      } catch {
        // некуда отложить — хотя бы не перезапишем исходное до первой записи
      }
      return { save: emptySave(), problem: 'corrupt' };
    },
    write(save: Save): boolean {
      try {
        storage().setItem(SAVE_KEY, JSON.stringify(save));
        return true;
      } catch {
        return false;
      }
    },
  };
}

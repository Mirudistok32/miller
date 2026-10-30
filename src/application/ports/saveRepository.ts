import type { Save } from '@/domain/save';

export interface LoadedSave {
  save: Save;
  /** corrupt — данные были, но не прочитались (сохранены рядом); unavailable — хранилища нет. */
  problem: 'corrupt' | 'unavailable' | null;
}

export interface SaveRepository {
  load(): LoadedSave;
  /** false — записать не удалось (приватный режим, переполнение). */
  write(save: Save): boolean;
}

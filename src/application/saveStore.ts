import type { Save } from '@/domain/save';

import type { SaveRepository } from './ports/saveRepository';

export type SaveStatus = 'saved' | 'error';

/** Единственное место записи сохранения: действие (save) → save, затем запись в хранилище. */
export function createSaveStore(repo: SaveRepository) {
  const loaded = repo.load();
  let save = loaded.save;
  let status: SaveStatus = 'saved';
  const listeners = new Set<() => void>();

  return {
    problem: loaded.problem,
    get: () => save,
    status: () => status,
    apply(change: (s: Save) => Save): Save {
      save = change(save);
      // Ошибка записи не теряет данные: они остаются в памяти, их можно скачать копией.
      status = repo.write(save) ? 'saved' : 'error';
      for (const l of listeners) l();
      return save;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type SaveStore = ReturnType<typeof createSaveStore>;

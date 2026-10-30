import { beforeEach, describe, expect, it } from 'vitest';

import { createSaveStore } from '@/application/saveStore';
import { emptySave } from '@/domain/save';
import {
  CORRUPT_KEY,
  createLocalSaveRepository,
  SAVE_KEY,
} from '@/infrastructure/localSaveRepository';

describe('localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('пусто — чистое сохранение без проблем', () => {
    expect(createLocalSaveRepository().load()).toEqual({ save: emptySave(), problem: null });
  });

  it('запись и чтение', () => {
    const repo = createLocalSaveRepository();
    const save = { ...emptySave(), sound: false, endless: { level: 7 } };
    expect(repo.write(save)).toBe(true);
    expect(repo.load().save).toEqual(save);
  });

  it.each([
    ['обрывок JSON', '{"schemaVersion":1,"daily":'],
    ['не JSON вовсе', 'мельница'],
    ['чужая игра', '{"schemaVersion":1,"best":{"winter":{"score":1}}}'],
    ['не тот тип', '[1,2,3]'],
    ['null', 'null'],
  ])('мусор (%s) не стирается молча: откладывается под отдельный ключ', (_, raw) => {
    localStorage.setItem(SAVE_KEY, raw);
    const loaded = createLocalSaveRepository().load();
    expect(loaded.problem).toBe('corrupt');
    expect(loaded.save).toEqual(emptySave());
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(raw);
  });

  it('хранилище недоступно — игра работает в памяти, запись сообщает об ошибке', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    const repo = createLocalSaveRepository(broken);
    expect(repo.load()).toEqual({ save: emptySave(), problem: 'unavailable' });
    expect(repo.write(emptySave())).toBe(false);
    const store = createSaveStore(repo);
    store.apply((s) => ({ ...s, sound: false }));
    expect(store.get().sound).toBe(false);
    expect(store.status()).toBe('error');
  });

  it('хранилище переполнено — данные остаются в памяти', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const store = createSaveStore(createLocalSaveRepository(() => full));
    store.apply((s) => ({ ...s, endless: { level: 3 } }));
    expect(store.get().endless.level).toBe(3);
    expect(store.status()).toBe('error');
  });
});

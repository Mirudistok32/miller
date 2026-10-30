import { describe, expect, it } from 'vitest';

import {
  createGame,
  type GameEvent,
  type GameView,
  PILOT_STEP,
  type Screen,
  WHEEL_SHOW,
} from '@/application/game';
import type { Cue } from '@/application/ports/sound';
import { createSaveStore } from '@/application/saveStore';
import { flow } from '@/domain/flow';
import { CCW, CW, rotsOf } from '@/domain/grid';
import { dailyLevel } from '@/domain/levels';
import { emptySave, type Save } from '@/domain/save';

const TODAY = '2026-10-30';

const memoryRepo = (initial: Save = emptySave()) => {
  let stored = initial;
  return {
    load: () => ({ save: stored, problem: null }),
    write: (s: Save) => ((stored = s), true),
    get stored() {
      return stored;
    },
  };
};

function setup(
  opts: {
    repo?: ReturnType<typeof memoryRepo>;
    test?: { seed: number; level: number; season: null };
    autoplay?: boolean;
    today?: string;
  } = {},
) {
  const screens: Screen[] = [];
  const cues: Cue[] = [];
  const events: GameEvent[] = [];
  const view: GameView = {
    frame: () => {},
    screen: (s) => screens.push(s),
    events: (e) => events.push(...e),
  };
  const repo = opts.repo ?? memoryRepo();
  const store = createSaveStore(repo);
  const game = createGame({
    store,
    view,
    sound: { play: (c) => cues.push(c), setEnabled: () => {} },
    clock: {
      nowIso: () => `${opts.today ?? TODAY}T12:00:00.000Z`,
      today: () => opts.today ?? TODAY,
    },
    test: opts.test ?? null,
    autoplay: opts.autoplay ?? false,
  });
  let ms = 0;
  /** Прокрутить время кадрами по 1/60 с. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) game.tick((ms += 1000 / 60));
  };
  game.tick(ms);
  return { game, store, repo, screens, cues, events, run };
}

/** Сыграть решение решателя кликами. */
function solveByClicks(game: ReturnType<typeof setup>['game']) {
  const s = game.session;
  if (!s) throw new Error('нет уровня');
  s.generated.solution.turns.forEach((t, cell) => {
    for (let k = 0; k < Math.abs(t); k++) game.rotate(cell, t < 0 ? CCW : CW);
  });
}

describe('игра', () => {
  it('в меню автопилот решает демо-уровни один за другим, сохранение не трогается', () => {
    const { game, store, run } = setup();
    expect(game.screen).toBe('menu');
    run(30);
    expect(game.session).toBeNull();
    expect(store.get()).toEqual(emptySave());
  });

  it('уровень дня: сегодняшняя дата, осень, часы идут с первого хода', () => {
    const { game, run } = setup();
    game.startDaily();
    expect(game.screen).toBe('playing');
    expect(game.session?.date).toBe(TODAY);
    expect(game.session?.season).toBe('autumn');
    expect(game.session?.generated).toEqual(dailyLevel(TODAY));
    run(3);
    expect(game.session?.play.time).toBe(0);
    const cell = game.session?.generated.solution.path[0] ?? 0;
    game.rotate(cell);
    run(2);
    expect(game.session?.play.moves).toBe(1);
    expect(game.session?.play.time).toBeCloseTo(2, 1);
  });

  it('пауза останавливает часы, продолжение — запускает', () => {
    const { game, run } = setup();
    game.startDaily();
    game.rotate(game.session?.generated.solution.path[0] ?? 0);
    run(1);
    game.pause();
    expect(game.screen).toBe('paused');
    const t = game.session?.play.time ?? 0;
    run(5);
    expect(game.session?.play.time).toBe(t);
    game.resume();
    run(1);
    expect(game.session?.play.time).toBeGreaterThan(t);
  });

  it('решение: колесо крутится, итог через паузу, результат записан один раз', () => {
    const { game, store, screens, cues, events, run } = setup();
    game.startDaily();
    const min = game.session?.generated.solution.moves ?? 0;
    solveByClicks(game);
    expect(game.session?.play.solved).toBe(true);
    expect(events.some((e) => e.type === 'solved')).toBe(true);
    expect(game.screen).toBe('playing');
    run(0.3);
    expect(game.screen).toBe('playing');
    run(WHEEL_SHOW + 2);
    expect(screens.at(-1)).toBe('solved');
    expect(cues).toContain('wheel');
    const saved = store.get();
    expect(saved.daily[TODAY]?.moves).toBe(min);
    expect(saved.daily[TODAY]?.min).toBe(min);
    expect(saved.stats.solved).toBe(1);
    expect(saved.achievements.daily).toBeDefined();
    expect(saved.achievements.perfect).toBeDefined();
    expect(game.ending?.record).toEqual({ time: true, extra: true });
    expect(game.ending?.streak).toBe(1);
    run(3);
    expect(store.get().stats.solved).toBe(1);
  });

  it('поворот после решения не считается', () => {
    const { game } = setup();
    game.startDaily();
    solveByClicks(game);
    const moves = game.session?.play.moves;
    game.rotate(0);
    expect(game.session?.play.moves).toBe(moves);
  });

  it('недоигранный уровень продолжается после перезагрузки: те же жёлоба, ходы и время', () => {
    const repo = memoryRepo();
    const first = setup({ repo });
    first.game.startDaily();
    const path = first.game.session?.generated.solution.path ?? [];
    first.game.rotate(path[0] ?? 0);
    first.game.rotate(path[1] ?? 0);
    first.run(4);
    first.game.persist();
    const rots = rotsOf(first.game.session?.play.board ?? dailyLevel(TODAY).board);

    const second = setup({ repo });
    second.game.startDaily();
    expect(rotsOf(second.game.session?.play.board ?? dailyLevel(TODAY).board)).toBe(rots);
    expect(second.game.session?.play.moves).toBe(2);
    expect(second.game.session?.play.time).toBeCloseTo(4, 0);
  });

  it('решённый уровень дня открывается решённым: колесо крутится, результат прежний', () => {
    const repo = memoryRepo();
    const first = setup({ repo });
    first.game.startDaily();
    solveByClicks(first.game);
    first.run(WHEEL_SHOW + 1);

    const second = setup({ repo });
    second.game.startDaily();
    expect(second.game.screen).toBe('solved');
    expect(second.game.ending?.revisit).toBe(true);
    expect(second.game.ending?.result.moves).toBe(first.game.ending?.result.moves);
    expect(flow(second.game.session?.play.board ?? dailyLevel(TODAY).board).solved).toBe(true);
    expect(repo.stored.stats.solved).toBe(1);
  });

  it('завтра — новый уровень дня', () => {
    const repo = memoryRepo();
    const today = setup({ repo });
    today.game.startDaily();
    solveByClicks(today.game);
    const tomorrow = setup({ repo, today: '2026-10-31' });
    tomorrow.game.startDaily();
    expect(tomorrow.game.screen).toBe('playing');
    expect(tomorrow.game.session?.date).toBe('2026-10-31');
  });

  it('бесконечный режим: решил — следующий уровень, сложность растёт', () => {
    const { game, store, run } = setup();
    game.startEndless();
    expect(game.session?.level).toBe(1);
    solveByClicks(game);
    run(WHEEL_SHOW + 1);
    expect(game.screen).toBe('solved');
    expect(store.get().endless.level).toBe(2);
    game.next();
    expect(game.screen).toBe('playing');
    expect(game.session?.level).toBe(2);
    expect(game.session?.season).toBe('spring');
  });

  it('заново: поле как на старте, ходы с нуля, попытка записана', () => {
    const { game, store } = setup();
    game.startDaily();
    const start = rotsOf(game.session?.play.board ?? dailyLevel(TODAY).board);
    game.rotate(game.session?.generated.solution.path[0] ?? 0);
    game.restart();
    expect(rotsOf(game.session?.play.board ?? dailyLevel(TODAY).board)).toBe(start);
    expect(game.session?.play.moves).toBe(0);
    expect(game.session?.play.attempts).toBe(2);
    expect(store.get().progress.daily?.attempts).toBe(2);
  });

  it('клавиатура: стрелки двигают курсор в пределах поля, Enter поворачивает', () => {
    const { game } = setup();
    game.startDaily();
    const s = game.session;
    if (!s) throw new Error('нет уровня');
    expect(game.cursor).toBeNull();
    game.moveCursor(0, 1);
    expect(game.cursor).toBe(s.generated.board.source + s.play.board.cols);
    for (let i = 0; i < 20; i++) game.moveCursor(-1, 0);
    expect(game.cursor).toBe(s.play.board.cols);
    for (let i = 0; i < 20; i++) game.moveCursor(0, -1);
    expect(game.cursor).toBe(0);
    const before = s.play.board.cells[0]?.rot;
    game.rotateCursor();
    if (s.play.board.cells[0]?.kind !== 'empty') {
      expect(s.play.board.cells[0]?.rot).toBe(((before ?? 0) + 1) % 4);
      expect(s.play.moves).toBe(1);
    }
  });

  it('против часовой: мышь и Enter, свой звук, сторона для анимации, ход один', () => {
    const { game, cues } = setup();
    game.startDaily();
    const s = game.session;
    if (!s) throw new Error('нет уровня');
    const cell = s.generated.solution.path[0] ?? 0;
    const rot = s.play.board.cells[cell]?.rot ?? 0;
    game.rotate(cell, CCW);
    expect(s.play.board.cells[cell]?.rot).toBe((rot + 3) % 4);
    expect(s.play.moves).toBe(1);
    expect(s.turnedSpin[cell]).toBe(CCW);
    expect(cues).toContain('turnBack');
    expect(cues).not.toContain('turn');
    game.rotateCursor(CCW);
    expect(s.play.moves).toBe(2);
    game.rotate(cell);
    expect(s.turnedSpin[cell]).toBe(CW);
    expect(cues).toContain('turn');
  });

  it('пустая клетка не поворачивается и не считается ходом', () => {
    const { game, cues } = setup();
    game.startDaily();
    const s = game.session;
    const empty = s?.play.board.cells.findIndex((c) => c.kind === 'empty') ?? -1;
    expect(empty).toBeGreaterThanOrEqual(0);
    game.rotate(empty);
    expect(s?.play.moves).toBe(0);
    expect(cues).toEqual(['blocked']);
  });

  it('?seed: тестовый уровень сразу на экране, итог не записывается', () => {
    const { game, store, run } = setup({ test: { seed: 7, level: 3, season: null } });
    expect(game.screen).toBe('playing');
    expect(game.session?.mode).toBe('test');
    solveByClicks(game);
    run(WHEEL_SHOW + 1);
    expect(game.screen).toBe('solved');
    expect(game.ending?.record).toBeNull();
    expect(store.get()).toEqual(emptySave());
    game.next();
    expect(game.session?.play.moves).toBe(0);
  });

  it('отмена: поле назад, ход остаётся, прогресс записан, после перезагрузки истории нет', () => {
    const repo = memoryRepo();
    const { game, store, events, cues } = setup({ repo });
    game.startEndless();
    const c = game.session?.generated.solution.path[0] ?? 0;
    const start = rotsOf(
      game.session?.play.board ?? { cols: 0, rows: 0, cells: [], source: 0, mill: 0 },
    );
    game.undo();
    expect(events.some((e) => e.type === 'nothing-to-undo')).toBe(true);
    expect(cues).toContain('blocked');
    game.rotate(c, CCW);
    game.undo();
    expect(game.session?.play.moves).toBe(1);
    expect(
      rotsOf(game.session?.play.board ?? { cols: 0, rows: 0, cells: [], source: 0, mill: 0 }),
    ).toBe(start);
    expect(events.some((e) => e.type === 'undo' && e.cell === c)).toBe(true);
    expect(store.get().progress.endless?.rots).toBe(start);
    expect(store.get().progress.endless?.moves).toBe(1);
    game.rotate(c);
    const again = setup({ repo });
    again.game.startEndless();
    expect(again.game.session?.play.moves).toBe(2);
    expect(again.game.session?.play.history).toEqual([]);
  });

  it('подсказка: поле не крутит, считается один раз, гаснет с ходом, переживает заново', () => {
    const repo = memoryRepo();
    const { game, store, events } = setup({ repo });
    game.startEndless();
    const s = game.session;
    if (!s) throw new Error('нет уровня');
    const before = rotsOf(s.play.board);
    game.hint();
    game.hint();
    expect(s.play.hints).toBe(1);
    expect(s.play.moves).toBe(0);
    expect(s.play.started).toBe(false);
    expect(rotsOf(s.play.board)).toBe(before);
    expect(s.hint).not.toBeNull();
    expect(events.filter((e) => e.type === 'hint')).toHaveLength(2);
    expect(store.get().progress.endless?.hints).toBe(1);
    const move = s.hint;
    if (!move) throw new Error('нет подсказки');
    game.rotate(move.cell, move.spin);
    expect(s.hint).toBeNull();
    game.hint();
    expect(s.play.hints).toBe(2);
    game.restart();
    expect(s.hint).toBeNull();
    expect(s.play.hints).toBe(2);
    // перезагрузка не снимает цену подсказки
    const again = setup({ repo });
    again.game.startEndless();
    expect(again.game.session?.play.hints).toBe(2);
  });

  it('подсказка до первого хода не теряется при перезагрузке', () => {
    const repo = memoryRepo();
    const first = setup({ repo });
    first.game.startDaily();
    first.game.hint();
    const again = setup({ repo });
    again.game.startDaily();
    expect(again.game.session?.play.hints).toBe(1);
  });

  it('решение с подсказкой записано честно: без «perfect», счётчик в итоге', () => {
    const { game, store, run } = setup();
    game.startDaily();
    game.hint();
    solveByClicks(game);
    run(WHEEL_SHOW + 2);
    expect(game.screen).toBe('solved');
    expect(game.ending?.result.hints).toBe(1);
    expect(game.ending?.unlocked).not.toContain('perfect');
    expect(store.get().stats.perfect).toBe(0);
    expect(store.get().daily[TODAY]?.hints).toBe(1);
    game.open('menu');
    game.startDaily();
    expect(game.ending?.revisit).toBe(true);
    expect(game.ending?.result.hints).toBe(1);
  });

  it('автопилот и пауза отмену не принимают', () => {
    const { game } = setup({ autoplay: true, test: { seed: 1, level: 6, season: null } });
    game.undo();
    expect(game.session?.play.moves).toBe(0);
    const paused = setup();
    paused.game.startEndless();
    paused.game.rotate(paused.game.session?.generated.solution.path[0] ?? 0);
    paused.game.pause();
    paused.game.undo();
    expect(paused.game.session?.play.history).toHaveLength(1);
  });

  it('автопилот крутит короткой стороной: решает ровно за минимум ходов', () => {
    const { game, run } = setup({ autoplay: true, test: { seed: 12345, level: 30, season: null } });
    const min = game.session?.generated.solution.moves ?? 0;
    expect(game.session?.generated.solution.turns.some((t) => t < 0)).toBe(true);
    run((min + 3) * PILOT_STEP);
    expect(game.session?.play.solved).toBe(true);
    expect(game.session?.play.moves).toBe(min);
  });

  it('?autoplay: автопилот решает уровень сам, ничего не записывается', () => {
    const { game, store, run } = setup({ autoplay: true });
    game.startEndless();
    const moves = game.session?.generated.solution.moves ?? 0;
    game.rotate(0);
    expect(game.session?.play.moves).toBe(0);
    run(moves * PILOT_STEP + WHEEL_SHOW + 2);
    expect(game.screen).toBe('solved');
    expect(game.ending?.autopilot).toBe(true);
    expect(game.ending?.result.moves).toBe(moves);
    expect(store.get()).toEqual(emptySave());
  });

  it('выход в меню записывает недоигранный уровень', () => {
    const { game, store } = setup();
    game.startEndless();
    game.rotate(game.session?.generated.solution.path[0] ?? 0);
    game.open('menu');
    expect(store.get().progress.endless?.moves).toBe(1);
    expect(game.session).toBeNull();
  });

  it('звук переключается и запоминается', () => {
    const { game, store } = setup();
    expect(game.toggleSound()).toBe(false);
    expect(store.get().sound).toBe(false);
  });
});

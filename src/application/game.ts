/**
 * Игра целиком без DOM: экраны, режимы (уровень дня, бесконечный, тестовый по ?seed), демо
 * в меню, автопилот (?autoplay), часы партии, запись итога и недоигранного уровня, звук по
 * событиям. Вид получает кадры, смены экранов и события колбэками.
 */

import type { AchievementId } from '@/domain/achievements';
import { monthOfKey } from '@/domain/calendar';
import { type Flow, flow, FLOW_CELL, wetTimes } from '@/domain/flow';
import { generateLevel, type Level } from '@/domain/generator';
import {
  CCW,
  cellOf,
  colOf,
  CW,
  maskOf,
  millIndex,
  rotsOf,
  rowOf,
  type Spin,
  withRots,
} from '@/domain/grid';
import {
  dailyKey,
  dailyLevel,
  demoLevel,
  endlessKey,
  endlessLevel,
  endlessParams,
  sizeKey,
} from '@/domain/levels';
import {
  advance,
  countHint,
  type Play,
  restartPlay,
  rotateAt,
  startPlay,
  undoPlay,
} from '@/domain/play';
import { type Mode, roundTime, type SolveResult } from '@/domain/result';
import {
  type Best,
  type Progress,
  recordSolve,
  streakAt,
  type Theme,
  withProgress,
} from '@/domain/save';
import { type Season, seasonOfLevel, seasonOfMonth } from '@/domain/season';
import { applyTurns, type HintMove, hintMove } from '@/domain/solver';

import type { Clock } from './ports/clock';
import type { Sound } from './ports/sound';
import type { SaveStore } from './saveStore';

/** Сколько длится поворот жёлоба на экране, с: вода в него идёт после. */
export const TURN_TIME = 0.12;
/** Сколько колесо крутится, прежде чем откроется итог, с. */
export const WHEEL_SHOW = 1.6;
/** Пауза между ходами автопилота, с. */
export const PILOT_STEP = 0.4;
/** Демо в меню: сколько решённое поле стоит, прежде чем начнётся новое, с. */
export const DEMO_REST = 2.4;
/** Как часто записывать время недоигранного уровня, с. */
export const SAVE_EVERY = 5;
const MAX_FRAME = 0.1;

export type Screen = 'menu' | 'help' | 'achievements' | 'playing' | 'paused' | 'solved';
export type SessionMode = Mode | 'test' | 'demo';

export interface Session {
  mode: SessionMode;
  /** Ключ недоигранного уровня в сохранении. */
  key: string;
  date: string | null;
  level: number | null;
  season: Season;
  /** Уровень как сгенерирован: поле на старте, минимум ходов, решение для автопилота. */
  generated: Level;
  play: Play;
  flow: Flow;
  /** Когда вода пришла в каждую клетку (секунды игры); Infinity — сухо. */
  wet: number[];
  /** Когда клетку поворачивали в последний раз — для анимации поворота. */
  turnedAt: number[];
  /** Куда клетку поворачивали в последний раз — для анимации поворота. */
  turnedSpin: Spin[];
  /** Подсказка на поле: гаснет с любым поворотом; null — подсказки нет. */
  hint: HintMove | null;
  /** Когда вода упала на колесо; null — колесо стоит. */
  wheelAt: number | null;
  /** Когда открыть экран итога; null — уровень не решён. */
  endAt: number | null;
}

export interface Ending {
  mode: Exclude<SessionMode, 'demo'>;
  result: SolveResult;
  unlocked: AchievementId[];
  /** Побит ли рекорд; null — итог не записывался (тест, автопилот, повторный показ). */
  record: { time: boolean; extra: boolean } | null;
  best: Best | null;
  /** Серия уровня дня, дней подряд. */
  streak: number;
  /** Решал автопилот (?autoplay): итог показан, но не записан. */
  autopilot: boolean;
  /** Уровень дня уже был решён: показан записанный результат. */
  revisit: boolean;
}

export interface Frame {
  session: Session;
  /** Секунды с запуска — для воды, колеса и погоды. */
  time: number;
  /** Клетка под курсором клавиатуры; null — курсор спрятан. */
  cursor: number | null;
  demo: boolean;
}

export type GameEvent =
  | { type: 'turn'; cell: number; moves: number; wet: number }
  | { type: 'blocked'; cell: number }
  | { type: 'cursor'; cell: number }
  | { type: 'hint'; cell: number; spin: Spin; hints: number }
  | { type: 'undo'; cell: number }
  | { type: 'nothing-to-undo' }
  | { type: 'restart' }
  | { type: 'solved'; moves: number; time: number };

export interface GameView {
  frame(frame: Frame): void;
  screen(screen: Screen, ending: Ending | null): void;
  events(events: readonly GameEvent[]): void;
}

export interface TestLevel {
  seed: number;
  /** Сложность как у уровня бесконечного режима с этим номером. */
  level: number;
  season: Season | null;
}

const DEMO_SCREENS: readonly Screen[] = ['menu', 'help', 'achievements'];

export function createGame(deps: {
  store: SaveStore;
  sound: Sound;
  clock: Clock;
  view: GameView;
  /** ?seed=…: сразу открыть тестовый уровень; итог не записывается. */
  test?: TestLevel | null;
  /** ?autoplay: уровни решает автопилот, итог не записывается. */
  autoplay?: boolean;
}) {
  const { store, sound, clock, view } = deps;
  const test = deps.test ?? null;
  const piloted = deps.autoplay ?? false;

  let screen: Screen = 'menu';
  let session: Session | null = null;
  let demo: Session | null = null;
  let demoRound = 0;
  let ending: Ending | null = null;
  let time = 0;
  let last: number | null = null;
  let pilotClock = 0;
  let sinceSave = 0;
  let wheelHeard = true;
  let cursor = 0;
  let cursorShown = false;
  sound.setEnabled(store.get().sound);

  const show = (next: Screen) => {
    screen = next;
    view.screen(next, ending);
  };

  const makeSession = (
    mode: SessionMode,
    key: string,
    generated: Level,
    where: { date?: string; level?: number; season: Season },
    play: Play = startPlay(generated.board),
  ): Session => {
    const f = flow(play.board);
    return {
      mode,
      key,
      date: where.date ?? null,
      level: where.level ?? null,
      season: where.season,
      generated,
      play,
      flow: f,
      wet: wetTimes(null, f, time),
      turnedAt: generated.board.cells.map(() => -Infinity),
      turnedSpin: generated.board.cells.map(() => CW),
      hint: null,
      wheelAt: null,
      endAt: null,
    };
  };

  const begin = (next: Session) => {
    session = next;
    ending = null;
    cursor = next.generated.board.source;
    cursorShown = false;
    pilotClock = 0;
    sinceSave = 0;
    wheelHeard = true;
    show('playing');
  };

  /** Недоигранный уровень из сохранения, если он этого же уровня и читается. */
  const restore = (mode: Mode, key: string, level: Level): Play => {
    const fresh = startPlay(level.board);
    const p = piloted ? undefined : store.get().progress[mode];
    if (!p || p.key !== key) return fresh;
    const board = withRots(level.board, p.rots);
    if (!board || flow(board).solved) return fresh;
    return {
      ...fresh,
      board,
      moves: p.moves,
      time: p.time,
      started: p.started,
      attempts: p.attempts,
      hints: p.hints ?? 0,
    };
  };

  const persist = (s: Session | null) => {
    if (!s || piloted || s.play.solved) return;
    const mode = s.mode;
    if (mode !== 'daily' && mode !== 'endless') return;
    const p = s.play;
    if (!p.started && p.attempts === 1 && p.hints === 0 && !store.get().progress[mode]) return;
    const progress: Progress = {
      key: s.key,
      rots: rotsOf(p.board),
      moves: p.moves,
      time: roundTime(p.time),
      started: p.started,
      attempts: p.attempts,
      ...(p.hints > 0 ? { hints: p.hints } : {}),
    };
    store.apply((save) => withProgress(save, mode, progress));
    sinceSave = 0;
  };

  const resultOf = (s: Session): SolveResult => ({
    mode: s.mode === 'daily' ? 'daily' : 'endless',
    date: s.date,
    level: s.level,
    size: sizeKey(s.generated.params),
    moves: s.play.moves,
    minMoves: s.generated.solution.moves,
    time: roundTime(s.play.time),
    attempts: s.play.attempts,
    hints: s.play.hints,
    dry: s.flow.leaks.length === 0,
    season: s.season,
    rots: rotsOf(s.play.board),
  });

  /** Вода дошла до колеса: время колеса и итога, запись результата. */
  const solved = (s: Session) => {
    s.wheelAt = (s.wet[millIndex(s.play.board)] ?? time) + FLOW_CELL;
    s.endAt = s.wheelAt + WHEEL_SHOW;
    if (s.mode === 'demo') return;
    wheelHeard = false;
    const result = resultOf(s);
    const mode = s.mode;
    if (mode === 'test' || piloted) {
      ending = {
        mode,
        result,
        unlocked: [],
        record: null,
        best: null,
        streak: 0,
        autopilot: piloted,
        revisit: false,
      };
    } else {
      const recorded = recordSolve(store.get(), result, clock.nowIso());
      store.apply(() => recorded.save);
      ending = {
        mode,
        result,
        unlocked: recorded.unlocked,
        record: recorded.record,
        best: recorded.best,
        streak: recorded.streak,
        autopilot: false,
        revisit: false,
      };
    }
    view.events([{ type: 'solved', moves: result.moves, time: result.time }]);
  };

  /** Новое состояние партии после поворота клетки; возвращает клетки, куда пришла вода. */
  const place = (s: Session, next: Play, cell: number, spin: Spin) => {
    const f = flow(next.board);
    const wet = wetTimes(s.wet, f, time + TURN_TIME);
    const fresh = wet.filter((t, i) => Number.isFinite(t) && !Number.isFinite(s.wet[i] ?? 0));
    s.play = next;
    s.flow = f;
    s.wet = wet;
    s.turnedAt[cell] = time;
    s.turnedSpin[cell] = spin;
    s.hint = null;
    return fresh;
  };

  /** Поворот клетки; byPlayer — нажал человек (звук и объявления, запись прогресса). */
  const turn = (s: Session, cell: number, byPlayer: boolean, spin: Spin = CW) => {
    const loud = s.mode !== 'demo';
    const next = rotateAt(s.play, cell, spin);
    if (!next) {
      if (byPlayer) {
        sound.play('blocked');
        view.events([{ type: 'blocked', cell }]);
      }
      return;
    }
    const fresh = place(s, next, cell, spin);
    if (loud) {
      sound.play(spin === CW ? 'turn' : 'turnBack');
      if (fresh.length > 0) sound.play('trickle');
      view.events([{ type: 'turn', cell, moves: next.moves, wet: fresh.length }]);
    }
    if (next.solved) solved(s);
    else if (byPlayer) persist(s);
  };

  /** Автопилот: следующая клетка пути решения, которая ещё стоит не так; крутит короткой стороной. */
  const pilotStep = (s: Session) => {
    const target = applyTurns(s.generated.board, s.generated.solution.turns);
    for (const c of s.generated.solution.path) {
      const now = cellOf(s.play.board, c);
      const goal = cellOf(target, c);
      if (maskOf(now) !== maskOf(goal)) {
        turn(s, c, false, (goal.rot - now.rot + 4) % 4 === 3 ? CCW : CW);
        return;
      }
    }
  };

  const pilot = (s: Session, dt: number) => {
    pilotClock += dt;
    if (pilotClock < PILOT_STEP) return;
    pilotClock = 0;
    if (!s.play.solved) pilotStep(s);
  };

  const nextDemo = () => {
    const level = demoLevel(demoRound++);
    const season = seasonOfMonth(monthOfKey(clock.today()));
    demo = makeSession('demo', 'demo', level, { season });
    pilotClock = -0.8; // дать разглядеть поле перед первым ходом
  };

  const startTest = () => {
    if (!test) return;
    const level = generateLevel(test.seed, endlessParams(test.level));
    begin(
      makeSession('test', `test:${test.seed}:${test.level}`, level, {
        level: test.level,
        season: test.season ?? seasonOfLevel(test.level),
      }),
    );
  };

  const startDaily = () => {
    const date = clock.today();
    const level = dailyLevel(date);
    const season = seasonOfMonth(monthOfKey(date));
    const key = dailyKey(date);
    const done = piloted ? undefined : store.get().daily[date];
    if (!done) {
      begin(makeSession('daily', key, level, { date, season }, restore('daily', key, level)));
      return;
    }
    // Уже решён: показать решённое поле с крутящимся колесом и записанный результат.
    const stored = withRots(level.board, done.rots);
    const board =
      stored && flow(stored).solved ? stored : applyTurns(level.board, level.solution.turns);
    const play: Play = {
      ...startPlay(level.board),
      board,
      moves: done.moves,
      time: done.time,
      started: true,
      attempts: done.attempts,
      hints: done.hints ?? 0,
      solved: true,
    };
    const s = makeSession('daily', key, level, { date, season }, play);
    s.wheelAt = (s.wet[millIndex(board)] ?? time) + FLOW_CELL;
    s.endAt = time;
    session = s;
    const save = store.get();
    ending = {
      mode: 'daily',
      result: {
        mode: 'daily',
        date,
        level: null,
        size: sizeKey(level.params),
        moves: done.moves,
        minMoves: done.min,
        time: done.time,
        attempts: done.attempts,
        hints: done.hints ?? 0,
        dry: s.flow.leaks.length === 0,
        season,
        rots: done.rots,
      },
      unlocked: [],
      record: null,
      best: save.best.daily ?? null,
      streak: streakAt(save, date),
      autopilot: false,
      revisit: true,
    };
    show('solved');
  };

  const startEndless = () => {
    const n = store.get().endless.level;
    const level = endlessLevel(n);
    const key = endlessKey(n);
    begin(
      makeSession(
        'endless',
        key,
        level,
        { level: n, season: seasonOfLevel(n) },
        restore('endless', key, level),
      ),
    );
  };

  if (test) startTest();

  return {
    get screen() {
      return screen;
    },
    get session() {
      return session;
    },
    get ending() {
      return ending;
    },
    get cursor() {
      return cursorShown ? cursor : null;
    },
    get test() {
      return test;
    },

    /** Кадр анимации: ms — время из requestAnimationFrame. */
    tick(ms: number) {
      const dt = last === null ? 0 : Math.min(MAX_FRAME, Math.max(0, (ms - last) / 1000));
      last = ms;
      time += dt;
      const inMenu = DEMO_SCREENS.includes(screen);
      if (inMenu) {
        if (!demo) nextDemo();
        if (demo) {
          if (!demo.play.solved) pilot(demo, dt);
          else if (time >= (demo.endAt ?? time) - WHEEL_SHOW + DEMO_REST) nextDemo();
        }
      }
      const s = session;
      if (screen === 'playing' && s) {
        if (!s.play.solved) {
          s.play = advance(s.play, dt);
          if (piloted) pilot(s, dt);
          sinceSave += dt;
          if (sinceSave >= SAVE_EVERY) persist(s);
        } else if (s.endAt !== null && time >= s.endAt) {
          show('solved');
          if (ending && ending.unlocked.length > 0) sound.play('unlock');
        }
      }
      if (s && !wheelHeard && s.wheelAt !== null && time >= s.wheelAt) {
        wheelHeard = true;
        sound.play('wheel');
      }
      const shown = inMenu ? demo : s;
      if (shown) {
        view.frame({
          session: shown,
          time,
          cursor: !inMenu && cursorShown ? cursor : null,
          demo: inMenu,
        });
      }
    },

    startDaily,
    startEndless,
    /** После итога: бесконечный — следующий уровень, тест — ещё раз, уровень дня — меню. */
    next() {
      const mode = ending?.mode;
      if (mode === 'endless') startEndless();
      else if (mode === 'test') startTest();
      else this.open('menu');
    },
    /** Нажатие по клетке мышью или пальцем. */
    rotate(cell: number, spin: Spin = CW) {
      const s = session;
      if (screen !== 'playing' || !s || piloted || s.play.solved) return;
      cursor = cell;
      cursorShown = false;
      turn(s, cell, true, spin);
    },
    /** Стрелки: курсор по полю. */
    moveCursor(dx: number, dy: number) {
      const s = session;
      if (screen !== 'playing' || !s) return;
      const b = s.play.board;
      const x = Math.min(b.cols - 1, Math.max(0, colOf(b, cursor) + dx));
      const y = Math.min(b.rows - 1, Math.max(0, rowOf(b, cursor) + dy));
      cursor = y * b.cols + x;
      cursorShown = true;
      view.events([{ type: 'cursor', cell: cursor }]);
    },
    /** Enter: повернуть клетку под курсором; Shift+Enter — против часовой. */
    rotateCursor(spin: Spin = CW) {
      const s = session;
      if (screen !== 'playing' || !s || piloted || s.play.solved) return;
      cursorShown = true;
      turn(s, cursor, true, spin);
    },
    /** H, кнопка: подсветить ход от текущего поля. Пока подсказка на поле, новая не считается. */
    hint() {
      const s = session;
      if (screen !== 'playing' || !s || piloted || s.play.solved) return;
      const move = s.hint ?? hintMove(s.play.board);
      if (!move) return;
      if (!s.hint) {
        s.hint = move;
        s.play = countHint(s.play);
        persist(s);
      }
      if (cursorShown) cursor = move.cell;
      view.events([{ type: 'hint', ...move, hints: s.play.hints }]);
    },
    /** Z, Ctrl+Z, кнопка: вернуть последний поворот; ход и время не возвращаются. */
    undo() {
      const s = session;
      if (screen !== 'playing' || !s || piloted || s.play.solved) return;
      const last = s.play.history.at(-1);
      const next = undoPlay(s.play);
      if (!last || !next) {
        sound.play('blocked');
        view.events([{ type: 'nothing-to-undo' }]);
        return;
      }
      const spin = last.spin === CW ? CCW : CW;
      place(s, next, last.cell, spin);
      sound.play(spin === CW ? 'turn' : 'turnBack');
      view.events([{ type: 'undo', cell: last.cell }]);
      persist(s);
    },
    restart() {
      const s = session;
      if (!s || s.play.solved || (screen !== 'playing' && screen !== 'paused')) return;
      s.play = restartPlay(s.play);
      s.flow = flow(s.play.board);
      s.wet = wetTimes(null, s.flow, time);
      s.turnedAt = s.turnedAt.map(() => -Infinity);
      s.hint = null;
      pilotClock = 0;
      persist(s);
      show('playing');
      view.events([{ type: 'restart' }]);
    },
    pause() {
      if (screen !== 'playing' || !session || session.play.solved) return;
      persist(session);
      show('paused');
    },
    resume() {
      if (screen !== 'paused') return;
      last = null;
      show('playing');
    },
    togglePause() {
      if (screen === 'paused') this.resume();
      else this.pause();
    },
    /** Записать недоигранный уровень сейчас: вкладку прячут или закрывают. */
    persist() {
      persist(session);
    },
    open(next: 'menu' | 'help' | 'achievements') {
      if (!DEMO_SCREENS.includes(screen)) {
        persist(session);
        session = null;
        ending = null;
      }
      show(next);
    },
    toggleSound(): boolean {
      const on = !store.get().sound;
      store.apply((s) => ({ ...s, sound: on }));
      sound.setEnabled(on);
      return on;
    },
    setTheme(theme: Theme) {
      store.apply((s) => ({ ...s, theme }));
    },
  };
}

export type Game = ReturnType<typeof createGame>;

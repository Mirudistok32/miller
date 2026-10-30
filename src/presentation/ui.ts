/**
 * DOM вокруг холста: экраны, HUD, раскладка поля под панели, ввод (мышь, палец, клавиатура),
 * фокус и объявления для скринридеров. Тексты экранов — в index.html, подписи на лету —
 * в content/texts.ts.
 */

import { exportBackup, importBackup } from '@/application/backup';
import type { Ending, Frame, Game, GameEvent, GameView, Screen, Session } from '@/application/game';
import type { Clock } from '@/application/ports/clock';
import type { SaveStore } from '@/application/saveStore';
import {
  ACHIEVEMENTS,
  BACKUP_PROBLEMS,
  clock as clockText,
  dayMonth,
  days,
  moves as movesText,
  plural,
  SEASON_NAMES,
  shareText,
  sizeLabel,
} from '@/content/texts';
import { ACHIEVEMENT_IDS, type AchievementId } from '@/domain/achievements';
import { CCW, cellOf, colOf, CW, DIRS, E, maskOf, N, rotsOf, rowOf, S, W } from '@/domain/grid';
import { DEMO_PARAMS, endlessParams } from '@/domain/levels';
import type { Theme } from '@/domain/save';

import { copyText, downloadText } from './files';
import { cellAt, computeLayout, NO_RESERVE, type Reserve } from './layout';
import type { Renderer } from './render';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`нет элемента #${id}`);
  return el as T;
};

const SCREENS: readonly Screen[] = ['menu', 'help', 'achievements', 'paused', 'solved'];
const BOARD_SCREENS: readonly Screen[] = ['playing', 'paused', 'solved'];
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = {
  system: 'Тема: как в системе',
  light: 'Тема: светлая',
  dark: 'Тема: тёмная',
};
/** Сколько держать палец, чтобы нажатие стало поворотом против часовой, мс. */
const LONG_PRESS = 400;
/** На сколько палец может дрогнуть, пока это ещё нажатие, а не сдвиг, CSS-пиксели. */
const PRESS_SLOP = 12;
/** Те же условия, что в styles.css: где HUD — колонкой слева, где меню — слева от поля. */
const HUD_SIDE = '(orientation: landscape) and (min-width: 640px)';
const MENU_SIDE = '(min-width: 800px) and (orientation: landscape)';

const SIDE_NAMES: Record<number, string> = {
  [N]: 'вверх',
  [E]: 'вправо',
  [S]: 'вниз',
  [W]: 'влево',
};
const KIND_NAMES = { straight: 'прямой жёлоб', corner: 'угол', tee: 'развилка', empty: 'пусто' };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Всплывашка сверху на пару секунд. */
function toast(text: string) {
  const node = el('div', 'toast', text);
  $('toasts').append(node);
  setTimeout(() => node.remove(), 2600);
}

/** Подписи кнопок звука в меню и в HUD. */
function syncSound(on: boolean) {
  const button = $('btn-sound');
  button.textContent = on ? 'Звук: включён' : 'Звук: выключен';
  button.setAttribute('aria-pressed', String(on));
  $('hud-sound').setAttribute('aria-pressed', String(on));
  $('hud-sound').setAttribute('aria-label', on ? 'Звук включён (M)' : 'Звук выключен (M)');
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Подпись уровня: «Уровень дня · 30 октября», «Уровень 7 · поле 6×6». */
function levelTitle(s: Session): string {
  if (s.mode === 'daily' && s.date) return `Уровень дня · ${dayMonth(s.date)}`;
  const size = sizeLabel(`${s.generated.params.cols}x${s.generated.params.rows}`);
  if (s.mode === 'test') return `Тестовый уровень · сид ${s.generated.seed} · ${size}`;
  return `Уровень ${s.level ?? 1} · поле ${size}`;
}

export interface View extends GameView {
  /** Пересчитать раскладку: окно изменилось или сменился экран. */
  fit(): void;
  /** Клетка под мышью — подсветка. */
  setHover(cell: number | null): void;
  readonly shown: Screen;
}

export function createView(deps: { renderer: Renderer; store: SaveStore; clock: Clock }): View {
  const { renderer, store, clock } = deps;
  const hud = $('hud');
  const hint = $('hint');
  const stage = $('stage');
  const canvas = $('scene');
  const announcer = $('announcer');
  const hudSide = matchMedia(HUD_SIDE);
  const menuSide = matchMedia(MENU_SIDE);
  let shown: Screen = 'menu';
  let session: Session | null = null;
  let board = { cols: DEMO_PARAMS.cols, rows: DEMO_PARAMS.rows };
  let hover: number | null = null;
  let hudReserve: Reserve = NO_RESERVE;
  let menuReserve: Reserve = NO_RESERVE;
  const last = {
    moves: -1,
    time: '',
    title: '',
    rots: '',
    hint: false,
    cursor: -2,
    undoable: false,
    hintCell: -2,
  };

  const announce = (text: string) => {
    announcer.textContent = '';
    requestAnimationFrame(() => (announcer.textContent = text));
  };

  /** Сколько места занимают панели: HUD во время игры, карточка меню на широком экране. */
  const reserve = (): Reserve => {
    if (BOARD_SCREENS.includes(shown)) {
      if (!hud.hidden) {
        const r = hud.getBoundingClientRect();
        hudReserve = hudSide.matches
          ? { ...NO_RESERVE, left: r.right + 8 }
          : { ...NO_RESERVE, top: r.bottom + 8 };
      }
      return hudReserve;
    }
    if (!menuSide.matches) return NO_RESERVE;
    const card = document.querySelector<HTMLElement>('#screen-menu .card');
    if (shown === 'menu' && card) {
      menuReserve = { ...NO_RESERVE, left: card.getBoundingClientRect().right + 16 };
    }
    return menuReserve;
  };

  const fit = () => {
    const layout = computeLayout(
      { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      board,
      reserve(),
    );
    const prev = renderer.layout;
    if (
      !prev ||
      prev.width !== layout.width ||
      prev.height !== layout.height ||
      prev.scale !== layout.scale ||
      prev.boardX !== layout.boardX ||
      prev.boardY !== layout.boardY ||
      prev.cols !== layout.cols ||
      prev.rows !== layout.rows
    ) {
      renderer.setLayout(layout);
    }
    // Геометрия поля — для e2e и отладки: где клетки в CSS-пикселях.
    stage.dataset.cols = String(layout.cols);
    stage.dataset.rows = String(layout.rows);
    stage.dataset.cell = String(16 * layout.scale);
    stage.dataset.left = String(layout.boardX * layout.scale);
    stage.dataset.top = String(layout.boardY * layout.scale);
  };

  const describeCell = (s: Session, cell: number): string => {
    const c = cellOf(s.play.board, cell);
    const where = `Ряд ${rowOf(s.play.board, cell) + 1}, столбец ${colOf(s.play.board, cell) + 1}`;
    if (c.kind === 'empty') return `${where}: пусто, жёлоба нет.`;
    const sides = DIRS.filter((d) => maskOf(c) & d)
      .map((d) => SIDE_NAMES[d])
      .join(', ');
    const wet = (s.flow.dist[cell] ?? -1) >= 0 ? ' Вода есть.' : '';
    return `${where}: ${KIND_NAMES[c.kind]}, открыт ${sides}.${wet}`;
  };

  const updateHud = (frame: Frame) => {
    const s = frame.session;
    const p = s.play;
    if (p.moves !== last.moves) $('hud-moves').textContent = String((last.moves = p.moves));
    const time = clockText(p.time);
    if (time !== last.time) $('hud-time').textContent = last.time = time;
    const title = levelTitle(s);
    if (title !== last.title) {
      $('hud-title').textContent = last.title = title;
      const b = s.play.board;
      canvas.setAttribute(
        'aria-label',
        `${title}. Поле ${b.cols} на ${b.rows}: родник над ${b.source + 1}-м столбцом, мельница под ${b.mill + 1}-м. Стрелки — выбрать клетку, Enter — повернуть жёлоб, Shift+Enter — повернуть обратно.`,
      );
    }
    const showHint =
      shown === 'playing' &&
      !p.started &&
      !p.solved &&
      p.hints === 0 &&
      s.mode !== 'demo' &&
      store.get().stats.solved === 0;
    if (showHint !== last.hint) hint.hidden = !(last.hint = showHint);
    const undoable = p.history.length > 0 && !p.solved;
    if (undoable !== last.undoable)
      $<HTMLButtonElement>('hud-undo').disabled = !(last.undoable = undoable);
    const hintCell = s.hint?.cell ?? -1;
    if (hintCell !== last.hintCell) stage.dataset.hint = String((last.hintCell = hintCell));
    const rots = rotsOf(p.board);
    if (rots !== last.rots) stage.dataset.rots = last.rots = rots;
    stage.dataset.moves = String(p.moves);
    const cursor = frame.cursor ?? -1;
    if (cursor !== last.cursor) stage.dataset.cursor = String((last.cursor = cursor));
  };

  const fillMenu = () => {
    const save = store.get();
    const today = clock.today();
    const done = save.daily[today];
    const started = save.progress.daily?.key.endsWith(today);
    $('daily-note').textContent = done
      ? `${dayMonth(today)} · решён: ${movesText(done.moves)}, ${clockText(done.time)}`
      : started
        ? `${dayMonth(today)} · начат, можно продолжить`
        : `${dayMonth(today)} · один на всех, новый каждый день`;
    const level = save.endless.level;
    const p = endlessParams(level);
    $('endless-note').textContent =
      `Уровень ${level} · поле ${p.cols}×${p.rows}` + (save.progress.endless ? ' · начат' : '');
    const open = ACHIEVEMENT_IDS.filter((id) => save.achievements[id]).length;
    $('ach-count').textContent = `${open} из ${ACHIEVEMENT_IDS.length}`;
    syncSound(save.sound);
    $('btn-theme').textContent = THEME_LABEL[save.theme];
    const notice = $('save-notice');
    const problem =
      store.problem === 'corrupt'
        ? 'Прежнее сохранение не прочиталось, игра начата заново. Старые данные не стёрты: они отложены в браузере отдельно.'
        : store.problem === 'unavailable' || store.status() === 'error'
          ? 'Браузер не даёт сохранять: рекорды и ачивки проживут до закрытия вкладки. Копию можно скачать на экране ачивок.'
          : '';
    notice.textContent = problem;
    notice.classList.toggle('error', problem !== '');
    notice.hidden = problem === '';
  };

  const achievementItem = (id: AchievementId, open: boolean) => {
    const li = el('li', open ? 'ach open' : 'ach');
    li.append(
      el('span', 'ach-mark', open ? '✓' : '?'),
      el('span', 'ach-title', ACHIEVEMENTS[id].title),
      el(
        'span',
        'ach-desc',
        open ? ACHIEVEMENTS[id].desc : `${ACHIEVEMENTS[id].desc} — пока не открыта`,
      ),
    );
    return li;
  };

  const rows = (list: [string, string, boolean?][]) =>
    list.flatMap(([k, v, total]) => [
      el('dt', total ? 'total' : '', k),
      el('dd', total ? 'total' : '', v),
    ]);

  const fillAchievements = () => {
    const save = store.get();
    $('ach-list').replaceChildren(
      ...ACHIEVEMENT_IDS.map((id) => achievementItem(id, !!save.achievements[id])),
    );
    const daily = save.best.daily;
    const list: [string, string][] = [
      ['Уровень дня: лучшее время', daily ? clockText(daily.time) : '—'],
      ['Уровень дня: лишних ходов', daily ? String(daily.extra ?? '—') : '—'],
      ['Лучшая серия', save.stats.bestStreak > 0 ? days(save.stats.bestStreak) : '—'],
      ['Бесконечный: пройдено', String(save.endless.level - 1)],
    ];
    const sizes = Object.keys(save.best)
      .filter((k) => k !== 'daily')
      .sort();
    for (const size of sizes) {
      const best = save.best[size];
      if (best)
        list.push([
          `Поле ${sizeLabel(size)}`,
          `${clockText(best.time)} · лишних ${best.extra ?? '—'}`,
        ]);
    }
    list.push(['Решено уровней', String(save.stats.solved)]);
    $('records').replaceChildren(...rows(list));
  };

  const fillSolved = (ending: Ending) => {
    const r = ending.result;
    const mode =
      ending.mode === 'daily' && r.date
        ? `Уровень дня · ${dayMonth(r.date)}`
        : ending.mode === 'test'
          ? 'Тестовый уровень'
          : `Уровень ${r.level ?? 1} · ${SEASON_NAMES[r.season].toLowerCase()}`;
    $('solved-mode').textContent = ending.autopilot ? `${mode} · решал автопилот` : mode;
    const record = $('solved-record');
    const rec = ending.record;
    record.hidden = !rec || (!rec.time && !rec.extra);
    record.textContent = rec?.time ? 'Новый рекорд времени' : 'Новый рекорд: меньше лишних ходов';
    const list: [string, string, boolean?][] = [
      [
        'Ходы',
        r.moves === r.minMoves ? `${r.moves} — это минимум` : `${r.moves} (минимум ${r.minMoves})`,
        true,
      ],
      ['Время', clockText(r.time)],
    ];
    if (r.hints > 0) list.push(['Подсказки', String(r.hints)]);
    if (r.attempts > 1) list.push(['Попытка', String(r.attempts)]);
    list.push(['Вода мимо', r.dry ? 'ни капли' : 'немного пролилась']);
    if (ending.mode === 'daily' && ending.streak > 0) list.push(['Серия', days(ending.streak)]);
    if (ending.best) {
      const where = ending.mode === 'daily' ? 'Рекорд' : `Рекорд поля ${sizeLabel(r.size)}`;
      list.push([where, `${clockText(ending.best.time)} · лишних ${ending.best.extra ?? '—'}`]);
    }
    $('solved-stats').replaceChildren(...rows(list));
    $('solved-unlocked').hidden = ending.unlocked.length === 0;
    $('solved-unlocked-list').replaceChildren(
      ...ending.unlocked.map((id) => achievementItem(id, true)),
    );
    $('btn-copy').hidden = ending.mode !== 'daily' || ending.autopilot;
    const next = $('btn-next');
    next.hidden = ending.mode === 'daily';
    next.textContent = ending.mode === 'test' ? 'Ещё раз' : 'Следующий уровень';
    $('share-text').hidden = true;
    const note = $('solved-note');
    note.textContent = ending.autopilot
      ? 'Уровень решал автопилот — в рекорды и ачивки это не идёт.'
      : ending.mode === 'daily'
        ? 'Новый уровень дня — завтра. Результат можно отправить друзьям: решение он не выдаёт.'
        : '';
    note.hidden = note.textContent === '';
  };

  return {
    get shown() {
      return shown;
    },
    fit,
    setHover(cell) {
      hover = cell;
    },
    frame(frame) {
      const b = frame.session.play.board;
      if (b.cols !== board.cols || b.rows !== board.rows) {
        board = { cols: b.cols, rows: b.rows };
        fit();
      }
      if (frame.session !== session) {
        session = frame.session;
        last.title = '';
      }
      const playing = !frame.demo && BOARD_SCREENS.includes(shown);
      renderer.draw(frame, playing && shown === 'playing' ? hover : null);
      if (playing) updateHud(frame);
    },
    screen(screen, ending) {
      shown = screen;
      const onBoard = BOARD_SCREENS.includes(screen);
      hud.hidden = !onBoard;
      // Под паузой и итогом HUD виден, но недоступен: кнопки — только на карточке.
      hud.inert = screen !== 'playing';
      stage.inert = screen !== 'playing';
      if (!onBoard) hint.hidden = true;
      last.hint = !hint.hidden;
      stage.classList.toggle('playing', screen === 'playing');
      if (screen === 'menu') fillMenu();
      if (screen === 'achievements') fillAchievements();
      if (screen === 'solved' && ending) fillSolved(ending);
      for (const s of SCREENS) $(`screen-${s}`).hidden = s !== screen;
      if (screen === 'playing') last.moves = last.cursor = -2;
      fit();
      const focus =
        screen === 'playing'
          ? stage
          : document.querySelector<HTMLElement>(`#screen-${screen} [tabindex="-1"]`);
      focus?.focus({ preventScroll: true });
      if (screen === 'solved' && ending) {
        const r = ending.result;
        announce(`Колесо закрутилось! ${movesText(r.moves)}, время ${clockText(r.time)}.`);
      }
    },
    events(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.type === 'turn') {
          const wet =
            e.wet > 0
              ? ` Вода прошла ещё ${e.wet} ${plural(e.wet, 'жёлоб', 'жёлоба', 'жёлобов')}.`
              : '';
          announce(`Ходов: ${e.moves}.${wet}`);
        } else if (e.type === 'blocked') {
          announce('Здесь нет жёлоба: камень, кочка или пень.');
        } else if (e.type === 'cursor' && session) {
          announce(describeCell(session, e.cell));
        } else if (e.type === 'hint' && session) {
          const side = e.spin === CCW ? 'против часовой' : 'по часовой';
          announce(`Подсказка. ${describeCell(session, e.cell)} Поверните ${side}.`);
          toast(`Поверните подсвеченный жёлоб ${side}`);
        } else if (e.type === 'undo' && session) {
          announce(`Ход отменён: ${describeCell(session, e.cell)}`);
        } else if (e.type === 'nothing-to-undo') {
          announce('Отменять нечего.');
        } else if (e.type === 'restart') {
          announce('Уровень начат заново.');
          toast('Жёлоба вернулись на места');
        }
      }
    },
  };
}

/** Кнопки, мышь, палец, клавиатура и файлы. */
export function bindControls(deps: {
  game: Game;
  store: SaveStore;
  clock: Clock;
  appVersion: string;
  view: View;
  renderer: Renderer;
}) {
  const { game, store, clock, appVersion, view, renderer } = deps;
  const backupMessage = $('backup-message');
  const stage = $('stage');
  const canvas = $<HTMLCanvasElement>('scene');

  const say = (text: string, error = false) => {
    backupMessage.textContent = text;
    backupMessage.classList.toggle('error', error);
    backupMessage.hidden = false;
  };

  const actions: Record<string, () => void> = {
    daily: () => game.startDaily(),
    endless: () => game.startEndless(),
    help: () => game.open('help'),
    achievements: () => {
      backupMessage.hidden = true;
      game.open('achievements');
    },
    menu: () => game.open('menu'),
    pause: () => game.pause(),
    resume: () => game.resume(),
    hint: () => {
      game.hint();
      stage.focus({ preventScroll: true });
    },
    undo: () => {
      game.undo();
      stage.focus({ preventScroll: true });
    },
    restart: () => game.restart(),
    next: () => game.next(),
    sound: () => {
      syncSound(game.toggleSound());
      if (game.screen === 'playing') stage.focus({ preventScroll: true });
    },
    theme: () => {
      const next = THEME_NEXT[store.get().theme];
      game.setTheme(next);
      applyTheme(next);
      $('btn-theme').textContent = THEME_LABEL[next];
    },
    export: () => {
      const file = exportBackup(store, clock, appVersion);
      downloadText(file.fileName, file.text);
      say(`Копия сохранена в файл ${file.fileName}.`);
    },
    copy: () => {
      const ending = game.ending;
      if (!ending) return;
      const text = shareText(ending.result);
      void copyText(text).then((ok) => {
        if (ok) {
          toast('Результат скопирован — вставьте его в чат');
          return;
        }
        const area = $<HTMLTextAreaElement>('share-text');
        area.value = text;
        area.hidden = false;
        area.select();
        toast('Не вышло скопировать сами — текст выделен, скопируйте его');
      });
    },
  };

  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const action = target?.dataset.action;
    if (action && actions[action]) actions[action]();
  });

  $<HTMLInputElement>('import-file').addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const outcome = importBackup(store, await file.text());
    if (outcome.ok) {
      game.open('achievements');
      say(
        `Копия «${file.name}» загружена. Открыто ачивок: ${outcome.achievements}, решённых уровней дня: ${outcome.days}.`,
      );
    } else {
      say(
        `Файл «${file.name}» не подошёл. ${BACKUP_PROBLEMS[outcome.problem]} Текущие данные не изменены.`,
        true,
      );
    }
  });

  // Поворот — нажатие по клетке поля. Мышь: левая кнопка — по часовой, правая (на маке и
  // Ctrl+клик) — против. Палец решает при отпускании: коротко — по часовой, долгое нажатие —
  // против, сразу по таймеру, и отпускание после него уже ничего не делает.
  const cellOfEvent = (e: PointerEvent): number | null => {
    const layout = renderer.layout;
    if (!layout) return null;
    const box = canvas.getBoundingClientRect();
    return cellAt(layout, e.clientX - box.left, e.clientY - box.top);
  };
  const presses = new Map<
    number,
    { cell: number; x: number; y: number; timer: ReturnType<typeof setTimeout> }
  >();
  const dropPress = (id: number) => {
    clearTimeout(presses.get(id)?.timer);
    presses.delete(id);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (game.screen !== 'playing' || (e.button !== 0 && e.button !== 2)) return;
    const cell = cellOfEvent(e);
    if (cell === null) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      game.rotate(cell, e.button === 2 || e.ctrlKey ? CCW : CW);
      return;
    }
    if (e.button !== 0) return;
    dropPress(e.pointerId);
    const timer = setTimeout(() => {
      presses.delete(e.pointerId);
      game.rotate(cell, CCW);
    }, LONG_PRESS);
    presses.set(e.pointerId, { cell, x: e.clientX, y: e.clientY, timer });
  });
  // Отпускание ловит окно: под итогом холст уже неактивен, а нажатие надо закрыть.
  window.addEventListener('pointerup', (e) => {
    const press = presses.get(e.pointerId);
    if (!press) return;
    dropPress(e.pointerId);
    game.rotate(press.cell, CW);
  });
  window.addEventListener('pointercancel', (e) => dropPress(e.pointerId));
  canvas.addEventListener('pointermove', (e) => {
    view.setHover(e.pointerType === 'mouse' ? cellOfEvent(e) : null);
    const press = presses.get(e.pointerId);
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) {
      dropPress(e.pointerId);
    }
  });
  canvas.addEventListener('pointerleave', () => view.setHover(null));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const ARROWS: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select');
    const control = target.closest('button, a, input, textarea, select, label');
    const arrow = ARROWS[e.key];
    if (game.screen === 'playing' && arrow) {
      e.preventDefault();
      game.moveCursor(arrow[0], arrow[1]);
    } else if (game.screen === 'playing' && (e.key === 'Enter' || e.key === ' ') && !control) {
      e.preventDefault();
      if (!e.repeat) game.rotateCursor(e.shiftKey ? CCW : CW);
    } else if (e.code === 'Escape' || (e.code === 'KeyP' && !typing)) {
      if (game.screen === 'playing' || game.screen === 'paused') {
        e.preventDefault();
        game.togglePause();
      } else if (
        e.code === 'Escape' &&
        (game.screen === 'help' || game.screen === 'achievements')
      ) {
        game.open('menu');
      }
    } else if (e.code === 'KeyH' && !typing && game.screen === 'playing') {
      e.preventDefault();
      if (!e.repeat) game.hint();
    } else if (e.code === 'KeyZ' && !typing && game.screen === 'playing') {
      e.preventDefault();
      if (!e.repeat) game.undo();
    } else if (e.code === 'KeyM' && !typing) {
      syncSound(game.toggleSound());
    }
  });

  // Ушли со вкладки — пауза и запись: часы не должны идти, пока никто не смотрит.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const id of [...presses.keys()]) dropPress(id);
      game.persist();
      game.pause();
    }
  });
  window.addEventListener('pagehide', () => game.persist());
  window.addEventListener('resize', () => view.fit());
}

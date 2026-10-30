/** Сборка игры: адаптеры → стор → игра → вид. Единственное место, где всё знакомится. */

import './presentation/styles.css';

import { createGame, type TestLevel } from '@/application/game';
import { createSaveStore } from '@/application/saveStore';
import { isSeason } from '@/domain/season';
import { createLocalSaveRepository } from '@/infrastructure/localSaveRepository';
import { systemClock } from '@/infrastructure/systemClock';
import { createWebAudioSound } from '@/infrastructure/webAudioSound';
import { createRenderer } from '@/presentation/render';
import { applyTheme, bindControls, createView } from '@/presentation/ui';

/** ?seed=42&level=3&season=winter — тестовый уровень; ?autoplay — решает автопилот. */
function testLevel(params: URLSearchParams): TestLevel | null {
  const seed = params.get('seed');
  if (seed === null || !/^\d{1,10}$/.test(seed)) return null;
  const level = Number(params.get('level'));
  const season = params.get('season');
  return {
    seed: Number(seed) >>> 0,
    level: Number.isInteger(level) && level >= 1 && level <= 999 ? level : 1,
    season: isSeason(season) ? season : null,
  };
}

const params = new URLSearchParams(location.search);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = createRenderer(canvas, { reducedMotion: () => motion.matches });
const store = createSaveStore(createLocalSaveRepository());
applyTheme(store.get().theme);

const view = createView({ renderer, store, clock: systemClock });
const test = testLevel(params);
const game = createGame({
  store,
  sound: createWebAudioSound(),
  clock: systemClock,
  view,
  test,
  autoplay: params.has('autoplay'),
});
bindControls({ game, store, clock: systemClock, appVersion: __APP_VERSION__, view, renderer });

if (!test) game.open('menu');
view.fit();

const loop = (ms: number) => {
  game.tick(ms);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

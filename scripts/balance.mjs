// Таблица баланса: по ступеням бесконечного режима и уровню дня — минимум ходов, пути от
// родника до колеса, доля уровней с одним кратчайшим. Запуск: `npm run balance [выборка]`.
// Сиды те же, что у игры (номер уровня, дата), но ступень берёт их все подряд: настоящих
// уровней на ранних ступенях единицы, а распределение то же.
import { resolve } from 'node:path';

import { runnerImport } from 'vite';

const load = async (file) => (await runnerImport(resolve(file))).module;
const { addDays } = await load('src/domain/calendar.ts');
const { generateLevel } = await load('src/domain/generator.ts');
const { DAILY_PARAMS, dailySeed, endlessSeed, TIERS } = await load('src/domain/levels.ts');
const { countPaths } = await load('src/domain/solver.ts');

const SAMPLE = Number(process.argv[2]) || 2000;
const FIRST_DAY = '2026-01-01';

const median = (sorted) => sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
const percent = (part, all) => `${Math.round((part / all) * 100)} %`;

function row(label, params, seedOf) {
  const moves = [];
  const totals = [];
  const shortest = [];
  const near = [];
  let single = 0;
  let upToFour = 0;
  let unproven = 0;
  for (let i = 1; i <= SAMPLE; i++) {
    const level = generateLevel(seedOf(i), params);
    const count = countPaths(level.board);
    moves.push(level.solution.moves);
    totals.push(count.total);
    shortest.push(count.shortest);
    near.push(count.near);
    if (count.shortest === 1) single++;
    if (count.total <= 4) upToFour++;
    if (!count.exact || !level.solution.exact) unproven++;
  }
  for (const list of [moves, totals, shortest, near]) list.sort((a, b) => a - b);
  return [
    label,
    `${params.cols}×${params.rows}`,
    median(moves),
    `${moves[0]}–${moves.at(-1)}`,
    median(totals),
    totals.at(-1),
    median(shortest),
    median(near),
    percent(single, SAMPLE),
    percent(upToFour, SAMPLE),
    unproven,
  ];
}

const rows = TIERS.map((tier, i) => {
  const to = TIERS[i + 1]?.from;
  const label =
    to === undefined
      ? `${tier.from}+`
      : to - tier.from === 1
        ? `${tier.from}`
        : `${tier.from}–${to - 1}`;
  return row(label, tier.params, endlessSeed);
});
rows.push(row('День', DAILY_PARAMS, (i) => dailySeed(addDays(FIRST_DAY, i - 1))));

const header = [
  'Уровни',
  'Поле',
  'Минимум: медиана',
  'Минимум: от–до',
  'Путей: медиана',
  'Путей: макс.',
  'В минимум: медиана',
  'В минимум + 2: медиана',
  'Один кратчайший',
  'Путей до 4',
  'Не доказано',
];
console.log(`Выборка: ${SAMPLE} уровней на строку.\n`);
for (const line of [header, header.map(() => '---'), ...rows]) {
  console.log(`| ${line.join(' | ')} |`);
}

import { type Board, cellForMask, E, EMPTY, maskOf, N, S, W } from '@/domain/grid';

/** Жёлоба рисуются так, как повёрнуты сейчас; «·» — пустая клетка. */
const SHAPES: Record<string, number> = {
  '│': N | S,
  '─': E | W,
  '└': N | E,
  '┌': E | S,
  '┐': S | W,
  '┘': W | N,
  '├': N | E | S,
  '┬': E | S | W,
  '┤': S | W | N,
  '┴': W | N | E,
  '·': 0,
};

/** Поле из рисунка: родник над столбцом source, колесо под столбцом mill. */
export function board(rows: readonly string[], source: number, mill: number): Board {
  const cols = [...(rows[0] ?? '')].length;
  const cells = rows.flatMap((row) =>
    [...row].map((ch) => {
      const mask = SHAPES[ch];
      if (mask === undefined) throw new Error(`неизвестный жёлоб «${ch}»`);
      return cellForMask(mask) ?? EMPTY;
    }),
  );
  return { cols, rows: rows.length, cells, source, mill };
}

/** Рисунок поля — для понятных сообщений об ошибках. */
export function draw(b: Board): string {
  const byMask = new Map(Object.entries(SHAPES).map(([ch, m]) => [m, ch]));
  const lines: string[] = [];
  for (let y = 0; y < b.rows; y++) {
    lines.push(
      b.cells
        .slice(y * b.cols, (y + 1) * b.cols)
        .map((c) => byMask.get(maskOf(c)) ?? '?')
        .join(''),
    );
  }
  return lines.join('\n');
}

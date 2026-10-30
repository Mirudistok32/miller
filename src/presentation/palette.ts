/** Цвета деревни по временам года. Дерево жёлобов и мельницы — общее для всех сезонов. */

import type { Season } from '@/domain/season';

export interface ScenePalette {
  grass: string;
  grassLight: string;
  grassDark: string;
  /** Плитки поля. */
  tile: string;
  tileDark: string;
  crown: string;
  crownDark: string;
  fir: string;
  firDark: string;
  water: string;
  waterLight: string;
  waterDeep: string;
  /** Берег ручья. */
  bank: string;
  /** Цветы весной и летом, опавшие листья осенью. */
  flowers: readonly string[];
  /** Частицы погоды: снег, лепестки, пух, листья. */
  particles: readonly string[];
  snow: boolean;
}

export const PALETTES: Readonly<Record<Season, ScenePalette>> = {
  winter: {
    grass: '#E3E9F1',
    grassLight: '#FBFCFE',
    grassDark: '#C3CEDB',
    tile: '#D5DEE9',
    tileDark: '#B4C1D1',
    crown: '#DCE6EE',
    crownDark: '#A9B9CB',
    fir: '#2E5446',
    firDark: '#1F3D33',
    water: '#4F86B8',
    waterLight: '#A8CBE6',
    waterDeep: '#365F8C',
    bank: '#9FB0C4',
    flowers: [],
    particles: ['#FFFFFF', '#EEF3F8'],
    snow: true,
  },
  spring: {
    grass: '#7FB35B',
    grassLight: '#A3D06E',
    grassDark: '#62944A',
    tile: '#8CBE64',
    tileDark: '#6E9E4E',
    crown: '#9CCB6A',
    crownDark: '#6FA34E',
    fir: '#2F5D46',
    firDark: '#234536',
    water: '#4A90C8',
    waterLight: '#9AD0F2',
    waterDeep: '#326A9A',
    bank: '#8C7A52',
    flowers: ['#F6C9D6', '#FFFFFF', '#F2CF6B'],
    particles: ['#F6C9D6', '#FBE3EA'],
    snow: false,
  },
  summer: {
    grass: '#6AA34A',
    grassLight: '#8CBD58',
    grassDark: '#4E8536',
    tile: '#78AE52',
    tileDark: '#5B8F40',
    crown: '#5E9A45',
    crownDark: '#447A33',
    fir: '#2A5A40',
    firDark: '#1E4430',
    water: '#3F88C8',
    waterLight: '#8ACAF0',
    waterDeep: '#2B5F92',
    bank: '#8A7448',
    flowers: ['#F2CF6B', '#FFFFFF', '#9DBDF2', '#E8725E'],
    particles: ['#FFFFFF', '#F4F1E6'],
    snow: false,
  },
  autumn: {
    grass: '#9C8B46',
    grassLight: '#B9A052',
    grassDark: '#7C6C34',
    tile: '#A6944F',
    tileDark: '#86753C',
    crown: '#D9962B',
    crownDark: '#B8642F',
    fir: '#2F5446',
    firDark: '#223F34',
    water: '#4A7FA8',
    waterLight: '#8DBADB',
    waterDeep: '#335C80',
    bank: '#6E5A36',
    flowers: ['#D9962B', '#C8643A', '#E8B04B'],
    particles: ['#D9962B', '#C8643A', '#E8B04B'],
    snow: false,
  },
};

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

export function mix(a: string, b: string, k: number): string {
  const [r0, g0, b0] = hex(a);
  const [r1, g1, b1] = hex(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r0, r1)}${ch(g0, g1)}${ch(b0, b1)}`;
}

/**
 * 系列の色。Okabe-Ito のカラーユニバーサルデザイン配色を土台に、
 * ライト／ダークどちらの背景でも視認できる明度に揃えたもの。
 * 色だけに頼らないよう、11本目以降は破線パターンを併用する。
 */
const COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#D55E00',
  '#8B5CF6',
  '#14B8A6',
  '#A16207',
  '#64748B',
] as const;

/** 色が一巡したあとに使う破線パターン */
const DASHES: number[][] = [[], [6, 3], [2, 3], [10, 3, 2, 3]];

export function colorFor(index: number): string {
  return COLORS[index % COLORS.length]!;
}

export function dashFor(index: number): number[] {
  return DASHES[Math.floor(index / COLORS.length) % DASHES.length]!;
}

/** 面グラフの塗り用に、同じ色を半透明にして返す */
export function fillFor(index: number, alpha: number): string {
  const hex = colorFor(index);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

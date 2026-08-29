import {
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { Granularity, Series, ViewOptions, XMode } from './types';
import { colorFor, dashFor, fillFor } from './palette';
import { t, type Lang } from './i18n';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Tooltip,
  Legend,
  Filler,
);

/** PNG 書き出し時に背景が透明にならないよう、常に下地を塗っておく */
const backgroundPlugin = {
  id: 'octivity-background',
  beforeDraw(chart: Chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = themeColors().canvas;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};
Chart.register(backgroundPlugin);

/**
 * 各系列の終点にその名前を直接描く。
 * 凡例と線を視線で往復しなくて済むぶん、系列が増えたときの可読性が大きく変わる。
 * 重なりは上下に押し広げて避け、はみ出す場合は描かない。
 */
const endLabelPlugin = {
  id: 'octivity-end-labels',
  afterDatasetsDraw(chart: Chart) {
    const shown = (chart.options as { _endLabels?: boolean })._endLabels;
    if (shown !== true) return;

    const { ctx, chartArea } = chart;
    const items: { y: number; text: string; color: string }[] = [];

    chart.data.datasets.forEach((ds, i) => {
      if (chart.getDatasetMeta(i).hidden === true) return;
      // 全系列の x を揃えている都合上、末尾は穴（null）のことがある。
      // ラベルは実際に線が終わっている位置に置く。
      const meta = chart.getDatasetMeta(i);
      const values = (ds.data ?? []) as { y: number | null }[];
      let last: (typeof meta.data)[number] | undefined;
      for (let k = meta.data.length - 1; k >= 0; k--) {
        if (values[k]?.y !== null && values[k]?.y !== undefined) {
          last = meta.data[k];
          break;
        }
      }
      if (last === undefined) return;
      if (last.x < chartArea.left || last.x > chartArea.right + 1) return;
      items.push({
        y: last.y,
        text: String(ds.label ?? ''),
        color: typeof ds.borderColor === 'string' ? ds.borderColor : '#888',
      });
    });

    // 全部を並べる高さが無いなら、潰れた文字を出すより凡例表に任せる
    const LINE = 15;
    const height = chartArea.bottom - chartArea.top;
    if (items.length * LINE > height) return;

    // 近すぎるものを下へ押し広げ、はみ出したぶんを全体で上に戻す。
    // 押し戻しで上端を割ることは、上の高さ判定があるので起きない。
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      if (cur.y - prev.y < LINE) cur.y = prev.y + LINE;
    }
    const overflow = (items[items.length - 1]?.y ?? 0) - chartArea.bottom;
    if (overflow > 0) for (const item of items) item.y -= overflow;
    const under = chartArea.top - (items[0]?.y ?? chartArea.top);
    if (under > 0) for (const item of items) item.y += under;

    ctx.save();
    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const item of items) {
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, chartArea.right + 8, item.y);
    }
    ctx.restore();
  },
};
Chart.register(endLabelPlugin);

function isDark(): boolean {
  return document.documentElement.dataset['theme'] === 'dark';
}

function themeColors(): { grid: string; text: string; canvas: string } {
  return isDark()
    ? { grid: 'rgba(255,255,255,0.10)', text: '#a8b1c0', canvas: '#0d1117' }
    : { grid: 'rgba(0,0,0,0.08)', text: '#5b6472', canvas: '#ffffff' };
}

const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600];

/** 日付軸の目盛りを、年・四半期・月のきりのよい位置に自前で置く */
export function dateTicks(minMs: number, maxMs: number, target = 8): number[] {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) return [];
  const start = new Date(minMs);
  const end = new Date(maxMs);
  const totalMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());

  const step = MONTH_STEPS.find((s) => totalMonths / s <= target) ?? MONTH_STEPS.at(-1)!;
  const ticks: number[] = [];
  let year = start.getUTCFullYear();
  let month = step >= 12 ? 0 : Math.floor(start.getUTCMonth() / step) * step;
  if (step >= 12) year = Math.floor(year / (step / 12)) * (step / 12);

  for (let guard = 0; guard < 400; guard++) {
    const value = Date.UTC(year, month, 1);
    if (value > maxMs) break;
    if (value >= minMs) ticks.push(value);
    month += step;
    year += Math.floor(month / 12);
    month %= 12;
  }
  return ticks;
}

function formatDateTick(ms: number, lang: Lang, step: 'month' | 'year'): string {
  const d = new Date(ms);
  if (step === 'year') return String(d.getUTCFullYear());
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

function ageUnitKey(g: Granularity): 'unit_week' | 'unit_month' | 'unit_quarter' | 'unit_year' {
  return g === 'week' ? 'unit_week' : g === 'month' ? 'unit_month' : g === 'quarter' ? 'unit_quarter' : 'unit_year';
}

/** 横軸の 1 目盛りを人間が読める文字列にする */
export function formatX(value: number, mode: XMode, g: Granularity, lang: Lang, coarse = false): string {
  if (mode === 'age') return t(lang, ageUnitKey(g), { n: Math.round(value) + 1 });
  return formatDateTick(value, lang, coarse ? 'year' : 'month');
}

function formatY(value: number, opts: ViewOptions, lang: Lang): string {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-US';
  if (opts.normalize !== 'none') return `${value.toFixed(1)}%`;
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 10 ? 1 : 0;
  return new Intl.NumberFormat(locale, {
    notation: abs >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: digits,
  }).format(value);
}

export interface ChartHandle {
  update(series: Series[], opts: ViewOptions, lang: Lang): void;
  toPng(): string;
  destroy(): void;
}

export function createChart(canvas: HTMLCanvasElement): ChartHandle {
  let current: { opts: ViewOptions; lang: Lang } | null = null;

  const chart = new Chart(canvas, {
    type: 'line',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      parsing: false,
      normalized: true,
      // 同じ時点の全系列をまとめて出す。1本ずつ当てにいくより比較しやすい
      interaction: { mode: 'index', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) =>
            ((b.raw as { y: number | null }).y ?? 0) - ((a.raw as { y: number | null }).y ?? 0),
          filter: (item) => (item.raw as { y: number | null }).y !== null,
          callbacks: {
            title: (items) => {
              if (current === null || items[0] === undefined) return '';
              const x = (items[0].raw as { x: number }).x;
              return formatX(x, current.opts.xMode, current.opts.granularity, current.lang);
            },
            label: (item) => {
              if (current === null) return '';
              const y = (item.raw as { y: number | null }).y;
              if (y === null) return '';
              return `${item.dataset.label ?? ''}  ${formatY(y, current.opts, current.lang)}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear' },
        y: { type: 'linear', beginAtZero: true },
      },
    },
  });

  return {
    update(series, opts, lang) {
      current = { opts, lang };
      const colors = themeColors();
      // 初回はキャンバスが display:none の中で生成されるため寸法が 0 になる。
      // 表示された直後に自分で測り直しておかないと、最初の 1 枚が潰れて描かれる。
      chart.resize();

      const stacked = opts.chartStyle === 'stacked';
      const filled = stacked || opts.chartStyle === 'area';
      // 積み上げは重ならないので濃く、重ね塗りの面は薄くしないと下の線が沈む
      const alpha = stacked ? 0.75 : 0.14;

      chart.data.datasets = series.map((s, i) => {
        const ci = s.colorIndex ?? i;
        // 値が 1 点しかない系列は線が引けず、何も描かれないまま消えてしまう。
        // 作られたばかりのリポジトリで普通に起きるので、点として見せる。
        const visible = s.points.filter((p) => p.y !== null).length;
        return {
          label: s.fullName,
          data: s.points,
          borderColor: colorFor(ci),
          backgroundColor: filled ? fillFor(ci, alpha) : colorFor(ci),
          borderDash: dashFor(ci),
          borderWidth: stacked ? 1 : 2.5,
          borderCapStyle: 'round' as const,
          borderJoinStyle: 'round' as const,
          fill: filled ? ('origin' as const) : false,
          pointRadius: visible <= 1 ? 3.5 : 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          tension: 0.3,
          spanGaps: false,
        };
      });

      // 積み上げは面の重なり順が意味を持つので、下から順に描く
      if (stacked) chart.data.datasets.reverse();

      const xs = series.flatMap((s) => s.points.map((p) => p.x));
      const min = xs.length > 0 ? Math.min(...xs) : 0;
      const max = xs.length > 0 ? Math.max(...xs) : 1;
      const ticks = opts.xMode === 'date' ? dateTicks(min, max) : [];
      const coarse = ticks.length > 1 && ticks[1]! - ticks[0]! >= 360 * 24 * 3600 * 1000;

      const scales = chart.options.scales!;
      // linear 軸は既定で目盛り間隔に合わせて範囲を丸める。
      // x がミリ秒だと丸め幅が 1e11 〜 1e12 になり、軸が実データの何倍にも広がって
      // 線が一部に潰れてしまうため、日付モードでは両端をデータに固定する。
      // 年齢モードの x は小さな整数なので、丸めさせたほうが目盛りがきれいになる。
      const isDate = opts.xMode === 'date';
      scales['x'] = {
        type: 'linear',
        min,
        ...(isDate ? { max } : {}),
        grid: { color: colors.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: colors.text,
          autoSkip: !isDate,
          maxRotation: 0,
          padding: 8,
          // 年齢軸は「N か月目」の整数しか意味を持たない。
          // これが無いと 0.5 刻みで目盛りが打たれ、丸めた結果
          // 同じラベルが二度並ぶ。
          ...(isDate ? {} : { precision: 0 }),
          callback: (value: string | number) =>
            formatX(Number(value), opts.xMode, opts.granularity, lang, coarse),
        },
        ...(isDate && ticks.length > 0
          ? { afterBuildTicks: (axis: { ticks: { value: number }[] }) => {
              axis.ticks = ticks.map((value) => ({ value }));
            } }
          : {}),
      } as never;

      scales['y'] = {
        type: opts.logScale ? 'logarithmic' : 'linear',
        stacked,
        beginAtZero: !opts.logScale,
        grid: { color: colors.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: colors.text,
          padding: 8,
          callback: (value: string | number) => formatY(Number(value), opts, lang),
        },
      } as never;

      // 名前を線の横に置くための余白。長い名前ぶんだけ確保する
      const longest = series.reduce((n, s) => Math.max(n, s.fullName.length), 0);
      const showLabels = series.length > 0 && series.length <= 14;
      (chart.options as { _endLabels?: boolean })._endLabels = showLabels;
      chart.options.layout = {
        padding: { right: showLabels ? Math.min(200, longest * 7 + 16) : 8, top: 8 },
      };

      chart.update();
    },
    toPng() {
      return chart.toBase64Image('image/png', 1);
    },
    destroy() {
      chart.destroy();
    },
  };
}

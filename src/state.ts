import type { Granularity, Metric, Normalize, ViewOptions, XMode } from './types';
import { parseRepoRef, refToString } from './github';

export interface AppState {
  /** "owner/name" の一覧。表示順がそのまま系列の順序と色になる */
  repos: string[];
  view: ViewOptions;
}

export const DEFAULT_VIEW: ViewOptions = {
  metric: 'commits',
  granularity: 'month',
  xMode: 'date',
  cumulative: false,
  smooth: 1,
  normalize: 'none',
  logScale: false,
};

const METRICS: Metric[] = ['commits', 'additions', 'deletions', 'net', 'churn', 'contributors'];
const GRANULARITIES: Granularity[] = ['week', 'month', 'quarter', 'year'];
const X_MODES: XMode[] = ['date', 'age'];
const NORMALIZE: Normalize[] = ['none', 'peak', 'share'];
export const SMOOTH_OPTIONS = [1, 3, 6, 12, 24] as const;

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value !== null && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

export function decodeState(search: string): AppState {
  const p = new URLSearchParams(search);
  const repos: string[] = [];
  for (const raw of (p.get('r') ?? '').split(',')) {
    const ref = parseRepoRef(raw);
    if (ref === null) continue;
    const full = refToString(ref);
    if (!repos.some((x) => x.toLowerCase() === full.toLowerCase())) repos.push(full);
  }

  const smoothRaw = Number(p.get('s'));
  const smooth = SMOOTH_OPTIONS.includes(smoothRaw as (typeof SMOOTH_OPTIONS)[number])
    ? smoothRaw
    : DEFAULT_VIEW.smooth;

  return {
    repos,
    view: {
      metric: pick(p.get('m'), METRICS, DEFAULT_VIEW.metric),
      granularity: pick(p.get('g'), GRANULARITIES, DEFAULT_VIEW.granularity),
      xMode: pick(p.get('x'), X_MODES, DEFAULT_VIEW.xMode),
      normalize: pick(p.get('n'), NORMALIZE, DEFAULT_VIEW.normalize),
      cumulative: p.get('c') === '1',
      logScale: p.get('l') === '1',
      smooth,
    },
  };
}

/**
 * 状態をクエリ文字列に落とす。既定値は省略して URL を短く保つ。
 * トークンは意図的に一切含めない（共有 URL から漏れるため）。
 */
export function encodeState(state: AppState): string {
  const p = new URLSearchParams();
  if (state.repos.length > 0) p.set('r', state.repos.join(','));
  const v = state.view;
  if (v.metric !== DEFAULT_VIEW.metric) p.set('m', v.metric);
  if (v.granularity !== DEFAULT_VIEW.granularity) p.set('g', v.granularity);
  if (v.xMode !== DEFAULT_VIEW.xMode) p.set('x', v.xMode);
  if (v.normalize !== DEFAULT_VIEW.normalize) p.set('n', v.normalize);
  if (v.cumulative) p.set('c', '1');
  if (v.logScale) p.set('l', '1');
  if (v.smooth !== DEFAULT_VIEW.smooth) p.set('s', String(v.smooth));
  const s = p.toString();
  return s === '' ? '' : '?' + s;
}

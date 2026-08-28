import './style.css';
import { GitHubClient, GitHubError, parseRepoRef, refToString } from './github';
import { buildSeries, isLineMetric, summarize } from './metrics';
import { createChart, formatX } from './chart';
import { SMOOTH_OPTIONS, decodeState, encodeState, type AppState } from './state';
import { colorFor } from './palette';
import { detectLang, t, type Lang, type MessageKey } from './i18n';
import { clearToken, isRemembered, loadToken, saveToken } from './token';
import { cacheClear } from './cache';
import type { Granularity, Metric, Normalize, RepoSeries, XMode } from './types';

const PROJECT_URL = 'https://github.com/kumagallium/octivity';
const EXAMPLE = ['vitejs/vite', 'webpack/webpack', 'rollup/rollup', 'evanw/esbuild'];
/** 同時に走らせる GitHub リクエスト数。多すぎると二次レート制限に触れる */
const CONCURRENCY = 3;

interface RepoEntry {
  fullName: string;
  status: 'loading' | 'ready' | 'error';
  series: RepoSeries | null;
  error: string | null;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing element: ${id}`);
  return el as T;
};

let lang: Lang = (localStorage.getItem('octivity:lang') as Lang | null) ?? detectLang();
let state: AppState = decodeState(location.search);
let entries: RepoEntry[] = [];
const client = new GitHubClient(loadToken());
const chart = createChart($<HTMLCanvasElement>('chart'));
let inflight: AbortController | null = null;

/* ---------- テーマ ---------- */

type ThemePref = 'auto' | 'light' | 'dark';

function applyTheme(): void {
  const pref = (localStorage.getItem('octivity:theme') as ThemePref | null) ?? 'auto';
  const dark =
    pref === 'dark' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  $('theme-toggle').textContent = pref === 'auto' ? '◐' : pref === 'dark' ? '●' : '○';
}

function cycleTheme(): void {
  const order: ThemePref[] = ['auto', 'light', 'dark'];
  const pref = (localStorage.getItem('octivity:theme') as ThemePref | null) ?? 'auto';
  const next = order[(order.indexOf(pref) + 1) % order.length]!;
  localStorage.setItem('octivity:theme', next);
  applyTheme();
  render();
}

/* ---------- 文言 ---------- */

function applyI18n(): void {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(lang, el.dataset['i18n'] as MessageKey);
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    el.placeholder = t(lang, el.dataset['i18nPlaceholder'] as MessageKey);
  }
  const smooth = $<HTMLSelectElement>('smooth');
  const selected = smooth.value;
  smooth.innerHTML = '';
  for (const n of SMOOTH_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = n === 1 ? t(lang, 's_none') : t(lang, 'smoothN', { n });
    smooth.append(opt);
  }
  smooth.value = selected === '' ? String(state.view.smooth) : selected;
}

function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(Number(el.dataset['timer'] ?? 0));
  el.dataset['timer'] = String(window.setTimeout(() => (el.hidden = true), 2200));
}

function numberFormat(value: number): string {
  return new Intl.NumberFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function dateFormat(ms: number | null): string {
  if (ms === null) return '—';
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

/* ---------- データ取得 ---------- */

function entryFor(fullName: string): RepoEntry | undefined {
  return entries.find((e) => e.fullName.toLowerCase() === fullName.toLowerCase());
}

function syncEntries(): void {
  entries = state.repos.map(
    (name) => entryFor(name) ?? { fullName: name, status: 'loading', series: null, error: null },
  );
}

async function loadAll(): Promise<void> {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;

  const pending = entries.filter((e) => e.status === 'loading' || e.status === 'error');
  for (const e of pending) {
    e.status = 'loading';
    e.error = null;
  }
  render();

  const queue = [...pending];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const entry = queue.shift();
      if (entry === undefined) return;
      const ref = parseRepoRef(entry.fullName);
      if (ref === null) {
        entry.status = 'error';
        entry.error = 'invalid';
        render();
        continue;
      }
      try {
        const series = await client.fetchSeries(ref, controller.signal);
        if (controller.signal.aborted) return;
        entry.series = series;
        entry.status = 'ready';
        entry.error = series.weeks.length === 0 ? t(lang, 'noData') : null;
      } catch (err) {
        if (controller.signal.aborted) return;
        entry.status = 'error';
        entry.error =
          err instanceof GitHubError ? err.message : (err as Error).message ?? 'unknown error';
      }
      render();
    }
  });

  await Promise.all(workers);
}

/* ---------- 描画 ---------- */

function renderChips(): void {
  const list = $('chips');
  list.innerHTML = '';
  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    li.className = `chip is-${entry.status}`;
    if (entry.status === 'error') li.title = entry.error ?? '';

    if (entry.status === 'loading') {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      li.append(spinner);
    } else {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = entry.status === 'ready' ? colorFor(i) : 'var(--danger)';
      li.append(swatch);
    }

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.fullName + (entry.series?.truncated === true ? ' *' : '');
    li.append(name);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', t(lang, 'removeRepo', { name: entry.fullName }));
    remove.addEventListener('click', () => {
      state.repos = state.repos.filter((r) => r !== entry.fullName);
      syncEntries();
      pushUrl();
      render();
    });
    li.append(remove);
    list.append(li);
  });

  $('clear-all').hidden = entries.length === 0;
  const errors = entries.filter((e) => e.status === 'error');
  const box = $('form-error');
  box.hidden = errors.length === 0;
  box.textContent = errors.map((e) => `${e.fullName}: ${e.error ?? ''}`).join(' / ');
}

function renderChart(): void {
  const ready = entries.filter(
    (e): e is RepoEntry & { series: RepoSeries } =>
      e.status === 'ready' && e.series !== null && e.series.weeks.length > 0,
  );

  // 行数系の指標では、GitHub が行数統計を返さないリポジトリを描かない。
  // 0 の直線を引くと「変更が無かった」という誤った読みを招くため。
  const needsLines = isLineMetric(state.view.metric);
  const usable = needsLines ? ready.filter((e) => e.series.hasLineStats) : ready;
  const dropped = needsLines ? ready.filter((e) => !e.series.hasLineStats) : [];

  const note = $('metric-note');
  if (dropped.length === 0) {
    note.hidden = true;
  } else {
    note.hidden = false;
    note.textContent =
      usable.length === 0
        ? t(lang, 'noLineStatsAll')
        : t(lang, 'noLineStats', { names: dropped.map((e) => e.fullName).join('、') });
  }

  const hasData = usable.length > 0;
  $('chart-wrap').hidden = !hasData;
  $('empty').hidden = entries.length > 0;
  $('controls').hidden = entries.length === 0;
  $('legend-panel').hidden = !hasData;
  if (!hasData) return;

  // 系列の色を chips と揃えるため、entries 上の位置を色番号として渡す
  const series = buildSeries(
    usable.map((e) => e.series),
    state.view,
  ).map((s, i) => ({ ...s, colorIndex: entries.indexOf(usable[i]!) }));

  chart.update(series, state.view, lang);
  $<HTMLCanvasElement>('chart').setAttribute(
    'aria-label',
    `${t(lang, 'ariaChart')}: ${usable.map((e) => e.fullName).join(', ')}`,
  );
  renderLegend(usable);
}

function renderLegend(ready: (RepoEntry & { series: RepoSeries })[]): void {
  const body = $('legend-body');
  body.innerHTML = '';
  let truncated = false;

  for (const entry of ready) {
    const i = entries.indexOf(entry);
    const s = summarize(entry.series, state.view.metric, state.view.granularity);
    truncated ||= s.truncated;

    const tr = document.createElement('tr');
    const swatchCell = document.createElement('td');
    swatchCell.className = 'swatch-cell';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = colorFor(i);
    swatchCell.append(swatch);

    const nameCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = entry.series.meta.htmlUrl;
    link.rel = 'noopener';
    link.target = '_blank';
    link.textContent = s.fullName + (s.truncated ? ' *' : '');
    nameCell.append(link);

    tr.append(swatchCell, nameCell);
    for (const value of [numberFormat(s.total), numberFormat(s.peak), numberFormat(s.contributors)]) {
      const td = document.createElement('td');
      td.className = 'num';
      td.textContent = value;
      tr.append(td);
    }
    for (const value of [dateFormat(s.firstActivity), dateFormat(s.lastActivity)]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  $('truncated-note').hidden = !truncated;
}

function renderRateLimit(): void {
  const rl = client.rateLimit;
  const el = $('rate-limit');
  if (rl === null) {
    el.textContent = '';
    return;
  }
  const reset = new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(rl.reset));
  el.textContent =
    t(lang, 'rateLimit', { remaining: rl.remaining, limit: rl.limit }) +
    (rl.remaining < rl.limit ? ` · ${t(lang, 'rateReset', { time: reset })}` : '');
}

function render(): void {
  renderChips();
  renderChart();
  renderRateLimit();
}

/* ---------- 入出力 ---------- */

function pushUrl(): void {
  history.replaceState(null, '', location.pathname + encodeState(state));
}

function addRepos(raw: string): void {
  const added: string[] = [];
  for (const token of raw.split(/[,\s\n]+/)) {
    const ref = parseRepoRef(token);
    if (ref === null) continue;
    const full = refToString(ref);
    if (state.repos.some((r) => r.toLowerCase() === full.toLowerCase())) continue;
    state.repos.push(full);
    added.push(full);
  }
  if (added.length === 0) return;
  syncEntries();
  pushUrl();
  void loadAll();
}

function exportCsv(): void {
  const ready = entries.filter(
    (e): e is RepoEntry & { series: RepoSeries } => e.status === 'ready' && e.series !== null,
  );
  const series = buildSeries(
    ready.map((e) => e.series),
    state.view,
  );
  const rows = [['repository', 'x', 'x_label', state.view.metric].join(',')];
  for (const s of series) {
    for (const p of s.points) {
      const label = formatX(p.x, state.view.xMode, state.view.granularity, 'en');
      rows.push([s.fullName, p.x, `"${label}"`, p.y].join(','));
    }
  }
  download(new Blob([rows.join('\n')], { type: 'text/csv' }), 'octivity.csv');
}

function exportPng(): void {
  const data = chart.toPng();
  const bin = atob(data.split(',')[1] ?? '');
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  download(new Blob([bytes], { type: 'image/png' }), 'octivity.png');
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 配線 ---------- */

function bindControls(): void {
  const bind = <T extends HTMLElement>(id: string, apply: (el: T) => void): void => {
    const el = $<T>(id);
    el.addEventListener('change', () => {
      apply(el);
      pushUrl();
      render();
    });
  };

  bind<HTMLSelectElement>('metric', (el) => (state.view.metric = el.value as Metric));
  bind<HTMLSelectElement>('granularity', (el) => (state.view.granularity = el.value as Granularity));
  bind<HTMLSelectElement>('xmode', (el) => (state.view.xMode = el.value as XMode));
  bind<HTMLSelectElement>('normalize', (el) => (state.view.normalize = el.value as Normalize));
  bind<HTMLSelectElement>('smooth', (el) => (state.view.smooth = Number(el.value)));
  bind<HTMLInputElement>('cumulative', (el) => (state.view.cumulative = el.checked));
  bind<HTMLInputElement>('logscale', (el) => (state.view.logScale = el.checked));
}

function syncControls(): void {
  $<HTMLSelectElement>('metric').value = state.view.metric;
  $<HTMLSelectElement>('granularity').value = state.view.granularity;
  $<HTMLSelectElement>('xmode').value = state.view.xMode;
  $<HTMLSelectElement>('normalize').value = state.view.normalize;
  $<HTMLSelectElement>('smooth').value = String(state.view.smooth);
  $<HTMLInputElement>('cumulative').checked = state.view.cumulative;
  $<HTMLInputElement>('logscale').checked = state.view.logScale;
}

function bindTokenDialog(): void {
  const dialog = $<HTMLDialogElement>('token-dialog');
  const input = $<HTMLInputElement>('token-input');
  const remember = $<HTMLInputElement>('token-remember');

  // 別サイトに埋め込まれている場合、周囲のページから入力を覗かれうる。
  // グラフの埋め込み自体は許しつつ、トークン入力だけは断る。
  const framed = window.top !== window.self;

  $('token-open').addEventListener('click', () => {
    if (framed) {
      toast(t(lang, 'tokenFramed'));
      return;
    }
    input.value = loadToken() ?? '';
    remember.checked = isRemembered();
    dialog.showModal();
  });
  $('token-cancel').addEventListener('click', () => dialog.close());
  $('token-save').addEventListener('click', () => {
    saveToken(input.value, remember.checked);
    client.setToken(input.value.trim() === '' ? undefined : input.value);
    dialog.close();
    cacheClear();
    void loadAll();
  });
  $('token-remove').addEventListener('click', () => {
    clearToken();
    client.setToken(undefined);
    input.value = '';
    dialog.close();
  });
}

function main(): void {
  applyTheme();
  applyI18n();
  syncControls();
  bindControls();
  bindTokenDialog();

  $<HTMLAnchorElement>('repo-link').href = PROJECT_URL;
  client.onRateLimit = () => renderRateLimit();

  $<HTMLFormElement>('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('repo-input');
    addRepos(input.value);
    input.value = '';
  });
  $('load-example').addEventListener('click', () => addRepos(EXAMPLE.join(',')));
  $('clear-all').addEventListener('click', () => {
    inflight?.abort();
    state.repos = [];
    entries = [];
    pushUrl();
    render();
  });
  $('theme-toggle').addEventListener('click', cycleTheme);
  $('lang-toggle').addEventListener('click', () => {
    lang = lang === 'ja' ? 'en' : 'ja';
    localStorage.setItem('octivity:lang', lang);
    applyI18n();
    syncControls();
    render();
  });
  $('copy-url').addEventListener('click', () => {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => toast(t(lang, 'copied')))
      .catch(() => toast(location.href));
  });
  $('export-csv').addEventListener('click', exportCsv);
  $('export-png').addEventListener('click', exportPng);
  $('clear-cache').addEventListener('click', () => {
    cacheClear();
    toast(t(lang, 'cacheCleared'));
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme();
    render();
  });

  syncEntries();
  render();
  if (entries.length > 0) void loadAll();
}

main();

import './style.css';
import { GitHubClient, GitHubError, classifyInput, parseRepoRef, refToString } from './github';
import { accountSeries, buildSeries, isLineMetric, summarize } from './metrics';
import { createChart, formatX } from './chart';
import {
  SMOOTH_OPTIONS,
  TOP_ACCOUNT_OPTIONS,
  decodeState,
  encodeState,
  type AppState,
} from './state';
import { colorFor } from './palette';
import { detectLang, t, type Lang, type MessageKey } from './i18n';
import { clearToken, isRemembered, loadToken, saveToken } from './token';
import { cacheClear, cachePurgeOld } from './cache';
import type {
  ChartStyle,
  Granularity,
  Metric,
  Normalize,
  OwnerRepo,
  RepoSeries,
  SeriesBy,
  XMode,
} from './types';

const PROJECT_URL = 'https://github.com/kumagallium/octivity';
const EXAMPLE = ['vitejs/vite', 'webpack/webpack', 'rollup/rollup', 'evanw/esbuild'];
/**
 * 同時に走らせる GitHub リクエスト数。
 * 統計は「最初に叩いた時点で GitHub 側の集計が始まる」ので、
 * 少なすぎると後ろのリポジトリの集計開始が丸ごと遅れる。
 * 二次レート制限に触れない範囲でやや広めに取る。
 */
const CONCURRENCY = 5;

interface RepoEntry {
  fullName: string;
  /** pending は失敗ではなく「GitHub が集計中で、再試行すれば通る」状態 */
  status: 'loading' | 'pending' | 'ready' | 'error';
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

  const top = $<HTMLSelectElement>('top-accounts');
  top.innerHTML = '';
  for (const n of TOP_ACCOUNT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = t(lang, 'topN', { n });
    top.append(opt);
  }
  top.value = String(state.view.topAccounts);
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

  const pending = entries.filter((e) => e.status !== 'ready');
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
        const pendingStats = err instanceof GitHubError && err.kind === 'stats-pending';
        entry.status = pendingStats ? 'pending' : 'error';
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

    if (entry.status === 'pending' || entry.status === 'error') {
      // 「もう一度お試しください」と書く以上、その手段を同じ場所に置く
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry';
      retry.textContent = '↻';
      retry.setAttribute('aria-label', t(lang, 'retryOne', { name: entry.fullName }));
      retry.addEventListener('click', () => {
        entry.status = 'loading';
        entry.error = null;
        render();
        void loadAll();
      });
      li.append(retry);
    }

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
  renderProblems();
}

/**
 * 失敗の通知。
 * 同じ理由で 6 件落ちたときに同じ文章を 6 回並べると、
 * 特に狭い画面では読む前に諦められてしまうので、理由ごとにまとめる。
 */
function renderProblems(): void {
  const box = $('form-error');
  const waiting = entries.filter((e) => e.status === 'pending');
  const failed = entries.filter((e) => e.status === 'error');
  const rl = client.rateLimit;
  // 残量が少ないことはフッターにも出ているが、狭い画面では視界に入らない
  const lowRate = rl !== null && !client.hasToken && rl.remaining <= 10;

  box.innerHTML = '';
  box.hidden = waiting.length === 0 && failed.length === 0 && !lowRate;
  if (box.hidden) return;

  if (waiting.length > 0) {
    const line = document.createElement('p');
    line.className = 'problem';
    line.textContent = t(lang, 'errorPending', { n: waiting.length });
    box.append(line);
  }

  // 失敗は理由ごとにまとめ、対象のリポジトリ名を添える
  const byReason = new Map<string, string[]>();
  for (const e of failed) {
    const reason = e.error ?? '';
    byReason.set(reason, [...(byReason.get(reason) ?? []), e.fullName]);
  }
  for (const [reason, names] of byReason) {
    const line = document.createElement('p');
    line.className = 'problem';
    line.textContent = `${names.join('、')}: ${reason}`;
    box.append(line);
  }

  if (lowRate && rl !== null) {
    const line = document.createElement('p');
    line.className = 'problem';
    line.textContent = t(lang, 'rateLow', { remaining: rl.remaining, limit: rl.limit });
    box.append(line);
  }

  const stuck = waiting.length + failed.length;
  if (stuck > 0) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'link';
    retry.textContent = t(lang, 'retryAll', { n: stuck });
    retry.addEventListener('click', () => {
      for (const e of [...waiting, ...failed]) {
        e.status = 'loading';
        e.error = null;
      }
      render();
      void loadAll();
    });
    box.append(retry);
  }
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
  if (dropped.length === 0 && state.view.chartStyle === 'stacked') {
    note.hidden = false;
    note.textContent = t(lang, 'stackedNote');
  } else if (dropped.length === 0) {
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

  // 1本の線が何を表すかで、線の元データも色の割り当ても変わる
  const byAccount = state.view.seriesBy === 'account';
  const sources = byAccount
    ? accountSeries(
        usable.map((e) => e.series),
        state.view.topAccounts,
        state.view.excludeBots,
      )
    : usable.map((e) => e.series);

  if (sources.length === 0) {
    $('chart-wrap').hidden = true;
    $('legend-panel').hidden = true;
    return;
  }

  // リポジトリ別のときは chips と色を揃えたいので entries 上の位置を使う
  const colorIndexes = byAccount
    ? sources.map((_, i) => i)
    : usable.map((e) => entries.indexOf(e));

  // sources はすでに系列単位に解決済みなので、ここでは repository として扱う
  const series = buildSeries(sources, { ...state.view, seriesBy: 'repository' }).map((s, i) => ({
    ...s,
    colorIndex: colorIndexes[i] ?? i,
  }));

  chart.update(series, state.view, lang);
  $<HTMLCanvasElement>('chart').setAttribute(
    'aria-label',
    `${t(lang, 'ariaChart')}: ${sources.map((r) => r.meta.fullName).join(', ')}`,
  );
  renderLegend(sources, colorIndexes, byAccount);
}

function renderLegend(
  sources: RepoSeries[],
  colorIndexes: number[],
  byAccount: boolean,
): void {
  const body = $('legend-body');
  body.innerHTML = '';
  let truncated = false;
  // アカウント別では「人数」列が常に 1 になり読む意味がないので隠す
  document.querySelector('.legend-table')?.setAttribute('data-series-by',
    byAccount ? 'account' : 'repository');

  for (let n = 0; n < sources.length; n++) {
    const source = sources[n]!;
    const i = colorIndexes[n] ?? n;
    const s = summarize(source, state.view.metric, state.view.granularity);
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
    link.href = byAccount
      ? `https://github.com/${encodeURIComponent(s.fullName)}`
      : source.meta.htmlUrl;
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

/** 重複を避けつつリポジトリを追加し、足りないぶんだけ取得する */
function addRepoNames(names: string[]): void {
  let added = 0;
  for (const full of names) {
    if (state.repos.some((r) => r.toLowerCase() === full.toLowerCase())) continue;
    state.repos.push(full);
    added++;
  }
  if (added === 0) return;
  syncEntries();
  pushUrl();
  void loadAll();
}

/**
 * 入力を処理する。owner/repo の並びならそのまま追加し、
 * オーナー名だけならリポジトリを選ばせるダイアログを開く。
 */
function handleInput(raw: string): void {
  const parsed = classifyInput(raw);
  if (parsed.kind === 'owner') {
    void openPicker(parsed.owner);
    return;
  }
  addRepoNames(parsed.refs.map(refToString));
}

/* ---------- リポジトリ選択ダイアログ ---------- */

interface PickerState {
  owner: string;
  repos: OwnerRepo[];
  hasMore: boolean;
  selected: Set<string>;
}

let picker: PickerState | null = null;

/** 表示中の並び順・絞り込みを適用した一覧 */
function pickerVisible(): OwnerRepo[] {
  if (picker === null) return [];
  const query = $<HTMLInputElement>('picker-search').value.trim().toLowerCase();
  const withForks = $<HTMLInputElement>('picker-forks').checked;
  const withArchived = $<HTMLInputElement>('picker-archived').checked;
  const sort = $<HTMLSelectElement>('picker-sort').value;

  const list = picker.repos.filter((r) => {
    if (!withForks && r.fork) return false;
    if (!withArchived && r.archived) return false;
    if (query === '') return true;
    return (
      r.name.toLowerCase().includes(query) ||
      (r.description ?? '').toLowerCase().includes(query)
    );
  });

  list.sort((a, b) => {
    if (sort === 'stars') return b.stars - a.stars;
    if (sort === 'name') return a.name.localeCompare(b.name);
    return b.pushedAt - a.pushedAt;
  });
  return list;
}

function renderPicker(): void {
  if (picker === null) return;
  const visible = pickerVisible();
  const list = $('picker-list');
  list.innerHTML = '';

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'picker-empty';
    empty.textContent = t(lang, picker.repos.length === 0 ? 'pickerNoRepos' : 'pickerEmpty', {
      owner: picker.owner,
    });
    list.append(empty);
  }

  for (const repo of visible) {
    const li = document.createElement('li');
    const row = document.createElement('label');
    row.className = 'picker-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = picker.selected.has(repo.fullName);
    // すでに読み込み済みのものは選び直させない
    const already = state.repos.some((r) => r.toLowerCase() === repo.fullName.toLowerCase());
    box.disabled = already;
    if (already) box.checked = true;
    box.addEventListener('change', () => {
      if (picker === null) return;
      if (box.checked) picker.selected.add(repo.fullName);
      else picker.selected.delete(repo.fullName);
      renderPickerCost();
    });

    const main = document.createElement('div');
    main.className = 'picker-main';
    const name = document.createElement('div');
    name.className = 'picker-name';
    name.textContent = repo.name;
    if (repo.fork) name.append(badge(t(lang, 'forkBadge')));
    if (repo.archived) name.append(badge(t(lang, 'archivedBadge')));
    const desc = document.createElement('div');
    desc.className = 'picker-desc';
    desc.textContent = repo.description ?? '';
    main.append(name, desc);

    const meta = document.createElement('div');
    meta.className = 'picker-meta';
    meta.textContent = `★ ${numberFormat(repo.stars)} · ${dateFormat(repo.pushedAt)}`;

    row.append(box, main, meta);
    li.append(row);
    list.append(li);
  }

  $('picker-summary').textContent = t(lang, 'pickerSummary', {
    shown: visible.length,
    total: picker.repos.length,
  });
  $('picker-more').hidden = !picker.hasMore;
  renderPickerCost();
}

function badge(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'badge';
  el.textContent = text;
  return el;
}

/**
 * 追加に必要なリクエスト数を出す。
 * 一覧取得でメタ情報はキャッシュ済みなので、1 件につき統計の 1 回だけで済む。
 */
function renderPickerCost(): void {
  if (picker === null) return;
  const fresh = [...picker.selected].filter(
    (full) => !state.repos.some((r) => r.toLowerCase() === full.toLowerCase()),
  );
  const cost = fresh.length;
  const remaining = client.rateLimit?.remaining ?? Infinity;
  const over = cost > remaining;

  const cell = $('picker-cost');
  cell.classList.toggle('over', over);
  cell.textContent = t(lang, over ? 'pickerCostOver' : 'pickerCost', {
    n: fresh.length,
    cost,
    remaining: remaining === Infinity ? '?' : remaining,
  });

  const add = $<HTMLButtonElement>('picker-add');
  add.textContent = t(lang, 'pickerAdd', { n: fresh.length });
  add.disabled = fresh.length === 0;
}

async function openPicker(owner: string): Promise<void> {
  const dialog = $<HTMLDialogElement>('picker-dialog');
  const error = $('form-error');
  try {
    const { repos, hasMore } = await client.fetchOwnerRepos(owner);
    picker = { owner, repos, hasMore, selected: new Set() };
    $('picker-title').textContent = t(lang, 'pickerTitle', { owner });
    $<HTMLInputElement>('picker-search').value = '';
    renderPicker();
    renderRateLimit();
    dialog.showModal();
  } catch (err) {
    error.hidden = false;
    error.textContent = `${owner}: ${
      err instanceof GitHubError ? err.message : (err as Error).message
    }`;
  }
}

function bindPicker(): void {
  const dialog = $<HTMLDialogElement>('picker-dialog');
  for (const id of ['picker-search', 'picker-sort', 'picker-forks', 'picker-archived']) {
    $(id).addEventListener('input', renderPicker);
    $(id).addEventListener('change', renderPicker);
  }
  $('picker-top').addEventListener('click', () => {
    if (picker === null) return;
    picker.selected = new Set(pickerVisible().slice(0, 10).map((r) => r.fullName));
    renderPicker();
  });
  $('picker-none').addEventListener('click', () => {
    if (picker === null) return;
    picker.selected.clear();
    renderPicker();
  });
  $('picker-cancel').addEventListener('click', () => dialog.close());
  $('picker-add').addEventListener('click', () => {
    if (picker === null) return;
    // 一覧の並び順のまま追加すると色の並びが読みやすい
    const order = pickerVisible().map((r) => r.fullName);
    const names = order.filter((n) => picker!.selected.has(n));
    dialog.close();
    addRepoNames(names);
  });
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
      // 穴（その時期に存在しなかった点）は行にしない
      if (p.y === null) continue;
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

  bind<HTMLSelectElement>('chart-style', (el) => {
    state.view.chartStyle = el.value as ChartStyle;
    syncControls();
  });
  bind<HTMLSelectElement>('series-by', (el) => {
    state.view.seriesBy = el.value as SeriesBy;
    // 人はリポジトリの年齢を持たないので、アカウント別では実日付に戻す
    if (state.view.seriesBy === 'account') {
      if (state.view.xMode === 'age') state.view.xMode = 'date';
      // 「貢献者数」は 1 人ずつの線にすると常に 1 になり意味がない
      if (state.view.metric === 'contributors') state.view.metric = 'commits';
    }
    syncControls();
  });
  bind<HTMLSelectElement>('top-accounts', (el) => (state.view.topAccounts = Number(el.value)));
  bind<HTMLSelectElement>('metric', (el) => (state.view.metric = el.value as Metric));
  bind<HTMLSelectElement>('granularity', (el) => (state.view.granularity = el.value as Granularity));
  bind<HTMLSelectElement>('xmode', (el) => (state.view.xMode = el.value as XMode));
  bind<HTMLSelectElement>('normalize', (el) => (state.view.normalize = el.value as Normalize));
  bind<HTMLSelectElement>('smooth', (el) => (state.view.smooth = Number(el.value)));
  bind<HTMLInputElement>('cumulative', (el) => (state.view.cumulative = el.checked));
  bind<HTMLInputElement>('logscale', (el) => (state.view.logScale = el.checked));
  bind<HTMLInputElement>('exclude-bots', (el) => (state.view.excludeBots = el.checked));
}

function syncControls(): void {
  const byAccount = state.view.seriesBy === 'account';
  $<HTMLSelectElement>('chart-style').value = state.view.chartStyle;
  $<HTMLSelectElement>('series-by').value = state.view.seriesBy;
  // 積み上げは「合計の内訳」を見るものなので、ピーク正規化とは噛み合わない
  $<HTMLSelectElement>('normalize').disabled = state.view.chartStyle === 'stacked';
  $<HTMLSelectElement>('top-accounts').value = String(state.view.topAccounts);
  $('top-accounts-field').hidden = !byAccount;
  $('exclude-bots-field').hidden = !byAccount;
  $<HTMLInputElement>('exclude-bots').checked = state.view.excludeBots;
  // 1本の線が指すものが変わるので、凡例の見出しも合わせる
  $('th-name').textContent = t(lang, byAccount ? 'th_account' : 'th_repo');
  // アカウント別では意味を持たない選択肢を選べなくする
  $<HTMLOptionElement>('x-age-option').disabled = byAccount;
  $<HTMLOptionElement>('m-contributors-option').disabled = byAccount;
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

  // GitHub Pages のユーザーサイトは全プロジェクトが同じオリジンに載る。
  // 保存領域はパスではなくオリジン単位なので、その事実を隠さず出す。
  const sharedOrigin = location.hostname.endsWith('.github.io');
  const originNote = $('token-shared-origin');
  originNote.hidden = !sharedOrigin;
  if (sharedOrigin) {
    originNote.textContent = t(lang, 'tokenSharedOrigin', { host: location.hostname });
  }

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
  cachePurgeOld();
  applyTheme();
  applyI18n();
  syncControls();
  bindControls();
  bindTokenDialog();
  bindPicker();

  $<HTMLAnchorElement>('repo-link').href = PROJECT_URL;
  client.onRateLimit = () => {
    renderRateLimit();
    renderProblems();
  };

  $<HTMLFormElement>('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('repo-input');
    handleInput(input.value);
    input.value = '';
  });
  $('load-example').addEventListener('click', () => addRepoNames(EXAMPLE));
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

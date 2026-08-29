import type {
  ContributorSeries,
  Granularity,
  Metric,
  RepoSeries,
  Series,
  ViewOptions,
} from './types';

const WEEK_SEC = 7 * 24 * 60 * 60;
/** unix epoch (1970-01-01) は木曜なので、最初の日曜は 3 日後 */
const FIRST_SUNDAY_SEC = 3 * 24 * 60 * 60;

/** バケットの集計値。contributors だけは重複を除くため集合で持つ */
export interface Bucket {
  /** バケット開始時刻（unix 秒, UTC） */
  start: number;
  /** リポジトリ作成時点を 0 とした経過バケット数 */
  index: number;
  commits: number;
  additions: number;
  deletions: number;
  contributors: Set<number>;
}

/** 与えられた時刻が属するバケットの開始時刻（unix 秒, UTC）を返す */
export function bucketStart(sec: number, g: Granularity): number {
  if (g === 'week') {
    return Math.floor((sec - FIRST_SUNDAY_SEC) / WEEK_SEC) * WEEK_SEC + FIRST_SUNDAY_SEC;
  }
  const d = new Date(sec * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (g === 'month') return Date.UTC(y, m, 1) / 1000;
  if (g === 'quarter') return Date.UTC(y, Math.floor(m / 3) * 3, 1) / 1000;
  return Date.UTC(y, 0, 1) / 1000;
}

/** バケット開始時刻から次のバケット開始時刻へ進める */
export function nextBucketStart(startSec: number, g: Granularity): number {
  if (g === 'week') return startSec + WEEK_SEC;
  const d = new Date(startSec * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (g === 'month') return Date.UTC(y, m + 1, 1) / 1000;
  if (g === 'quarter') return Date.UTC(y, m + 3, 1) / 1000;
  return Date.UTC(y + 1, 0, 1) / 1000;
}

/** origin から数えて何バケット目か。両者ともバケット開始時刻を渡すこと */
export function bucketIndex(startSec: number, originSec: number, g: Granularity): number {
  if (g === 'week') return Math.round((startSec - originSec) / WEEK_SEC);
  const a = new Date(startSec * 1000);
  const o = new Date(originSec * 1000);
  const months =
    (a.getUTCFullYear() - o.getUTCFullYear()) * 12 + (a.getUTCMonth() - o.getUTCMonth());
  if (g === 'month') return months;
  if (g === 'quarter') return Math.round(months / 3);
  return a.getUTCFullYear() - o.getUTCFullYear();
}

/** 週次データを指定粒度のバケットに畳み込む。活動のない期間も 0 で埋めて連続させる */
export function aggregate(repo: RepoSeries, g: Granularity): Bucket[] {
  if (repo.weeks.length === 0) return [];

  const firstWeek = repo.weeks[0]!;
  // 作成日より前のコミットを持つリポジトリ（インポート等）でも負の index にしない
  const originSec = Math.min(Math.floor(repo.meta.createdAt / 1000), firstWeek);
  const originBucket = bucketStart(originSec, g);

  const map = new Map<number, Bucket>();
  const ensure = (start: number): Bucket => {
    let b = map.get(start);
    if (b === undefined) {
      b = { start, index: 0, commits: 0, additions: 0, deletions: 0, contributors: new Set() };
      map.set(start, b);
    }
    return b;
  };

  for (let i = 0; i < repo.weeks.length; i++) {
    const b = ensure(bucketStart(repo.weeks[i]!, g));
    b.commits += repo.commits[i] ?? 0;
    b.additions += repo.additions[i] ?? 0;
    b.deletions += repo.deletions[i] ?? 0;
  }
  for (let c = 0; c < repo.activeWeeks.length; c++) {
    for (const wi of repo.activeWeeks[c]!) {
      const week = repo.weeks[wi];
      if (week === undefined) continue;
      ensure(bucketStart(week, g)).contributors.add(c);
    }
  }

  const starts = [...map.keys()].sort((a, b) => a - b);
  const last = starts[starts.length - 1]!;
  const out: Bucket[] = [];
  for (let s = starts[0]!; s <= last; s = nextBucketStart(s, g)) {
    const b = ensure(s);
    b.index = bucketIndex(s, originBucket, g);
    out.push(b);
  }
  return out;
}

/** 行数の統計を必要とする指標か。取得できないリポジトリを弾くのに使う */
export function isLineMetric(m: Metric): boolean {
  return m === 'additions' || m === 'deletions' || m === 'net' || m === 'churn';
}

export function metricValue(b: Bucket, m: Metric): number {
  switch (m) {
    case 'commits':
      return b.commits;
    case 'additions':
      return b.additions;
    case 'deletions':
      return b.deletions;
    case 'net':
      return b.additions - b.deletions;
    case 'churn':
      return b.additions + b.deletions;
    case 'contributors':
      return b.contributors.size;
  }
}

/**
 * 中央寄せの移動平均。窓が 1 以下ならそのまま返す。
 * 端では窓を前方にずらさず、はみ出したぶんだけ縮める。
 * ずらす実装にすると系列の先頭が遠い未来の値に引きずられ、
 * 「立ち上がりが実際より高い」グラフになってしまう。
 */
export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values.slice();
  const back = Math.floor((window - 1) / 2);
  const forward = window - 1 - back;
  const out: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - back);
    const hi = Math.min(values.length - 1, i + forward);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j]!;
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

export function cumulate(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

/**
 * 累計ユニーク貢献者数。単純な足し算だと同じ人を何度も数えてしまうため、
 * 集合の和をとりながら進める。
 */
export function cumulativeContributors(buckets: Bucket[]): number[] {
  const seen = new Set<number>();
  return buckets.map((b) => {
    for (const c of b.contributors) seen.add(c);
    return seen.size;
  });
}

/** 1リポジトリぶんの系列を、表示オプションに従って組み立てる */
export function seriesFor(repo: RepoSeries, opts: ViewOptions): Series {
  const buckets = aggregate(repo, opts.granularity);
  let values =
    opts.cumulative && opts.metric === 'contributors'
      ? cumulativeContributors(buckets)
      : buckets.map((b) => metricValue(b, opts.metric));

  if (opts.cumulative && opts.metric !== 'contributors') values = cumulate(values);
  values = movingAverage(values, opts.smooth);

  if (opts.normalize === 'peak') {
    const peak = values.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
    if (peak > 0) values = values.map((v) => (v / peak) * 100);
  }

  return {
    fullName: repo.meta.fullName,
    truncated: repo.truncated,
    points: buckets.map((b, i) => ({
      x: opts.xMode === 'date' ? b.start * 1000 : b.index,
      y: values[i] ?? 0,
    })),
  };
}

/**
 * 貢献者の詳細データを、リポジトリと同じ形の RepoSeries に変換する。
 * こうしておくと、以降の集計・平滑化・正規化を系列の種類によらず同じ経路で通せる。
 */
function asRepoSeries(
  base: RepoSeries,
  login: string,
  parts: { detail: ContributorSeries; repo: RepoSeries }[],
  /** 週の unix 秒 -> base.weeks 上の index。呼び出し側で 1 度だけ作って使い回す */
  weekIndex: Map<number, number>,
): RepoSeries {
  const n = base.weeks.length;
  const commits = new Array<number>(n).fill(0);
  const additions = new Array<number>(n).fill(0);
  const deletions = new Array<number>(n).fill(0);
  const active: number[] = [];

  for (const { detail, repo } of parts) {
    for (let k = 0; k < detail.weeks.length; k++) {
      const localIdx = detail.weeks[k]!;
      const weekTs = repo.weeks[localIdx];
      if (weekTs === undefined) continue;
      // リポジトリごとに開始週が違うので、共通の週目盛りに載せ替える
      const i = weekIndex.get(weekTs);
      if (i === undefined) continue;
      commits[i]! += detail.commits[k] ?? 0;
      additions[i]! += detail.additions[k] ?? 0;
      deletions[i]! += detail.deletions[k] ?? 0;
      if ((detail.commits[k] ?? 0) > 0) active.push(i);
    }
  }

  return {
    meta: { ...base.meta, fullName: login },
    weeks: base.weeks,
    commits,
    additions,
    deletions,
    activeWeeks: active.length > 0 ? [active] : [],
    contributors: [],
    truncated: false,
    hasLineStats: parts.some((p) => p.repo.hasLineStats),
  };
}

/**
 * GitHub App のアカウントかどうか。
 * App が作るアカウントの login は必ず "[bot]" で終わるので、それだけを見る。
 * 名前に bot を含むだけの人間を巻き込まないよう、推測は広げない。
 */
export function isBot(login: string): boolean {
  return login.endsWith('[bot]');
}

/**
 * 読み込み済みのリポジトリ群を、アカウント単位の系列に組み替える。
 * 同じ人が複数のリポジトリに出てくる場合は合算する。
 */
export function accountSeries(
  repos: RepoSeries[],
  top: number,
  excludeBots = false,
): RepoSeries[] {
  const usable = repos.filter((r) => r.weeks.length > 0);
  if (usable.length === 0) return [];

  // 全リポジトリを覆う共通の週目盛りを作る
  const starts = usable.map((r) => r.weeks[0]!);
  const ends = usable.map((r) => r.weeks[r.weeks.length - 1]!);
  const from = Math.min(...starts);
  const to = Math.max(...ends);
  const weeks: number[] = [];
  const weekIndex = new Map<number, number>();
  for (let t = from; t <= to; t += WEEK_SEC) {
    weekIndex.set(t, weeks.length);
    weeks.push(t);
  }

  const base: RepoSeries = {
    meta: usable[0]!.meta,
    weeks,
    commits: [],
    additions: [],
    deletions: [],
    activeWeeks: [],
    contributors: [],
    truncated: false,
    hasLineStats: false,
  };

  const byLogin = new Map<string, { detail: ContributorSeries; repo: RepoSeries }[]>();
  for (const repo of usable) {
    for (const detail of repo.contributors) {
      const list = byLogin.get(detail.login);
      if (list === undefined) byLogin.set(detail.login, [{ detail, repo }]);
      else list.push({ detail, repo });
    }
  }

  return [...byLogin.entries()]
    .filter(([login]) => !(excludeBots && isBot(login)))
    .map(([login, parts]) => ({
      login,
      parts,
      total: parts.reduce((sum, p) => sum + p.detail.totalCommits, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top)
    .map(({ login, parts }) => asRepoSeries(base, login, parts, weekIndex));
}

/** 全リポジトリぶんの系列を組み立てる。シェア表示だけは系列をまたいだ正規化が要る */
export function buildSeries(repos: RepoSeries[], opts: ViewOptions): Series[] {
  const sources =
    opts.seriesBy === 'account'
      ? accountSeries(repos, opts.topAccounts, opts.excludeBots)
      : repos;
  let series = sources.map((r) => seriesFor(r, opts));
  series = alignSeries(
    series,
    opts.chartStyle !== 'stacked' ? 'gap' : opts.cumulative ? 'hold' : 'zero',
  );
  if (opts.normalize !== 'share') return series;

  const totals = new Map<number, number>();
  for (const s of series) {
    for (const p of s.points) {
      if (p.y === null) continue;
      totals.set(p.x, (totals.get(p.x) ?? 0) + Math.abs(p.y));
    }
  }
  return series.map((s) => ({
    ...s,
    points: s.points.map((p) => {
      if (p.y === null) return p;
      const total = totals.get(p.x) ?? 0;
      return { x: p.x, y: total > 0 ? (p.y / total) * 100 : 0 };
    }),
  }));
}

/**
 * 全系列の x を共通の目盛りに揃える。
 *
 * Chart.js は積み上げもツールチップの突き合わせも「同じ添字どうし」で行う。
 * 開始時期の違う系列をそのまま渡すと、添字 3 が系列ごとに別の月を指し、
 * 別の時点の値が足されたり並べて表示されたりする。
 *
 * fill は系列の範囲外をどう埋めるか。
 * - gap : null。線を引かない。比較（折れ線・面）ではこれが正しい
 * - zero: 0。積み上げで、活動していない期間は寄与ゼロとして扱う
 * - hold: 開始前は 0、終了後は最後の値。累積の積み上げ用。
 *         ここを 0 にすると、止まったリポジトリの累計が合計から消えてしまう
 */
export function alignSeries(series: Series[], fill: 'gap' | 'zero' | 'hold'): Series[] {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  if (xs.length === 0) return series;

  return series.map((s) => {
    const known = new Map(s.points.map((p) => [p.x, p.y]));
    const last = s.points[s.points.length - 1]?.x ?? -Infinity;
    const lastValue = s.points[s.points.length - 1]?.y ?? 0;

    return {
      ...s,
      points: xs.map((x) => {
        const y = known.get(x);
        if (y !== undefined) return { x, y };
        if (fill === 'gap') return { x, y: null };
        if (x > last && fill === 'hold') return { x, y: lastValue };
        return { x, y: 0 };
      }),
    };
  });
}

export interface Summary {
  fullName: string;
  total: number;
  peak: number;
  /** 活動のあった最初と最後のバケット開始時刻（unix ミリ秒） */
  firstActivity: number | null;
  lastActivity: number | null;
  contributors: number;
  truncated: boolean;
}

/** 凡例テーブルに出す要約。正規化や平滑化を通さない生の値で出す */
export function summarize(repo: RepoSeries, metric: Metric, g: Granularity): Summary {
  const buckets = aggregate(repo, g);
  const values = buckets.map((b) => metricValue(b, metric));
  const all = new Set<number>();
  for (const b of buckets) for (const c of b.contributors) all.add(c);

  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < buckets.length; i++) {
    if (values[i] !== 0) {
      first ??= buckets[i]!.start * 1000;
      last = buckets[i]!.start * 1000;
    }
  }

  return {
    fullName: repo.meta.fullName,
    total: metric === 'contributors' ? all.size : values.reduce((a, b) => a + b, 0),
    peak: values.reduce((a, b) => Math.max(a, b), 0),
    firstActivity: first,
    lastActivity: last,
    contributors: all.size,
    truncated: repo.truncated,
  };
}

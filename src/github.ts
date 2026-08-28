import type {
  ContributorSeries,
  OwnerRepo,
  RepoMeta,
  RepoRef,
  RepoSeries,
  RateLimit,
} from './types';
import { cacheGet, cacheSet } from './cache';

const API = 'https://api.github.com';
const WEEK_SEC = 7 * 24 * 60 * 60;

/** GitHub の stats/* が返す人数の目安。ここに達したら打ち切りを疑う */
const CONTRIBUTOR_CAP = 100;
/** アカウント別の線を引くために詳細を保持する人数の上限（保存量を抑えるため） */
const CONTRIBUTOR_DETAIL_CAP = 60;
/** オーナー一覧を 1 リクエストで取る件数 */
const OWNER_REPOS_PER_PAGE = 100;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind:
      | 'not-found'
      | 'rate-limit'
      | 'unauthorized'
      | 'too-large'
      | 'stats-pending'
      | 'network'
      | 'other',
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** "owner/repo" や GitHub の URL を RepoRef に正規化する */
export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (trimmed === '') return null;
  const withoutHost = trimmed
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '');
  const parts = withoutHost.split('/').filter((p) => p !== '');
  if (parts.length < 2) return null;
  const [owner, name] = parts;
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!owner || !name || !valid.test(owner) || !valid.test(name)) return null;
  return { owner, name };
}

export function refToString(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/**
 * 入力が「リポジトリの並び」なのか「オーナー名ひとつ」なのかを見分ける。
 * オーナー名だけなら、リポジトリを選ばせるダイアログを開くための合図になる。
 */
export function classifyInput(
  raw: string,
): { kind: 'owner'; owner: string } | { kind: 'repos'; refs: RepoRef[] } {
  const tokens = raw.split(/[,\s\n]+/).filter((t) => t !== '');
  if (tokens.length === 1) {
    const only = tokens[0]!
      .trim()
      .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
      .replace(/\/+$/, '');
    if (!only.includes('/') && OWNER_PATTERN.test(only)) {
      return { kind: 'owner', owner: only };
    }
  }
  const refs: RepoRef[] = [];
  for (const token of tokens) {
    const ref = parseRepoRef(token);
    if (ref !== null) refs.push(ref);
  }
  return { kind: 'repos', refs };
}

interface OwnerRepoResponse {
  full_name: string;
  name: string;
  created_at: string;
  pushed_at: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  description: string | null;
  fork: boolean;
  archived: boolean;
  html_url: string;
  default_branch: string;
}

interface ContributorStat {
  author: { login?: string } | null;
  total: number;
  weeks: { w: number; a: number; d: number; c: number }[];
}

export class GitHubClient {
  #token: string | undefined;
  rateLimit: RateLimit | null = null;
  /** レート制限の残量が更新されるたびに呼ばれる */
  onRateLimit: ((rl: RateLimit) => void) | null = null;

  constructor(token?: string) {
    this.#token = token && token.trim() !== '' ? token.trim() : undefined;
  }

  setToken(token: string | undefined): void {
    this.#token = token && token.trim() !== '' ? token.trim() : undefined;
  }

  get hasToken(): boolean {
    return this.#token !== undefined;
  }

  #headers(): HeadersInit {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.#token !== undefined) h['Authorization'] = `Bearer ${this.#token}`;
    return h;
  }

  #readRateLimit(res: Response): void {
    const limit = Number(res.headers.get('x-ratelimit-limit'));
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;
    this.rateLimit = { limit, remaining, reset: reset * 1000 };
    this.onRateLimit?.(this.rateLimit);
  }

  /**
   * stats 系エンドポイントは初回アクセス時に 202 を返し、
   * GitHub 側でバックグラウンド集計が終わるのを待つ必要がある。
   * その 202 を指数バックオフで待ち受ける。
   */
  async #get<T>(path: string, opts: { retry202?: number; signal?: AbortSignal } = {}): Promise<T> {
    const maxRetries = opts.retry202 ?? 0;
    let delay = 1200;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(API + path, { headers: this.#headers(), signal: opts.signal });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new GitHubError('ネットワークに到達できませんでした', 0, 'network');
      }
      this.#readRateLimit(res);

      if (res.status === 202) {
        if (attempt >= maxRetries) {
          throw new GitHubError(
            'GitHub が統計を集計中です。少し待ってからもう一度お試しください',
            202,
            'stats-pending',
          );
        }
        await sleep(delay, opts.signal);
        delay = Math.min(delay * 2, 10_000);
        continue;
      }

      if (res.ok) {
        if (res.status === 204) return [] as unknown as T;
        return (await res.json()) as T;
      }

      throw this.#toError(res, path);
    }
  }

  #toError(res: Response, path: string): GitHubError {
    if (res.status === 404) {
      return new GitHubError(
        'リポジトリが見つかりません（非公開の場合はトークンが必要です）',
        404,
        'not-found',
      );
    }
    if (res.status === 401) {
      return new GitHubError('トークンが無効です', 401, 'unauthorized');
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = this.rateLimit?.remaining;
      if (remaining === 0) {
        const at = this.rateLimit ? new Date(this.rateLimit.reset) : null;
        const when = at ? `${at.getHours()}時${String(at.getMinutes()).padStart(2, '0')}分` : '';
        return new GitHubError(
          `レート制限に達しました。${when ? when + 'に回復します。' : ''}トークンを設定すると上限が 5000 回/時になります`,
          res.status,
          'rate-limit',
        );
      }
      return new GitHubError('GitHub にアクセスを拒否されました', res.status, 'other');
    }
    if (res.status === 422) {
      return new GitHubError(
        'このリポジトリは大きすぎて GitHub が統計を返せませんでした',
        422,
        'too-large',
      );
    }
    return new GitHubError(`GitHub API エラー (${res.status}) ${path}`, res.status, 'other');
  }

  async fetchMeta(ref: RepoRef, signal?: AbortSignal): Promise<RepoMeta> {
    const key = `meta:${refToString(ref).toLowerCase()}`;
    const cached = cacheGet<RepoMeta>(key);
    if (cached !== null) return cached;

    const raw = await this.#get<{
      full_name: string;
      created_at: string;
      pushed_at: string | null;
      stargazers_count: number;
      forks_count: number;
      language: string | null;
      description: string | null;
      archived: boolean;
      html_url: string;
      default_branch: string;
    }>(`/repos/${ref.owner}/${ref.name}`, { signal });

    const meta: RepoMeta = {
      fullName: raw.full_name,
      createdAt: Date.parse(raw.created_at),
      pushedAt: raw.pushed_at ? Date.parse(raw.pushed_at) : Date.parse(raw.created_at),
      stars: raw.stargazers_count,
      forks: raw.forks_count,
      language: raw.language,
      description: raw.description,
      archived: raw.archived,
      htmlUrl: raw.html_url,
      defaultBranch: raw.default_branch,
    };
    cacheSet(key, meta);
    return meta;
  }

  /**
   * オーナー（ユーザーまたは組織）配下のリポジトリ一覧を 1 リクエストで取る。
   *
   * ここで得たメタ情報はそのままメタ用キャッシュに書き込む。
   * 選択されたリポジトリの /repos/{owner}/{repo} が不要になり、
   * 1 件あたりのリクエストが 2 回から 1 回に減る。
   */
  async fetchOwnerRepos(
    owner: string,
    signal?: AbortSignal,
  ): Promise<{ repos: OwnerRepo[]; hasMore: boolean }> {
    const key = `owner:${owner.toLowerCase()}`;
    const cached = cacheGet<{ repos: OwnerRepo[]; hasMore: boolean }>(key);
    if (cached !== null) return cached;

    const raw = await this.#get<OwnerRepoResponse[]>(
      `/users/${owner}/repos?per_page=${OWNER_REPOS_PER_PAGE}&sort=pushed&direction=desc`,
      { signal },
    );

    const repos: OwnerRepo[] = [];
    for (const r of raw) {
      repos.push({
        fullName: r.full_name,
        name: r.name,
        stars: r.stargazers_count,
        pushedAt: r.pushed_at !== null ? Date.parse(r.pushed_at) : 0,
        language: r.language,
        description: r.description,
        fork: r.fork,
        archived: r.archived,
      });
      // 一覧のレスポンスはメタ情報として十分なので、そのままキャッシュしておく
      cacheSet(`meta:${r.full_name.toLowerCase()}`, {
        fullName: r.full_name,
        createdAt: Date.parse(r.created_at),
        pushedAt: r.pushed_at !== null ? Date.parse(r.pushed_at) : Date.parse(r.created_at),
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        description: r.description,
        archived: r.archived,
        htmlUrl: r.html_url,
        defaultBranch: r.default_branch,
      } satisfies RepoMeta);
    }

    const result = { repos, hasMore: raw.length === OWNER_REPOS_PER_PAGE };
    cacheSet(key, result);
    return result;
  }

  /**
   * 1リポジトリぶんの週次アクティビティを取り出す。
   * メタ情報と stats/contributors の 2 リクエストで全期間ぶんが揃う
   * （オーナー一覧から入った場合はメタが既にあるので 1 リクエスト）。
   */
  async fetchSeries(ref: RepoRef, signal?: AbortSignal): Promise<RepoSeries> {
    const key = `series:${refToString(ref).toLowerCase()}`;
    const cached = cacheGet<RepoSeries>(key);
    // プレフィックスの更新を入れ忘れても壊れないよう、形の合わないものは取り直す
    if (cached !== null && isRepoSeries(cached)) return cached;

    const meta = await this.fetchMeta(ref, signal);
    const stats = await this.#get<ContributorStat[]>(
      `/repos/${ref.owner}/${ref.name}/stats/contributors`,
      { retry202: 4, signal },
    );

    const series = buildSeries(meta, Array.isArray(stats) ? stats : []);
    cacheSet(key, series);
    return series;
  }
}

/** キャッシュから読んだ値が現行の RepoSeries の形をしているか確かめる */
export function isRepoSeries(value: unknown): value is RepoSeries {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<RepoSeries>;
  return (
    Array.isArray(v.weeks) &&
    Array.isArray(v.commits) &&
    Array.isArray(v.activeWeeks) &&
    Array.isArray(v.contributors)
  );
}

/** stats/contributors のレスポンスを週次の連続配列に組み直す */
export function buildSeries(meta: RepoMeta, stats: ContributorStat[]): RepoSeries {
  const empty: RepoSeries = {
    meta,
    weeks: [],
    commits: [],
    additions: [],
    deletions: [],
    activeWeeks: [],
    contributors: [],
    truncated: false,
    hasLineStats: false,
  };
  if (stats.length === 0) return empty;

  let min = Infinity;
  let max = -Infinity;
  for (const s of stats) {
    for (const w of s.weeks) {
      if (w.w < min) min = w.w;
      if (w.w > max) max = w.w;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return empty;

  const count = Math.floor((max - min) / WEEK_SEC) + 1;
  const weeks: number[] = new Array(count);
  for (let i = 0; i < count; i++) weeks[i] = min + i * WEEK_SEC;

  const commits = new Array<number>(count).fill(0);
  const additions = new Array<number>(count).fill(0);
  const deletions = new Array<number>(count).fill(0);
  const activeWeeks: number[][] = [];

  const details: ContributorSeries[] = [];

  for (const s of stats) {
    const mine: number[] = [];
    const detail: ContributorSeries = {
      login: s.author?.login ?? '(unknown)',
      weeks: [],
      commits: [],
      additions: [],
      deletions: [],
      totalCommits: 0,
    };

    for (const w of s.weeks) {
      const i = Math.round((w.w - min) / WEEK_SEC);
      if (i < 0 || i >= count) continue;
      if (w.c > 0) {
        commits[i]! += w.c;
        mine.push(i);
      }
      // 追加・削除は c が 0 の週にも入りうる（マージコミット等）ので独立に足す。
      // GitHub は endpoint によって削除行数を負値で返すため、符号を落として足す。
      const a = Math.abs(w.a);
      const d = Math.abs(w.d);
      if (a !== 0) additions[i]! += a;
      if (d !== 0) deletions[i]! += d;

      // 個人単位では大半の週が 0 なので、動きのあった週だけを疎に持つ
      if (w.c > 0 || a > 0 || d > 0) {
        detail.weeks.push(i);
        detail.commits.push(w.c);
        detail.additions.push(a);
        detail.deletions.push(d);
        detail.totalCommits += w.c;
      }
    }
    if (mine.length > 0) activeWeeks.push(mine);
    if (detail.weeks.length > 0) details.push(detail);
  }

  // 保存量を抑えるため、詳細はコミット数の多い順に上位ぶんだけ残す。
  // 人数のカウント（activeWeeks）は全員ぶんを保っているので影響しない。
  details.sort((a, b) => b.totalCommits - a.totalCommits);
  const contributors = details.slice(0, CONTRIBUTOR_DETAIL_CAP);

  const hasCommits = commits.some((v) => v > 0);
  const hasLines = additions.some((v) => v > 0) || deletions.some((v) => v > 0);

  return {
    meta,
    weeks,
    commits,
    additions,
    deletions,
    activeWeeks,
    contributors,
    truncated: stats.length >= CONTRIBUTOR_CAP,
    // コミットはあるのに行数が全週 0 なら、GitHub が行数統計を落としている
    hasLineStats: hasLines || !hasCommits,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

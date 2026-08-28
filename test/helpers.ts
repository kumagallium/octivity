import type { ContributorSeries, RepoMeta, RepoSeries } from '../src/types';

export const WEEK = 7 * 24 * 60 * 60;
/** 2024-01-07 は日曜。GitHub の週境界と同じ基準になる */
export const SUNDAY_2024_01_07 = Date.UTC(2024, 0, 7) / 1000;

export function meta(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return {
    fullName: 'acme/widget',
    createdAt: Date.UTC(2024, 0, 7),
    pushedAt: Date.UTC(2024, 2, 1),
    stars: 0,
    forks: 0,
    language: null,
    description: null,
    archived: false,
    htmlUrl: 'https://github.com/acme/widget',
    defaultBranch: 'main',
    ...overrides,
  };
}

/** 週数ぶんの連続した週配列を持つ RepoSeries を組み立てる */
export function series(opts: {
  start?: number;
  commits: number[];
  additions?: number[];
  deletions?: number[];
  activeWeeks?: number[][];
  metaOverrides?: Partial<RepoMeta>;
  truncated?: boolean;
  hasLineStats?: boolean;
  contributors?: ContributorSeries[];
}): RepoSeries {
  const start = opts.start ?? SUNDAY_2024_01_07;
  const weeks = opts.commits.map((_, i) => start + i * WEEK);
  return {
    meta: meta(opts.metaOverrides),
    weeks,
    commits: opts.commits,
    additions: opts.additions ?? opts.commits.map(() => 0),
    deletions: opts.deletions ?? opts.commits.map(() => 0),
    activeWeeks: opts.activeWeeks ?? [],
    contributors: opts.contributors ?? [],
    truncated: opts.truncated ?? false,
    hasLineStats: opts.hasLineStats ?? true,
  };
}

/** 疎な貢献者データを組み立てる。weeks は RepoSeries.weeks の index */
export function contributor(
  login: string,
  entries: { week: number; c?: number; a?: number; d?: number }[],
): ContributorSeries {
  return {
    login,
    weeks: entries.map((e) => e.week),
    commits: entries.map((e) => e.c ?? 0),
    additions: entries.map((e) => e.a ?? 0),
    deletions: entries.map((e) => e.d ?? 0),
    totalCommits: entries.reduce((sum, e) => sum + (e.c ?? 0), 0),
  };
}

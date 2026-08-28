/** octivity 全体で共有する型定義 */

/** "owner/name" 形式のリポジトリ参照 */
export interface RepoRef {
  owner: string;
  name: string;
}

/** リポジトリのメタ情報（グラフ本体ではなく注釈に使う） */
export interface RepoMeta {
  fullName: string;
  /** リポジトリ作成日時（unix ミリ秒）。横軸「年齢」モードの原点になる */
  createdAt: number;
  pushedAt: number;
  stars: number;
  forks: number;
  language: string | null;
  description: string | null;
  archived: boolean;
  htmlUrl: string;
  defaultBranch: string;
}

/**
 * 1人の貢献者の週次アクティビティ。
 * リポジトリ全体では週数ぶんの密な配列だが、個人単位ではほとんどの週が 0 になるため、
 * 活動のあった週だけを疎に持つ。weeks[i] と commits[i] などが対応する。
 */
export interface ContributorSeries {
  login: string;
  /** RepoSeries.weeks の index */
  weeks: number[];
  commits: number[];
  additions: number[];
  deletions: number[];
  totalCommits: number;
}

/**
 * 1リポジトリぶんの週次アクティビティ。
 * weeks は GitHub の週境界（日曜 00:00 UTC）の unix 秒で、欠測週も 0 埋めして連続させる。
 * 同じ index が commits / additions / deletions に対応する。
 */
export interface RepoSeries {
  meta: RepoMeta;
  weeks: number[];
  commits: number[];
  additions: number[];
  deletions: number[];
  /**
   * コントリビュータごとの「コミットがあった週の index」一覧。
   * 任意の粒度で「その期間に活動した実人数」を重複なく数えるために持つ。
   * 人数を正しく数えるため、返ってきた全員ぶんを保持する。
   */
  activeWeeks: number[][];
  /**
   * アカウント別に線を引くための詳細データ。
   * 保存量を抑えるため、コミット数の多い上位ぶんだけを持つ。
   */
  contributors: ContributorSeries[];
  /**
   * GitHub は貢献者の多いリポジトリでは上位ぶんしか返さないため、
   * 合計値が下限になっている可能性があることを示す。
   */
  truncated: boolean;
  /**
   * 行数の統計が得られたかどうか。
   * 大きなリポジトリでは GitHub がコミット数だけを返し、
   * 追加・削除行数を全週 0 で返してくることがある。
   * これを区別しないと「変更が無かった」ように読めてしまう。
   */
  hasLineStats: boolean;
}

export type Metric =
  | 'commits'
  | 'additions'
  | 'deletions'
  | 'net'
  | 'churn'
  | 'contributors';

/** 1本の線が何を表すか */
export type SeriesBy = 'repository' | 'account';

/** オーナー配下のリポジトリ一覧の1件（選択ダイアログ用） */
export interface OwnerRepo {
  fullName: string;
  name: string;
  stars: number;
  pushedAt: number;
  language: string | null;
  description: string | null;
  fork: boolean;
  archived: boolean;
}

export type Granularity = 'week' | 'month' | 'quarter' | 'year';

/** 横軸のモード: 実日付か、リポジトリ作成からの経過期間か */
export type XMode = 'date' | 'age';

/** 系列間の縦軸スケール合わせ */
export type Normalize = 'none' | 'peak' | 'share';

export interface ViewOptions {
  metric: Metric;
  /** 系列の単位。アカウント別のときは上位 topAccounts 人だけを描く */
  seriesBy: SeriesBy;
  topAccounts: number;
  /** ボットのアカウントを除くか（アカウント別のときだけ効く） */
  excludeBots: boolean;
  granularity: Granularity;
  xMode: XMode;
  /** 累積和にするか（コミット数なら「累計コミット数」曲線になる） */
  cumulative: boolean;
  /** 移動平均の窓（バケット数）。1 なら平滑化なし */
  smooth: number;
  normalize: Normalize;
  /** 縦軸を対数にするか */
  logScale: boolean;
}

/** グラフに流し込む1系列 */
export interface Series {
  fullName: string;
  points: { x: number; y: number }[];
  truncated: boolean;
  /** 配色を決める番号。凡例やチップと色を揃えるため呼び出し側が指定する */
  colorIndex?: number;
}

export interface RateLimit {
  limit: number;
  remaining: number;
  /** リセット時刻（unix ミリ秒） */
  reset: number;
}

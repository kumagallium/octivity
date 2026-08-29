/**
 * 表示言語。ブラウザの設定から自動判定し、ヘッダーで切り替えられる。
 * OSS として日本語圏の外にも届かせたいので、UI は日英どちらでも成立させる。
 */
export type Lang = 'ja' | 'en';

const DICT = {
  tagline: {
    ja: '複数の GitHub リポジトリのアクティビティを 1 枚のグラフで比べる',
    en: 'Compare the activity of multiple GitHub repositories on one chart',
  },
  addRepo: { ja: 'リポジトリを追加', en: 'Add repository' },
  repoPlaceholder: { ja: 'owner/repo（カンマ・改行区切りで複数可）', en: 'owner/repo (comma or newline separated)' },
  add: { ja: '追加', en: 'Add' },
  examples: { ja: '例を読み込む', en: 'Load an example' },
  clearAll: { ja: 'すべて消す', en: 'Clear all' },
  metric: { ja: '指標', en: 'Metric' },
  seriesBy: { ja: '系列', en: 'Series' },
  chartStyle: { ja: '表示', en: 'Style' },
  a_line: { ja: '折れ線', en: 'Lines' },
  a_area: { ja: '面', en: 'Area' },
  a_stacked: { ja: '積み上げ面', en: 'Stacked area' },
  stackedNote: {
    ja: '積み上げ面は各系列を足し合わせたものです。一番上の輪郭が全体の合計で、帯の厚みがその系列の寄与を表します。系列どうしの大小を比べたいときは折れ線に戻してください。',
    en: 'A stacked area sums the series: the top edge is the combined total and each band\u2019s thickness is that series\u2019 contribution. Switch back to lines to compare series against each other.',
  },
  b_repository: { ja: 'リポジトリ別', en: 'By repository' },
  b_account: { ja: 'アカウント別', en: 'By account' },
  topAccounts: { ja: '人数', en: 'Show' },
  topN: { ja: '上位 {n} 人', en: 'Top {n}' },
  accountXAgeNote: {
    ja: 'アカウント別のときは横軸を実日付に固定します（人はリポジトリの年齢を持たないため）。',
    en: 'The x axis is fixed to calendar dates for accounts — a person has no repository age.',
  },
  accountCapNote: {
    ja: '各リポジトリのコミット上位 {n} 人ぶんを対象にしています。',
    en: 'Built from the top {n} committers of each repository.',
  },
  granularity: { ja: '粒度', en: 'Granularity' },
  xAxis: { ja: '横軸', en: 'X axis' },
  smooth: { ja: '平滑化', en: 'Smoothing' },
  normalize: { ja: '正規化', en: 'Normalize' },
  cumulative: { ja: '累積', en: 'Cumulative' },
  logScale: { ja: '対数軸', en: 'Log scale' },
  m_commits: { ja: 'コミット数', en: 'Commits' },
  m_additions: { ja: '追加行数', en: 'Lines added' },
  m_deletions: { ja: '削除行数', en: 'Lines deleted' },
  m_net: { ja: '純増行数', en: 'Net lines' },
  m_churn: { ja: '変更行数（追加+削除）', en: 'Churn (added + deleted)' },
  m_contributors: { ja: '貢献者数', en: 'Contributors' },
  g_week: { ja: '週', en: 'Weekly' },
  g_month: { ja: '月', en: 'Monthly' },
  g_quarter: { ja: '四半期', en: 'Quarterly' },
  g_year: { ja: '年', en: 'Yearly' },
  x_date: { ja: '実日付', en: 'Calendar date' },
  x_age: { ja: 'リポジトリ年齢', en: 'Repository age' },
  n_none: { ja: 'なし（生の値）', en: 'None (raw)' },
  n_peak: { ja: 'ピーク = 100', en: 'Peak = 100' },
  n_share: { ja: 'シェア（%）', en: 'Share (%)' },
  s_none: { ja: 'なし', en: 'Off' },
  smoothN: { ja: '{n} バケット', en: '{n} buckets' },
  th_repo: { ja: 'リポジトリ', en: 'Repository' },
  th_account: { ja: 'アカウント', en: 'Account' },
  excludeBots: { ja: 'ボットを除く', en: 'Exclude bots' },
  th_total: { ja: '合計', en: 'Total' },
  th_peak: { ja: 'ピーク', en: 'Peak' },
  th_first: { ja: '初回', en: 'First' },
  th_last: { ja: '最終', en: 'Last' },
  th_people: { ja: '人数', en: 'People' },
  copyUrl: { ja: 'URL をコピー', en: 'Copy URL' },
  copied: { ja: 'コピーしました', en: 'Copied' },
  exportCsv: { ja: 'CSV', en: 'CSV' },
  exportPng: { ja: 'PNG', en: 'PNG' },
  token: { ja: 'トークン', en: 'Token' },
  tokenTitle: { ja: 'アクセストークン（任意）', en: 'Access token (optional)' },
  tokenHelp: {
    ja: '未設定でも公開リポジトリなら動きます（1 時間あたり 60 リクエスト）。トークンを入れると 5000 リクエスト／時になります。必要な権限は Public repositories の read-only だけです。',
    en: 'Works without a token for public repositories (60 requests/hour). With a token you get 5,000/hour. Read-only access to public repositories is all it needs.',
  },
  tokenSafety: {
    ja: 'トークンはこのブラウザから出ません。中継サーバーは存在せず、通信先は api.github.com だけです（CSP で強制）。共有 URL にも含まれません。',
    en: 'Your token never leaves this browser. There is no relay server, and the page can only connect to api.github.com (enforced by CSP). It is never put in the shareable URL.',
  },
  tokenSharedOrigin: {
    ja: 'このページは {host} 配下にあります。ブラウザの保存領域はパスではなくドメイン単位なので、同じドメインの他の GitHub Pages からも保存したトークンを読めます。権限は「public リポジトリの読み取り」だけに絞ってください。それなら万一漏れても、公開情報が読まれる以上のことは起きません。',
    en: 'This page is served from {host}. Browser storage is scoped to the domain, not the path, so any other GitHub Pages site on the same domain can read a stored token. Keep the token limited to read-only access to public repositories — then a leak exposes nothing beyond what is already public.',
  },
  tokenRemember: { ja: 'このブラウザに保存する', en: 'Remember in this browser' },
  tokenRememberHelp: {
    ja: 'オフならタブを閉じた時点で消えます。共用の端末ではオフのままにしてください。',
    en: 'When off, the token is discarded when you close the tab. Leave it off on shared machines.',
  },
  tokenCreate: { ja: 'トークンを作る', en: 'Create a token' },
  tokenFramed: {
    ja: 'このページは別のサイトに埋め込まれています。入力内容が読み取られる可能性があるため、トークンの入力は受け付けません。octivity を直接開いてください。',
    en: 'This page is embedded in another site. Token entry is disabled here because the surrounding page could observe it — open octivity directly instead.',
  },
  save: { ja: '保存', en: 'Save' },
  remove: { ja: '削除', en: 'Remove' },
  close: { ja: '閉じる', en: 'Close' },
  rateLimit: { ja: '残り {remaining}/{limit} リクエスト', en: '{remaining}/{limit} requests left' },
  rateReset: { ja: '{time} に回復', en: 'resets at {time}' },
  cacheCleared: { ja: 'キャッシュを消しました', en: 'Cache cleared' },
  clearCache: { ja: 'キャッシュを消す', en: 'Clear cache' },
  loading: { ja: '取得中…', en: 'Loading…' },
  emptyTitle: { ja: 'リポジトリを追加すると比較が始まります', en: 'Add a repository to start comparing' },
  pickerTitle: { ja: '{owner} のリポジトリ', en: 'Repositories of {owner}' },
  pickerSummary: {
    ja: '{shown} 件を表示中（全 {total} 件）。フォークとアーカイブは既定で隠しています。',
    en: 'Showing {shown} of {total}. Forks and archived repositories are hidden by default.',
  },
  pickerHasMore: {
    ja: '100 件を超えるため、更新の新しい順に 100 件だけ取得しています。',
    en: 'More than 100 repositories — only the 100 most recently pushed were fetched.',
  },
  pickerForkNote: {
    ja: 'フォークの統計は上流の履歴を丸ごと含むため、比較に混ぜると誤読のもとになります。',
    en: 'A fork\u2019s statistics include the entire upstream history, which distorts a comparison.',
  },
  pickerSearch: { ja: '絞り込み', en: 'Filter' },
  pickerIncludeForks: { ja: 'フォークも表示', en: 'Include forks' },
  pickerIncludeArchived: { ja: 'アーカイブも表示', en: 'Include archived' },
  pickerSortPushed: { ja: '更新が新しい順', en: 'Recently pushed' },
  pickerSortStars: { ja: 'スターが多い順', en: 'Most stars' },
  pickerSortName: { ja: '名前順', en: 'Name' },
  pickerSelectTop: { ja: '上位 10 件を選ぶ', en: 'Select top 10' },
  pickerSelectNone: { ja: '選択を解除', en: 'Clear selection' },
  pickerCost: {
    ja: '{n} 件を選択中 — 追加すると {cost} リクエスト消費します（残り {remaining}）',
    en: '{n} selected — adding them costs {cost} requests ({remaining} left)',
  },
  pickerCostOver: {
    ja: '{n} 件を選択中 — {cost} リクエスト必要ですが残りは {remaining} です。減らすか、トークンを設定してください。',
    en: '{n} selected — this needs {cost} requests but only {remaining} remain. Select fewer, or set a token.',
  },
  pickerAdd: { ja: '{n} 件を追加', en: 'Add {n}' },
  pickerEmpty: { ja: '条件に合うリポジトリがありません', en: 'No repositories match' },
  pickerNoRepos: { ja: '{owner} に公開リポジトリがありません', en: '{owner} has no public repositories' },
  archivedBadge: { ja: 'アーカイブ', en: 'archived' },
  forkBadge: { ja: 'フォーク', en: 'fork' },
  emptyBody: {
    ja: 'owner/repo の形式か、GitHub の URL をそのまま貼り付けてください。設定は URL に入るので、そのまま共有できます。',
    en: 'Enter owner/repo, or paste a GitHub URL. Your settings live in the URL, so you can share the result as-is.',
  },
  noData: { ja: 'このリポジトリには集計できるコミットがありません', en: 'No commit statistics available for this repository' },
  truncatedNote: {
    ja: '※ の付いたリポジトリは貢献者が多く、GitHub が返す上位ぶんだけの集計です。合計は下限とみてください。',
    en: 'Repositories marked * have many contributors; GitHub returns only the top ones, so their totals are a lower bound.',
  },
  noLineStats: {
    ja: '{names} は GitHub が行数の統計を返さないため（リポジトリが大きすぎる）、行数系の指標では除外しています。コミット数と貢献者数は使えます。',
    en: 'GitHub does not provide line statistics for {names} (the repository is too large), so it is excluded from line-based metrics. Commits and contributors still work.',
  },
  noLineStatsAll: {
    ja: '選択中のリポジトリはいずれも GitHub が行数の統計を返しません。コミット数か貢献者数に切り替えてください。',
    en: 'GitHub provides no line statistics for any of the selected repositories. Switch to commits or contributors.',
  },
  unit_week: { ja: '{n} 週目', en: 'Week {n}' },
  unit_month: { ja: '{n} か月目', en: 'Month {n}' },
  unit_quarter: { ja: '{n} 四半期目', en: 'Quarter {n}' },
  unit_year: { ja: '{n} 年目', en: 'Year {n}' },
  ariaChart: { ja: 'リポジトリ別アクティビティの折れ線グラフ', en: 'Line chart of activity by repository' },
  removeRepo: { ja: '{name} を外す', en: 'Remove {name}' },
  retry: { ja: '再試行', en: 'Retry' },
  retryAll: { ja: '失敗した {n} 件を再試行', en: 'Retry {n} failed' },
  retryOne: { ja: '{name} を再試行', en: 'Retry {name}' },
  pending: { ja: '集計待ち', en: 'Waiting' },
  errorPending: {
    ja: '{n} 件は GitHub が初めて統計を作っているところです。1 分ほど置いて再試行してください（一度作られれば次からはすぐ表示されます）。',
    en: 'GitHub is building statistics for {n} repositories for the first time. Wait about a minute and retry — once built, they load instantly.',
  },
  errorOther: { ja: '{detail}', en: '{detail}' },
  rateLow: {
    ja: '残りリクエストが少なくなっています（{remaining}/{limit}）。トークンを設定すると 5000 回/時になります。',
    en: 'Few requests left ({remaining}/{limit}). Setting a token raises the limit to 5,000/hour.',
  },
} as const;

export type MessageKey = keyof typeof DICT;

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function t(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let out: string = DICT[key][lang];
  if (vars !== undefined) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

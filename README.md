# octivity

Compare the activity of multiple GitHub repositories on a single timeline chart.
Runs entirely in your browser — no server, no install, no sign-up.

**[Open the app →](https://kumagallium.github.io/octivity/)**

[日本語の説明は下にあります](#日本語)

---

## What it does

Type a few `owner/repo` names and get one chart with every repository on it.
Type just an **account name** — `vitejs`, `kumagallium` — and pick from its repositories
instead of typing each one.

- Draw one line **per repository**, or **per account** — the same data, regrouped, so you
  can see who was carrying a project and when. Bots are excluded by default
- Three styles: **lines** for comparing series against each other, **area** when there are
  only a few, and **stacked area** when the question is the combined total and how each
  repository contributes to it. Series are labelled at the end of each line, so there is
  no legend to look back and forth to
- **Commits**, **lines added**, **lines deleted**, **net lines**, **churn**, **contributors**
- **Weekly / monthly / quarterly / yearly** buckets
- Two time axes: **calendar date**, or **repository age** — the latter lines every
  repository up at its own week zero, so a two-year-old project and a
  twelve-year-old one can be compared on equal footing
- **Cumulative** mode (cumulative net lines ≈ how the codebase grew; cumulative
  contributors counts *unique* people, not the same person over and over)
- Centered moving average, peak-normalisation, share-of-total, log scale
- Export the view as **CSV** or **PNG**, or just copy the URL — every setting
  lives in the query string, so a link reproduces exactly what you are looking at

## How it gets the data

Straight from your browser to `api.github.com`:

| Request | What it gives |
|---|---|
| `GET /repos/{owner}/{repo}` | creation date, description, stars |
| `GET /repos/{owner}/{repo}/stats/contributors` | **the whole history**, week by week, per contributor: commits, lines added, lines deleted |
| `GET /users/{owner}/repos` | the repository list behind the account picker |

Two requests per repository — or **one**, when you came in through the account picker,
because that listing already carries everything the first request would have returned
and is written straight into the cache. The picker shows how many requests your
selection will cost and how many you have left, so you can see the bill before paying it.

Per-account lines cost nothing extra: `stats/contributors` is already per contributor,
so switching the series from repositories to accounts is a regrouping, not a new fetch.

Results are cached in `localStorage` for six hours, so revisiting a comparison costs nothing.

## Limits you should know about

These are GitHub's limits, not bugs — but they change how you should read the chart:

- **Contributor cap.** For repositories with many contributors, GitHub returns only
  the top slice. Those repositories are marked `*` and their totals are a **lower
  bound**, not the true total.
- **No line counts on large repositories.** Above roughly 10,000 commits GitHub
  stops reporting additions and deletions and returns commit counts only. octivity
  detects this and **excludes those repositories from line-based metrics**, telling
  you which ones and why, rather than drawing a misleading flat zero line.
  There is no workaround — `stats/code_frequency` returns `422` for the same
  repositories.
- **The very first look at a repository can fail.** GitHub computes these statistics
  lazily: the first request starts a background job and answers `202` until it finishes.
  octivity waits about 40 seconds, then hands you a retry button — retrying almost always
  succeeds, and the repository loads instantly from then on. This is most likely on
  repositories nobody has opened the Insights tab for, which usually means your own.
  Very large repositories also return very large responses (webpack's is ~34 MB).
- **Rate limit.** 60 requests/hour without a token, 5,000 with one, counted per IP
  address. The remaining count is shown in the footer, and a warning appears once it
  runs low. Comparing a dozen repositories at once is what usually exhausts it.
- **Accounts are built from the top committers** of each repository (up to 60 per
  repository), which is what the per-account view draws from. The repository-level
  contributor *count* still uses everyone GitHub returned.
- **Pull requests are not available.** GitHub's statistics API has no PR data, and
  counting PRs any other way costs roughly one request per 100 pull requests — a
  repository like vite would take about 100 requests on its own. That does not fit in
  the two-requests-per-repository budget this tool is built around.
- **Weeks are GitHub's weeks** — Sunday 00:00 UTC boundaries. Month, quarter, and
  year buckets are built by summing those weeks, so a week that straddles a month
  boundary lands in the month its Sunday falls in.

## Your access token

A token is optional and only raises the rate limit. If you use one:

- It goes **only** to `api.github.com`. There is no relay server — GitHub Pages
  serves static files and nothing else.
- The deployed page ships a Content-Security-Policy with
  `connect-src https://api.github.com`, so even if something were injected into the
  page, it could not transmit your token anywhere else.
- It is sent in an `Authorization` header, never as a query parameter, so it does not
  end up in server logs, proxy logs, browser history, or `Referer` headers.
- It is **never** written to the URL, so shared links never carry it.
- It is stored in `sessionStorage` by default and disappears when you close the tab.
  Persisting it to `localStorage` is a separate, explicit opt-in.
- **But note the origin.** GitHub Pages serves every project site of an account from a
  single domain — `you.github.io/octivity/` shares an origin with `you.github.io/` and
  every other project you publish. Browser storage is scoped to the origin, not the path,
  so any of those pages can read a stored token. This is how GitHub Pages works, not
  something octivity can fix, and the app says so in the token dialog.
- Which is why the recommendation is a **fine-grained token limited to read-only access
  to public repositories**. That is all octivity needs, and a token that weak grants an
  attacker nothing beyond reading what is already public.

If you would rather not trust a hosted page with a token at all, run it locally:
the app is identical.

## Run it locally

```bash
git clone https://github.com/kumagallium/octivity.git
cd octivity
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck, then build into `dist/` |
| `npm test` | run the unit tests |
| `npm run typecheck` | TypeScript only |

Deploying your own copy: enable GitHub Pages with "GitHub Actions" as the source.
`.github/workflows/deploy.yml` handles the rest, and the build uses relative paths,
so it works at any URL without configuration.

## How it is built

No framework. TypeScript, Vite, and Chart.js — one runtime dependency, deliberately,
because a page that handles access tokens should have as small a supply chain as
possible.

```
src/
  github.ts    GitHub API client — 202 retries, rate limits, error mapping
  metrics.ts   pure aggregation: bucketing, cumulation, smoothing, normalisation
  chart.ts     Chart.js configuration and date-axis ticks
  state.ts     URL query string <-> application state
  cache.ts     localStorage cache with TTL and eviction
  main.ts      wiring
```

`metrics.ts` and `state.ts` are pure and covered by tests. Contributions welcome —
if you change aggregation behaviour, please add a test alongside it.

## License

MIT. Not affiliated with GitHub, Inc.

---

<a id="日本語"></a>

# octivity（日本語）

複数の GitHub リポジトリのアクティビティを、1 枚の時系列グラフで比較するツールです。
ブラウザだけで動きます。サーバーもインストールもアカウント登録も不要です。

**[アプリを開く →](https://kumagallium.github.io/octivity/)**

## できること

`owner/repo` をいくつか入れると、全部を重ねた 1 枚のグラフになります。
**アカウント名だけ**（`vitejs`、`kumagallium` など）を入れると、そのアカウントの
リポジトリ一覧から選べます。1つずつ打ち込む必要はありません。

- 線の単位を**リポジトリ別**と**アカウント別**で切り替えられます。同じデータの
  組み替えなので、「誰がいつそのプロジェクトを支えていたか」がそのまま見えます。
  ボットは既定で除外します
- 表示は 3 種類。系列どうしを比べるなら**折れ線**、本数が少ないときは**面**、
  「全体の合計と、そこへの各リポジトリの寄与」を見たいときは**積み上げ面**です。
  系列名は線の終端に直接置いてあるので、凡例と視線を往復する必要がありません
- **コミット数**・**追加行数**・**削除行数**・**純増行数**・**変更行数**・**貢献者数**
- **週 / 月 / 四半期 / 年** の粒度
- 横軸は 2 通り。**実日付**と、**リポジトリ年齢**。後者は各リポジトリを自分の
  0 週目に揃えるので、2 年目のプロジェクトと 12 年目のプロジェクトを同じ土俵で比べられます
- **累積**モード（累積純増行数はコードの成長曲線に、累積貢献者数は同じ人を
  二重に数えない実人数になります）
- 中央寄せ移動平均、ピーク正規化、シェア表示、対数軸
- **CSV** / **PNG** 書き出し、URL コピー。設定はすべてクエリ文字列に入るので、
  リンクを渡せば同じ画面が再現されます

## データの取り方

ブラウザから `api.github.com` を直接叩きます。

| リクエスト | 得られるもの |
|---|---|
| `GET /repos/{owner}/{repo}` | 作成日・説明・スター数 |
| `GET /repos/{owner}/{repo}/stats/contributors` | **全期間**の週次データ（貢献者別のコミット数・追加行数・削除行数） |
| `GET /users/{owner}/repos` | アカウント指定時のリポジトリ一覧 |

1 リポジトリにつき 2 リクエスト。ただしアカウント一覧から選んだ場合は**1 リクエスト**です。
一覧のレスポンスが 1 つ目のリクエストで得られる情報をすべて含んでいるので、
そのままキャッシュに書き込んでいます。選択ダイアログには消費するリクエスト数と残量を
出しているので、払う前に金額が見えます。

アカウント別の線に追加コストはかかりません。`stats/contributors` はもともと
貢献者ごとのデータなので、系列の単位を変えるのは取得ではなく組み替えです。

結果は `localStorage` に 6 時間キャッシュされます。

## 知っておくべき制約

いずれも GitHub 側の仕様で、グラフの読み方に関わります。

- **貢献者の打ち切り。** 貢献者が多いリポジトリでは GitHub が上位ぶんしか返しません。
  該当するものには `*` を付けており、合計値は**下限**とみなしてください。
- **大きなリポジトリでは行数が取れない。** おおむね 1 万コミットを超えると、GitHub は
  追加・削除行数の報告をやめてコミット数だけを返します。octivity はこれを検出して、
  行数系の指標から**そのリポジトリを除外**し、理由を明示します。0 の直線を引くと
  「変更がなかった」と誤読されるためです。回避策はありません
  （`stats/code_frequency` も同じリポジトリでは 422 を返します）。
- **初めて見るリポジトリは 1 回目が失敗することがある。** GitHub は統計を遅延生成します。
  最初のリクエストが集計を起動し、終わるまで `202` を返し続けます。octivity は約 40 秒
  待ってから再試行ボタンを出します。押せばたいてい通り、以降は即座に表示されます。
  Insights タブを誰も開いていないリポジトリで起きやすく、それはたいてい自分のリポジトリです。
  巨大なリポジトリはレスポンス自体も大きく、webpack で約 34 MB あります。
- **レート制限。** トークンなしで 60 回/時、ありで 5000 回/時。IP アドレス単位で数えられます。
  残量はフッターに出て、少なくなると警告が出ます。十数個のリポジトリを一度に並べると
  だいたいここで尽きます。
- **アカウント別の線は各リポジトリのコミット上位者**（リポジトリあたり最大 60 人）から
  組み立てています。リポジトリ単位の「貢献者数」は GitHub が返した全員を数えています。
- **プルリク数は扱えません。** GitHub の統計 API に PR のデータはなく、別の方法で数えると
  PR 100 件あたり約 1 リクエストかかります。vite なら単体で約 100 リクエストです。
  このツールが前提にしている「1 リポジトリ 2 リクエスト」には収まりません。
- **週の境界は GitHub の定義**（日曜 00:00 UTC）です。月・四半期・年はその週を
  合算して作るので、月をまたぐ週は日曜が属する月に入ります。

## アクセストークンについて

トークンは任意で、レート制限を上げるためだけのものです。使う場合:

- 送信先は `api.github.com` **のみ**です。中継サーバーは存在しません
  （GitHub Pages は静的ファイルを配るだけです）。
- 配信ページには `connect-src https://api.github.com` を含む CSP が付いています。
  仮にページに何かが混入しても、トークンを他所へ送り出すことはできません。
- `Authorization` ヘッダーで送ります。クエリ文字列には載せないので、サーバーログ・
  プロキシのログ・ブラウザ履歴・`Referer` ヘッダーのいずれにも残りません。
- URL には**決して**載せません。共有リンクからは漏れません。
- 既定では `sessionStorage` に置かれ、タブを閉じると消えます。
  `localStorage` への永続化は明示的なオプトインです。
- **ただしオリジンに注意。** GitHub Pages はアカウント配下の全プロジェクトを 1 つの
  ドメインで配ります。`you.github.io/octivity/` は `you.github.io/` や他の公開プロジェクトと
  同じオリジンです。ブラウザの保存領域はパスではなくオリジン単位なので、それらのページからも
  保存したトークンを読めます。これは GitHub Pages の仕組みであって octivity では直せません。
  アプリのトークン画面にも同じ注意を出しています。
- だからこそ勧めるのが **fine-grained token の「public リポジトリの読み取りのみ」** です。
  octivity に必要なのはそれだけで、その権限しかないトークンは、漏れても
  「すでに公開されている情報を読む」以上のことに使えません。

ホストされたページにトークンを預けたくない場合は、手元で動かしてください。中身は同一です。

## 手元で動かす

```bash
git clone https://github.com/kumagallium/octivity.git
cd octivity
npm install
npm run dev
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（ホットリロード） |
| `npm run build` | 型チェックしてから `dist/` にビルド |
| `npm test` | ユニットテスト |
| `npm run typecheck` | 型チェックのみ |

自分の環境に配置する場合は、GitHub Pages のソースを「GitHub Actions」にするだけです。
あとは `.github/workflows/deploy.yml` が処理します。ビルドは相対パスなので、
どの URL に置いても設定なしで動きます。

## 構成

フレームワークなし。TypeScript + Vite + Chart.js で、実行時依存は 1 つだけです。
アクセストークンを扱うページのサプライチェーンは、小さいほどよいという判断です。

```
src/
  github.ts    GitHub API クライアント（202 リトライ・レート制限・エラー変換）
  metrics.ts   純粋な集計（バケット化・累積・平滑化・正規化）
  chart.ts     Chart.js の設定と日付軸の目盛り生成
  state.ts     URL クエリ文字列 <-> アプリケーション状態
  cache.ts     TTL と追い出し付きの localStorage キャッシュ
  main.ts      配線
```

`metrics.ts` と `state.ts` は純粋関数でテスト済みです。集計の挙動を変える場合は、
テストも一緒に足してください。

## ライセンス

MIT。GitHub, Inc. とは無関係です。

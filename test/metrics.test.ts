import { describe, expect, it } from 'vitest';
import {
  accountSeries,
  aggregate,
  alignSeries,
  bucketIndex,
  bucketStart,
  buildSeries,
  cumulate,
  cumulativeContributors,
  isBot,
  isLineMetric,
  metricValue,
  movingAverage,
  nextBucketStart,
  seriesFor,
  summarize,
} from '../src/metrics';
import { DEFAULT_VIEW } from '../src/state';
import type { Metric, ViewOptions } from '../src/types';
import { SUNDAY_2024_01_07, WEEK, contributor, series } from './helpers';

const view = (o: Partial<ViewOptions> = {}): ViewOptions => ({ ...DEFAULT_VIEW, ...o });

describe('bucketStart', () => {
  it('週は日曜 00:00 UTC に丸める', () => {
    const wednesday = SUNDAY_2024_01_07 + 3 * 24 * 3600;
    expect(bucketStart(wednesday, 'week')).toBe(SUNDAY_2024_01_07);
    expect(bucketStart(SUNDAY_2024_01_07, 'week')).toBe(SUNDAY_2024_01_07);
  });

  it('月・四半期・年は UTC の境界に丸める', () => {
    const may15 = Date.UTC(2023, 4, 15) / 1000;
    expect(bucketStart(may15, 'month')).toBe(Date.UTC(2023, 4, 1) / 1000);
    expect(bucketStart(may15, 'quarter')).toBe(Date.UTC(2023, 3, 1) / 1000);
    expect(bucketStart(may15, 'year')).toBe(Date.UTC(2023, 0, 1) / 1000);
  });
});

describe('nextBucketStart', () => {
  it('年をまたいで正しく進む', () => {
    expect(nextBucketStart(Date.UTC(2023, 11, 1) / 1000, 'month')).toBe(Date.UTC(2024, 0, 1) / 1000);
    expect(nextBucketStart(Date.UTC(2023, 9, 1) / 1000, 'quarter')).toBe(Date.UTC(2024, 0, 1) / 1000);
    expect(nextBucketStart(Date.UTC(2023, 0, 1) / 1000, 'year')).toBe(Date.UTC(2024, 0, 1) / 1000);
  });
});

describe('bucketIndex', () => {
  it('年をまたぐ月数を数える', () => {
    const origin = Date.UTC(2022, 10, 1) / 1000;
    expect(bucketIndex(Date.UTC(2023, 1, 1) / 1000, origin, 'month')).toBe(3);
    expect(bucketIndex(origin, origin, 'month')).toBe(0);
  });

  it('四半期と年も数えられる', () => {
    const origin = Date.UTC(2020, 0, 1) / 1000;
    expect(bucketIndex(Date.UTC(2021, 6, 1) / 1000, origin, 'quarter')).toBe(6);
    expect(bucketIndex(Date.UTC(2023, 0, 1) / 1000, origin, 'year')).toBe(3);
  });
});

describe('aggregate', () => {
  it('週次を月次に畳み込む', () => {
    // 2024-01-07 から 8 週ぶん。1月に 4 週、2月以降にまたがる
    const repo = series({ commits: [1, 2, 3, 4, 5, 6, 7, 8] });
    const buckets = aggregate(repo, 'month');
    const total = buckets.reduce((a, b) => a + b.commits, 0);
    expect(total).toBe(36);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
  });

  it('活動のない期間も 0 で埋めて連続させる', () => {
    // 1 週目と 30 週目だけ活動 → 間の週も欠けない
    const commits = new Array(30).fill(0);
    commits[0] = 5;
    commits[29] = 7;
    const buckets = aggregate(series({ commits }), 'week');
    expect(buckets).toHaveLength(30);
    expect(buckets[0]!.commits).toBe(5);
    expect(buckets[15]!.commits).toBe(0);
    expect(buckets[29]!.commits).toBe(7);
  });

  it('貢献者は期間内で重複を除いて数える', () => {
    // 貢献者 0 は 1・2 週目、貢献者 1 は 2 週目のみ活動
    const repo = series({ commits: [3, 4, 0, 0], activeWeeks: [[0, 1], [1]] });
    const weekly = aggregate(repo, 'week');
    expect(weekly[0]!.contributors.size).toBe(1);
    expect(weekly[1]!.contributors.size).toBe(2);

    // 月に畳んでも「延べ 3 人」ではなく「実 2 人」になること
    const monthly = aggregate(repo, 'month');
    expect(monthly[0]!.contributors.size).toBe(2);
  });

  it('作成日より前のコミットがあっても index が負にならない', () => {
    const repo = series({
      start: SUNDAY_2024_01_07 - 10 * WEEK,
      commits: [1, 1, 1],
      metaOverrides: { createdAt: Date.UTC(2024, 0, 7) },
    });
    const buckets = aggregate(repo, 'week');
    expect(buckets[0]!.index).toBe(0);
    expect(buckets.every((b) => b.index >= 0)).toBe(true);
  });
});

describe('metricValue', () => {
  const bucket = {
    start: 0,
    index: 0,
    commits: 10,
    additions: 100,
    deletions: 40,
    contributors: new Set([0, 1, 2]),
  };
  it('派生指標を計算する', () => {
    expect(metricValue(bucket, 'net')).toBe(60);
    expect(metricValue(bucket, 'churn')).toBe(140);
    expect(metricValue(bucket, 'contributors')).toBe(3);
  });
});

describe('movingAverage', () => {
  it('窓が 1 なら何もしない', () => {
    expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });

  it('中央寄せで平均し、端は利用可能なぶんだけで割る', () => {
    expect(movingAverage([0, 3, 0], 3)).toEqual([1.5, 1, 1.5]);
  });

  it('総和を大きく変えない', () => {
    const values = [5, 1, 9, 2, 8, 3];
    const smoothed = movingAverage(values, 3);
    expect(smoothed).toHaveLength(values.length);
    expect(Math.max(...smoothed)).toBeLessThanOrEqual(Math.max(...values));
  });
});

describe('cumulate と cumulativeContributors', () => {
  it('累積和をとる', () => {
    expect(cumulate([1, 2, 3])).toEqual([1, 3, 6]);
  });

  it('累計貢献者数は同じ人を二重に数えない', () => {
    const repo = series({ commits: [1, 1, 1], activeWeeks: [[0, 1, 2], [1], [2]] });
    const buckets = aggregate(repo, 'week');
    expect(cumulativeContributors(buckets)).toEqual([1, 2, 3]);
  });
});

describe('seriesFor', () => {
  it('日付モードでは x がミリ秒になる', () => {
    const s = seriesFor(series({ commits: [1, 2] }), view({ granularity: 'week' }));
    expect(s.points[0]!.x).toBe(SUNDAY_2024_01_07 * 1000);
  });

  it('年齢モードでは x が 0 から始まる経過バケット数になる', () => {
    const s = seriesFor(series({ commits: [1, 2, 3] }), view({ granularity: 'week', xMode: 'age' }));
    expect(s.points.map((p) => p.x)).toEqual([0, 1, 2]);
  });

  it('ピーク正規化すると最大値が 100 になる', () => {
    const s = seriesFor(
      series({ commits: [1, 5, 2] }),
      view({ granularity: 'week', normalize: 'peak' }),
    );
    expect(Math.max(...s.points.map((p) => p.y ?? 0))).toBeCloseTo(100);
  });

  it('累積すると単調非減少になる', () => {
    const s = seriesFor(series({ commits: [3, 0, 4] }), view({ granularity: 'week', cumulative: true }));
    const ys = s.points.map((p) => p.y);
    expect(ys).toEqual([3, 3, 7]);
  });
});

describe('buildSeries', () => {
  it('シェア表示では同じ x の合計が 100% になる', () => {
    const a = series({ commits: [1, 3], metaOverrides: { fullName: 'a/a' } });
    const b = series({ commits: [3, 1], metaOverrides: { fullName: 'b/b' } });
    const out = buildSeries([a, b], view({ granularity: 'week', normalize: 'share' }));
    for (let i = 0; i < 2; i++) {
      const total = out.reduce((sum, s) => sum + (s.points[i]!.y ?? 0), 0);
      expect(total).toBeCloseTo(100);
    }
  });

  it('入力と同じ順序で系列を返す', () => {
    const a = series({ commits: [1], metaOverrides: { fullName: 'a/a' } });
    const b = series({ commits: [1], metaOverrides: { fullName: 'b/b' } });
    expect(buildSeries([a, b], view()).map((s) => s.fullName)).toEqual(['a/a', 'b/b']);
  });
});

describe('summarize', () => {
  it('活動のあった最初と最後を拾う', () => {
    const repo = series({ commits: [0, 4, 0, 2, 0] });
    const s = summarize(repo, 'commits', 'week');
    expect(s.total).toBe(6);
    expect(s.peak).toBe(4);
    expect(s.firstActivity).toBe((SUNDAY_2024_01_07 + WEEK) * 1000);
    expect(s.lastActivity).toBe((SUNDAY_2024_01_07 + 3 * WEEK) * 1000);
  });

  it('貢献者数は全期間のユニーク人数を返す', () => {
    const repo = series({ commits: [1, 1], activeWeeks: [[0], [0, 1]] });
    expect(summarize(repo, 'contributors', 'month').total).toBe(2);
  });
});

describe('isLineMetric', () => {
  it('行数統計が要る指標だけを true にする', () => {
    const lineMetrics: Metric[] = ['additions', 'deletions', 'net', 'churn'];
    const others: Metric[] = ['commits', 'contributors'];
    expect(lineMetrics.every(isLineMetric)).toBe(true);
    expect(others.some(isLineMetric)).toBe(false);
  });
});

describe('accountSeries', () => {
  it('同じ人が複数のリポジトリにいれば合算する', () => {
    const a = series({
      commits: [2, 3],
      metaOverrides: { fullName: 'org/a' },
      contributors: [contributor('alice', [{ week: 0, c: 2 }, { week: 1, c: 3 }])],
    });
    const b = series({
      commits: [5, 0],
      metaOverrides: { fullName: 'org/b' },
      contributors: [contributor('alice', [{ week: 0, c: 5 }])],
    });
    const out = accountSeries([a, b], 10);
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.fullName).toBe('alice');
    expect(out[0]!.commits).toEqual([7, 3]);
  });

  it('開始週が違うリポジトリでも共通の週目盛りに載せ替える', () => {
    // b は a より 2 週遅れて始まる
    const a = series({
      commits: [1, 0, 0],
      contributors: [contributor('alice', [{ week: 0, c: 1 }])],
      metaOverrides: { fullName: 'org/a' },
    });
    const b = series({
      start: SUNDAY_2024_01_07 + 2 * WEEK,
      commits: [4],
      contributors: [contributor('bob', [{ week: 0, c: 4 }])],
      metaOverrides: { fullName: 'org/b' },
    });
    const out = accountSeries([a, b], 10);
    const bob = out.find((r) => r.meta.fullName === 'bob')!;
    const alice = out.find((r) => r.meta.fullName === 'alice')!;
    expect(alice.weeks).toEqual(bob.weeks);
    // bob の 4 コミットは共通目盛りの 3 週目（index 2）に載る
    expect(bob.commits).toEqual([0, 0, 4]);
    expect(alice.commits).toEqual([1, 0, 0]);
  });

  it('コミット数の多い順に上位だけ返す', () => {
    const repo = series({
      commits: [10],
      contributors: [
        contributor('low', [{ week: 0, c: 1 }]),
        contributor('high', [{ week: 0, c: 9 }]),
      ],
      metaOverrides: { fullName: 'org/a' },
    });
    const out = accountSeries([repo], 1);
    expect(out.map((r) => r.meta.fullName)).toEqual(['high']);
  });

  it('貢献者の詳細が無ければ空を返す', () => {
    expect(accountSeries([series({ commits: [1, 2] })], 10)).toEqual([]);
  });
});

describe('buildSeries（アカウント別）', () => {
  it('seriesBy=account でアカウント単位の線になる', () => {
    const repo = series({
      commits: [3],
      contributors: [
        contributor('alice', [{ week: 0, c: 2 }]),
        contributor('bob', [{ week: 0, c: 1 }]),
      ],
    });
    const out = buildSeries([repo], view({ seriesBy: 'account', granularity: 'week' }));
    expect(out.map((s) => s.fullName)).toEqual(['alice', 'bob']);
    expect(out[0]!.points[0]!.y).toBe(2);
  });
});

describe('isBot', () => {
  it('GitHub App のアカウントを見分ける', () => {
    expect(isBot('renovate[bot]')).toBe(true);
    expect(isBot('dependabot[bot]')).toBe(true);
  });

  it('名前に bot を含むだけの人間は巻き込まない', () => {
    for (const login of ['robot-lover', 'botanist', 'bot', 'sapphi-red']) {
      expect(isBot(login), login).toBe(false);
    }
  });
});

describe('accountSeries のボット除外', () => {
  const repo = series({
    commits: [10],
    contributors: [
      contributor('renovate[bot]', [{ week: 0, c: 9 }]),
      contributor('alice', [{ week: 0, c: 1 }]),
    ],
  });

  it('既定では含める', () => {
    expect(accountSeries([repo], 10).map((r) => r.meta.fullName)).toEqual([
      'renovate[bot]',
      'alice',
    ]);
  });

  it('除外を指定すると人間だけになる', () => {
    expect(accountSeries([repo], 10, true).map((r) => r.meta.fullName)).toEqual(['alice']);
  });

  it('除外は上位N件の絞り込みより先に効く', () => {
    // ボットを除いた上での上位1件なので alice が残る
    expect(accountSeries([repo], 1, true).map((r) => r.meta.fullName)).toEqual(['alice']);
  });
});

describe('alignSeries（系列の x 揃え）', () => {
  const a = { fullName: 'a', truncated: false, points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] };
  const b = { fullName: 'b', truncated: false, points: [{ x: 1, y: 5 }, { x: 2, y: 6 }] };

  it('全系列を共通の x 目盛りに揃える', () => {
    for (const fill of ['gap', 'zero', 'hold'] as const) {
      for (const s of alignSeries([a, b], fill)) {
        expect(s.points.map((p) => p.x), fill).toEqual([0, 1, 2]);
      }
    }
  });

  it('gap では範囲外を null にし、線を描かせない', () => {
    const [aa, bb] = alignSeries([a, b], 'gap');
    expect(bb!.points[0]).toEqual({ x: 0, y: null });
    expect(aa!.points[2]).toEqual({ x: 2, y: null });
  });

  it('揃えたあと、同じ添字が必ず同じ x を指す', () => {
    // Chart.js は添字で系列を突き合わせるので、ここが崩れると
    // 別の時点の値が並んで表示される
    const out = alignSeries([a, b], 'gap');
    for (let i = 0; i < 3; i++) {
      const xs = new Set(out.map((s) => s.points[i]!.x));
      expect(xs.size).toBe(1);
    }
  });

  it('zero では範囲外を 0 にする', () => {
    const [aa, bb] = alignSeries([a, b], 'zero');
    expect(bb!.points[0]).toEqual({ x: 0, y: 0 });
    expect(aa!.points[2]).toEqual({ x: 2, y: 0 });
  });

  it('hold では、終わったあとも最後の値を保つ', () => {
    // ここを 0 埋めすると、開発が止まったリポジトリの累計が合計から消える
    const [aa, bb] = alignSeries([a, b], 'hold');
    expect(aa!.points[2]).toEqual({ x: 2, y: 2 });
    expect(bb!.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('hold で積み上げた合計が単調非減少になる', () => {
    const out = alignSeries([a, b], 'hold');
    const totals = [0, 1, 2].map((i) =>
      out.reduce((sum, s) => sum + (s.points[i]!.y ?? 0), 0),
    );
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]!).toBeGreaterThanOrEqual(totals[i - 1]!);
    }
  });
});

describe('buildSeries（積み上げ）', () => {
  it('stacked のときだけ x を揃える', () => {
    const early = series({ commits: [1, 1], metaOverrides: { fullName: 'a/a' } });
    const late = series({
      start: SUNDAY_2024_01_07 + 2 * WEEK,
      commits: [1],
      metaOverrides: { fullName: 'b/b' },
    });
    const stacked = buildSeries([early, late], view({ granularity: 'week', chartStyle: 'stacked' }));
    // 積み上げでは足せるよう数値で埋める
    expect(stacked.every((s) => s.points.every((p) => p.y !== null))).toBe(true);

    const lines = buildSeries([early, late], view({ granularity: 'week' }));
    // 折れ線でも x は揃えるが、存在しない期間は穴のままにする
    expect(lines.every((s) => s.points.length === 3)).toBe(true);
    expect(lines[1]!.points[0]!.y).toBeNull();
  });
});

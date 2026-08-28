import { describe, expect, it } from 'vitest';
import {
  buildSeries,
  classifyInput,
  isRepoSeries,
  parseRepoRef,
  refToString,
} from '../src/github';
import { meta, SUNDAY_2024_01_07, WEEK } from './helpers';

describe('parseRepoRef', () => {
  it('owner/repo をそのまま受ける', () => {
    expect(parseRepoRef('vitejs/vite')).toEqual({ owner: 'vitejs', name: 'vite' });
  });

  it('GitHub の URL からも取り出せる', () => {
    for (const input of [
      'https://github.com/vitejs/vite',
      'https://www.github.com/vitejs/vite/',
      'http://github.com/vitejs/vite.git',
      'git@github.com:vitejs/vite.git',
      '  vitejs/vite  ',
    ]) {
      expect(parseRepoRef(input), input).toEqual({ owner: 'vitejs', name: 'vite' });
    }
  });

  it('URL に余計なパスが付いていても owner/repo を拾う', () => {
    expect(parseRepoRef('https://github.com/vitejs/vite/tree/main/packages')).toEqual({
      owner: 'vitejs',
      name: 'vite',
    });
  });

  it('不正な入力は null を返す', () => {
    for (const input of ['', '   ', 'vite', '/', 'own er/repo', 'owner/re po', 'owner/']) {
      expect(parseRepoRef(input), input).toBeNull();
    }
  });

  it('区切りの打ち間違いは許す（貼り付け前提のため寛容に解釈する）', () => {
    expect(parseRepoRef('a//b')).toEqual({ owner: 'a', name: 'b' });
  });

  it('refToString で往復できる', () => {
    const ref = parseRepoRef('a-b_c.d/e.f')!;
    expect(refToString(ref)).toBe('a-b_c.d/e.f');
  });
});

describe('buildSeries', () => {
  const w = (i: number) => SUNDAY_2024_01_07 + i * WEEK;

  it('複数の貢献者を週ごとに合算する', () => {
    const s = buildSeries(meta(), [
      { author: { login: 'a' }, total: 3, weeks: [{ w: w(0), a: 10, d: 2, c: 2 }] },
      { author: { login: 'b' }, total: 1, weeks: [{ w: w(0), a: 5, d: 1, c: 1 }] },
    ]);
    expect(s.commits[0]).toBe(3);
    expect(s.additions[0]).toBe(15);
    expect(s.deletions[0]).toBe(3);
    expect(s.activeWeeks).toHaveLength(2);
  });

  it('活動のない週を 0 で埋めて連続させる', () => {
    const s = buildSeries(meta(), [
      {
        author: { login: 'a' },
        total: 2,
        weeks: [
          { w: w(0), a: 1, d: 0, c: 1 },
          { w: w(4), a: 1, d: 0, c: 1 },
        ],
      },
    ]);
    expect(s.weeks).toHaveLength(5);
    expect(s.commits).toEqual([1, 0, 0, 0, 1]);
    expect(s.weeks[1]! - s.weeks[0]!).toBe(WEEK);
  });

  it('削除行数は絶対値にする（GitHub は負の値で返すことがある）', () => {
    const s = buildSeries(meta(), [
      { author: null, total: 1, weeks: [{ w: w(0), a: 0, d: -42, c: 1 }] },
    ]);
    expect(s.deletions[0]).toBe(42);
  });

  it('コミットのない週は活動週に数えない', () => {
    const s = buildSeries(meta(), [
      {
        author: { login: 'a' },
        total: 1,
        weeks: [
          { w: w(0), a: 100, d: 0, c: 0 },
          { w: w(1), a: 1, d: 0, c: 1 },
        ],
      },
    ]);
    expect(s.activeWeeks[0]).toEqual([1]);
    expect(s.additions[0]).toBe(100);
  });

  it('貢献者が 100 人ちょうどなら打ち切りの可能性を立てる', () => {
    const stats = Array.from({ length: 100 }, (_, i) => ({
      author: { login: `u${i}` },
      total: 1,
      weeks: [{ w: w(0), a: 1, d: 0, c: 1 }],
    }));
    expect(buildSeries(meta(), stats).truncated).toBe(true);
    expect(buildSeries(meta(), stats.slice(0, 99)).truncated).toBe(false);
  });

  it('空のレスポンスでも壊れない', () => {
    const s = buildSeries(meta(), []);
    expect(s.weeks).toEqual([]);
    expect(s.truncated).toBe(false);
  });
});

describe('行数統計の欠落検出', () => {
  const w = (i: number) => SUNDAY_2024_01_07 + i * WEEK;

  it('コミットはあるのに行数が全週 0 なら欠落とみなす', () => {
    // 大きなリポジトリでは GitHub がこの形のレスポンスを返す
    const s = buildSeries(meta(), [
      {
        author: { login: 'a' },
        total: 2,
        weeks: [
          { w: w(0), a: 0, d: 0, c: 1 },
          { w: w(1), a: 0, d: 0, c: 1 },
        ],
      },
    ]);
    expect(s.commits).toEqual([1, 1]);
    expect(s.hasLineStats).toBe(false);
  });

  it('行数が 1 週でも入っていれば利用可能とみなす', () => {
    const s = buildSeries(meta(), [
      {
        author: { login: 'a' },
        total: 2,
        weeks: [
          { w: w(0), a: 0, d: 0, c: 1 },
          { w: w(1), a: 12, d: 3, c: 1 },
        ],
      },
    ]);
    expect(s.hasLineStats).toBe(true);
  });

  it('コミットが 1 件も無い場合は欠落扱いにしない', () => {
    const s = buildSeries(meta(), [
      { author: { login: 'a' }, total: 0, weeks: [{ w: w(0), a: 0, d: 0, c: 0 }] },
    ]);
    expect(s.hasLineStats).toBe(true);
  });
});

describe('classifyInput', () => {
  it('スラッシュを含まない単独の語はオーナー名とみなす', () => {
    const cases: [string, string][] = [
      ['kumagallium', 'kumagallium'],
      ['  vitejs  ', 'vitejs'],
      ['https://github.com/vitejs', 'vitejs'],
      ['https://github.com/vitejs/', 'vitejs'],
    ];
    for (const [input, owner] of cases) {
      expect(classifyInput(input), input).toEqual({ kind: 'owner', owner });
    }
  });

  it('owner/repo が混ざればリポジトリとして扱う', () => {
    const out = classifyInput('vitejs/vite, rollup/rollup');
    expect(out.kind).toBe('repos');
    expect(out.kind === 'repos' && out.refs.map(refToString)).toEqual([
      'vitejs/vite',
      'rollup/rollup',
    ]);
  });

  it('複数の語が並ぶ場合はオーナー名扱いしない', () => {
    const out = classifyInput('vitejs rollup');
    expect(out).toEqual({ kind: 'repos', refs: [] });
  });

  it('オーナー名として不正な文字は弾く', () => {
    expect(classifyInput('not a name!')).toEqual({ kind: 'repos', refs: [] });
  });
});

describe('isRepoSeries', () => {
  it('contributors を持たない古い形を弾く', () => {
    // 保存形式を変えたのにプレフィックスを上げ忘れると、この形が読み込まれる
    expect(isRepoSeries({ weeks: [1], commits: [1], activeWeeks: [[0]] })).toBe(false);
  });

  it('現行の形は通す', () => {
    expect(
      isRepoSeries({ weeks: [1], commits: [1], activeWeeks: [[0]], contributors: [] }),
    ).toBe(true);
  });

  it('null や配列でない値を弾く', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { weeks: 'no' }]) {
      expect(isRepoSeries(bad), String(bad)).toBe(false);
    }
  });
});

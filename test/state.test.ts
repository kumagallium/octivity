import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, decodeState, encodeState } from '../src/state';

describe('decodeState', () => {
  it('空のクエリなら既定値になる', () => {
    const s = decodeState('');
    expect(s.repos).toEqual([]);
    expect(s.view).toEqual(DEFAULT_VIEW);
  });

  it('リポジトリを正規化し、重複を除く', () => {
    const s = decodeState('?r=vitejs/vite,https://github.com/rollup/rollup,VITEJS/VITE');
    expect(s.repos).toEqual(['vitejs/vite', 'rollup/rollup']);
  });

  it('不正な値は既定値にフォールバックする', () => {
    const s = decodeState('?m=bogus&g=fortnight&x=spiral&n=zzz&s=7');
    expect(s.view.metric).toBe(DEFAULT_VIEW.metric);
    expect(s.view.granularity).toBe(DEFAULT_VIEW.granularity);
    expect(s.view.xMode).toBe(DEFAULT_VIEW.xMode);
    expect(s.view.normalize).toBe(DEFAULT_VIEW.normalize);
    expect(s.view.smooth).toBe(DEFAULT_VIEW.smooth);
  });

  it('系列の単位と人数を読む', () => {
    const s = decodeState('?b=account&t=20');
    expect(s.view.seriesBy).toBe('account');
    expect(s.view.topAccounts).toBe(20);
  });

  it('ボットは既定で除外し、bots=1 のときだけ含める', () => {
    expect(decodeState('').view.excludeBots).toBe(true);
    expect(decodeState('?bots=1').view.excludeBots).toBe(false);
  });

  it('未知の系列単位・人数は既定値に戻す', () => {
    const s = decodeState('?b=galaxy&t=7');
    expect(s.view.seriesBy).toBe(DEFAULT_VIEW.seriesBy);
    expect(s.view.topAccounts).toBe(DEFAULT_VIEW.topAccounts);
  });

  it('フラグを読む', () => {
    const s = decodeState('?c=1&l=1&s=12&x=age');
    expect(s.view.cumulative).toBe(true);
    expect(s.view.logScale).toBe(true);
    expect(s.view.smooth).toBe(12);
    expect(s.view.xMode).toBe('age');
  });
});

describe('encodeState', () => {
  it('既定値は書き出さない', () => {
    expect(encodeState({ repos: [], view: { ...DEFAULT_VIEW } })).toBe('');
    expect(encodeState({ repos: ['a/b'], view: { ...DEFAULT_VIEW } })).toBe('?r=a%2Fb');
  });

  it('往復しても状態が変わらない', () => {
    const original = {
      repos: ['vitejs/vite', 'rollup/rollup'],
      view: {
        metric: 'churn' as const,
        granularity: 'quarter' as const,
        xMode: 'age' as const,
        seriesBy: 'account' as const,
        topAccounts: 20,
        excludeBots: false,
        cumulative: true,
        smooth: 6,
        normalize: 'peak' as const,
        logScale: true,
      },
    };
    expect(decodeState(encodeState(original))).toEqual(original);
  });

  it('トークンらしきものを URL に載せない', () => {
    const url = encodeState({ repos: ['a/b'], view: { ...DEFAULT_VIEW } });
    expect(url).not.toMatch(/token|ghp_|github_pat/i);
  });
});

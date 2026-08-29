/**
 * localStorage を使った素朴な TTL キャッシュ。
 * GitHub の未認証レート制限（60 req/h）を守るための一次防衛線なので、
 * 容量超過で書けなかった場合は「古いものから捨てて1度だけ再挑戦」する。
 */

// キャッシュに入れる構造を変えたらここを上げる。
// 古い形のデータが読み込まれて欠けたフィールドが undefined になるのを防ぐ。
const PREFIX = 'octivity:v3:';
/** 既定の有効期限（6時間）。GitHub 側の統計キャッシュもおよそ日単位で更新される */
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

interface Entry<T> {
  at: number;
  data: T;
}

function keyOf(name: string): string {
  return PREFIX + name;
}

export function cacheGet<T>(name: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(keyOf(name));
  } catch {
    return null; // プライベートモード等で localStorage が触れない
  }
  if (raw === null) return null;
  try {
    const entry = JSON.parse(raw) as Entry<T>;
    if (typeof entry.at !== 'number') return null;
    if (Date.now() - entry.at > ttlMs) {
      localStorage.removeItem(keyOf(name));
      return null;
    }
    return entry.data;
  } catch {
    localStorage.removeItem(keyOf(name));
    return null;
  }
}

export function cacheSet<T>(name: string, data: T): void {
  const payload = JSON.stringify({ at: Date.now(), data } satisfies Entry<T>);
  try {
    localStorage.setItem(keyOf(name), payload);
  } catch {
    // 容量超過とみて古い順に半分捨ててから 1 度だけ再挑戦する
    evictOldest(0.5);
    try {
      localStorage.setItem(keyOf(name), payload);
    } catch {
      // それでも入らないなら諦める（キャッシュは無くても動く）
    }
  }
}

function entries(): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !key.startsWith(PREFIX)) continue;
    let at = 0;
    try {
      at = (JSON.parse(localStorage.getItem(key) ?? '{}') as Entry<unknown>).at ?? 0;
    } catch {
      at = 0;
    }
    out.push({ key, at });
  }
  return out;
}

function evictOldest(ratio: number): void {
  const all = entries().sort((a, b) => a.at - b.at);
  const n = Math.max(1, Math.floor(all.length * ratio));
  for (const e of all.slice(0, n)) localStorage.removeItem(e.key);
}

export function cacheClear(): number {
  const all = entries();
  for (const e of all) localStorage.removeItem(e.key);
  return all.length;
}

export function cacheSize(): number {
  return entries().length;
}

/**
 * 前の形式で保存された値を捨てる。
 * プレフィックスを上げると古いキーは読まれなくなるが、消えるわけではないので、
 * 放っておくと使われないデータが容量を占め続ける。
 */
export function cachePurgeOld(): number {
  let removed = 0;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null) continue;
    if (key.startsWith('octivity:v') && !key.startsWith(PREFIX)) stale.push(key);
  }
  for (const key of stale) {
    localStorage.removeItem(key);
    removed++;
  }
  return removed;
}

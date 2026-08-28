/**
 * アクセストークンの保管。
 * 既定は sessionStorage（タブを閉じれば消える）で、
 * 明示的に「このブラウザに保存する」を選んだときだけ localStorage に置く。
 * どちらの場合も URL には決して載せない。
 */
const KEY = 'octivity:token';

function safeGet(store: Storage): string | null {
  try {
    return store.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadToken(): string | undefined {
  const value = safeGet(sessionStorage) ?? safeGet(localStorage);
  return value !== null && value !== '' ? value : undefined;
}

export function isRemembered(): boolean {
  return safeGet(localStorage) !== null;
}

export function saveToken(token: string, remember: boolean): void {
  clearToken();
  const trimmed = token.trim();
  if (trimmed === '') return;
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, trimmed);
  } catch {
    // 保存できなくてもメモリ上のクライアントには反映済みなので続行する
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

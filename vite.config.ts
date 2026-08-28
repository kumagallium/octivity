import { defineConfig } from 'vitest/config';

/**
 * 配信ページに載せる CSP。
 * 要は「api.github.com 以外へは一切つなげない」ことを保証するための宣言で、
 * 万一 XSS が混入してもアクセストークンを外部へ送り出せないようにする。
 * 開発サーバー（HMR が inline script と websocket を使う）を壊さないよう、
 * ビルド時だけ index.html に注入する。
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src https://api.github.com",
  "base-uri 'none'",
  "form-action 'none'",
  // frame-ancestors は meta では無視される（HTTP ヘッダー専用）ため入れない。
  // GitHub Pages はヘッダーを設定できないので、代わりに main.ts 側で
  // 「フレーム内ではトークンを入力させない」ようにしている。
].join('; ');

export default defineConfig({
  // 相対パスにしておくと、fork して任意のパスの GitHub Pages に置いても設定なしで動く
  base: './',
  plugins: [
    {
      name: 'octivity-csp',
      apply: 'build',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  ],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

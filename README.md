# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

---

## チップ計算の「Discord でみんなと共有」

チップ計算ページを、その場にいる全員が同じ画面で見られるようにする機能。
**専用のサーバーもデータベースも使わず、Discord のメッセージ1通を保存先にしている。**
公開はこれまで通り GitHub Actions → GitHub Pages のままで、環境変数も増えていない。

### 仕組み

1. チャンネルのウェブフックで、状態を持つメッセージを1通投稿する
2. 各端末はそのメッセージを約3秒おきに読む（`GET /webhooks/{id}/{token}/messages/{mid}`）
3. 自分が触った項目だけを最新の内容に載せ直して書き戻す（`PATCH` 同エンドポイント）

ウェブフックのメッセージ操作はウェブフックトークンだけで叩けて、`discord.com/api` は
CORS を許可しているので、ブラウザから直接呼べる（ボットも中継サーバーも不要）。

メッセージ本文は人が読める収支表になっていて、末尾の小さい `-# ⟨sync⟩ …` の行に
同期用データを base64 で埋めてある。**アプリを開いていない人も、Discord のチャンネルを
見るだけで最新の収支が分かる。**

### 使い方

初回だけ、誰か1人がウェブフックを用意する:

1. Discord でチャンネル名の横の⚙️（チャンネルの編集）を開く
2. 「連携サービス」→「ウェブフック」→「新しいウェブフック」
3. 「ウェブフックURLをコピー」
4. アプリの「Discord でみんなと共有」にそのURLを貼って開始

あとはチャンネルに投稿されたメッセージの「▶ アプリで開く」を全員がタップするだけ。
以降は各自の端末で、ウェブフックURLもリンクも `localStorage` に覚えている。

### 参加の承認

リンクから来た人は、いきなり中身を見られるわけではない:

1. 名前を入力して「参加を申請」
2. ホストの画面（と Discord のメッセージ）に「参加リクエスト」が出る
3. ホストが承認すると、その人の画面が切り替わって収支が見える

**これは入室マナーのゲートであってセキュリティではない。** 共有メッセージはリンクを
持つ人なら誰でも直接取得できるので、承認前の人に画面を出さないのはアプリ側の表示制御に
すぎない。本当に秘匿するには承認済みの人だけに鍵を配る暗号化が要る。

端末の判別は `localStorage` のランダムIDで行っている（ブラウザから MAC アドレス等の
端末固有IDは取得できない）。サイトデータを消したり別ブラウザで開くと別人扱いになり、
申請からやり直しになる。

### 割り切っていること

- **同期は約3秒おきのポーリング**。押した瞬間ではなく数秒で伝わる（チップ集計には十分）。
  実測では6人が2.5秒間隔だと17%が429になり、3秒間隔＋±20%のゆらぎで0%だった。
  ゆらぎがないと端末同士のタイミングが揃って殺到するので、間隔には必ずゆらぎをかけている
- 同じ項目を2人が同時に直すと後勝ち。別々の項目なら潰し合わない（`src/utils/docDiff.ts`）
- ウェブフックURLを知っている人はそのチャンネルに投稿できる。身内チャンネル向け。
  不要になったら Discord 側でウェブフックを削除すれば即無効になる
- Discord のレート制限に当たったら自動で待つ（`retry_after` に従う）。裏に回ると 20 秒間隔に落とす
- プレイヤーが極端に多いとメッセージの 2000 文字上限に当たる（その場合はエラーを出す）

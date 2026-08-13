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

### コード（中身の鍵）

共有は**リンク1本**で完結する。Discord に投稿されるリンクにはコードが埋め込まれて
いるので、受け取った人はタップするだけで参加できる（コードの入力は要らない）。

- ルーム作成時に8文字のコードが発行される（例 `XVYB-82TJ`）
- 収支はこのコードから作った鍵で暗号化されて保存される
  （PBKDF2-SHA256 30万回 → AES-GCM 256、WebCrypto のみ・ライブラリ不要）
- Discord のメッセージには暗号文しか出ない。**チャンネルにいるだけの人には読めない**
- リンクを転送されただけの人も、コードがなければ開けない
- **リンクにコードが入っている＝リンクを見られる人は中身も見られる**。
  身内チャンネル前提の割り切り
- チャンネル外に流れたくない場合のために、共有設定から
  **コードなしのリンク**もコピーできる。この場合コードは口頭で伝える

そのかわり、**収支を Discord のチャンネルで直接読むことはできなくなった**。
暗号化されているため、開くにはアプリ（＋リンクかコード）が要る。

### 参加の承認

コードで開けたあと、もう一段:

1. 名前を入力して「参加を申請」
2. ホストの画面に「参加リクエスト」が出る
3. ホストが承認すると、その人の画面が切り替わって収支が見える

秘匿を担っているのはコードのほうで、**承認は「誰が入っているか」を把握して
退出させるための仕組み**。コードを知っている人は技術的には中身を読めるので、
承認は総当たりの防壁ではない。

端末の判別は `localStorage` のランダムIDで行っている（ブラウザから MAC アドレス等の
端末固有IDは取得できない）。サイトデータを消したり別ブラウザで開くと別人扱いになり、
申請からやり直しになる。

### チップ追加（アドオン）の記名ログ

お金が動く操作なので、誰がいつ増やしたかが必ず残るようにしている。

- **アドオンできるのは本人だけ。** 承認時に「参加者」と「プレイヤー」が
  名前で紐づくので、他人の「アドオン」ボタンは押せない
  （紐づけがずれた時は「これは自分」で名乗り直せる）
- **参加した時点の100BBも履歴の1行目として残す。** そうしないと履歴の合計と
  実際の数がずれて、あとから突き合わせられない
- **レート（100BB / 1バイイン / レーキ）を変えられるのはホストだけ**
- **最終チップを入れられるのは本人とホストだけ**（締めるのはホストの仕事なので、
  ホストは全員分を直せる。アドオンと違い「増やす」操作ではないため）
- プレイヤーは承認で自動的に増えるので、共有中は「+ Add」を出さない
  （誰も紐づいていないプレイヤーだけホストが面倒を見られる）
- 増やすと他の人の画面に **`!`** が出る（プレイヤー名の横と、画面上部のお知らせ）
- 名前の横のボタンからその人の追加履歴が開き、**行をタップすると確認チェック**が入る
- 誰がいつ確認したかも各行の下に並ぶ

追加は「アドオン」→ 数を入力 → 「追加」の流れ。2.5足しても履歴は1行で、
確定前に「1 → 3.5 アドオン（+¥7,500）」と結果が出る。押し間違いは同じ画面の
「間違えたので、この分を減らす」でマイナスの行として残す。合計と履歴は必ず一致する。

### 精算は2通り出す

同じ収支に対して、2つの配り方を並べて出す。卓の状況で使い分ける。

- **Settlement 1**: 送金の回数がいちばん少なくなる組み合わせ
- **Settlement 2**: 負けた人は全員いちばん勝った人に払い、その人が他の勝った人へ配る。
  ハブ以外は1人とだけやり取りすればいいので卓上で回しやすい

どちらも各自の収支ぴったりに落ちることを `src/utils/settlement.test.ts` で確かめている。
チップが合っていない回は、そのズレが Settlement 2 ではハブの受取額に出る。

### Discord の2000文字にどう収めているか

全データが暗号化されて1通のメッセージに入るので、履歴が伸びると上限に当たる。
実測しながら次の順で詰めた（8人・全員確認済み・60件で 3412文字 → 1994文字）。

1. **deflate-raw で圧縮してから暗号化**（JSON はキー名が繰り返されるのでよく縮む）
2. **二重 base64 をやめた** — 暗号化済みの箱を JSON にしてさらに base64 していて、
   それだけで33%太っていた。区切り文字でつないだ1本の文字列に変更
3. **時刻を小さく** — 確認時刻は「その行から何分後か」（13桁 → 1〜3桁）、
   追加時刻はミリ秒ではなく秒
4. 端末ID・プレイヤーID・行IDを短く（1件ごとに人数ぶん載るため効く）

そのうえで履歴は **50件** を上限にし、超えたら古いものから落とす。
`src/utils/roomSize.test.ts` が「8人・満杯」で上限に収まることを機械的に見張っている。

### セッションをまたがないこと

前のセッションの記録が次に混ざらないよう、以下は持ち越さない。

- **新しく共有を始めるとき**は、参加者・承認状態・チップ追加の履歴を引き継がない
  （レートとプレイヤーだけ引き継ぐ）
- **Reset** はチップ追加の履歴も消す（参加者は残す）
- **共有をやめたとき**は、手元のデータからルーム固有の情報を落とす

### 割り切っていること

- **同期は約3秒おきのポーリング**。押した瞬間ではなく数秒で伝わる（チップ集計には十分）。
  実測では6人が2.5秒間隔だと17%が429になり、3秒間隔＋±20%のゆらぎで0%だった。
  ゆらぎがないと端末同士のタイミングが揃って殺到するので、間隔には必ずゆらぎをかけている
- 同じ項目を2人が同時に直すと後勝ち。別々の項目なら潰し合わない（`src/utils/docDiff.ts`）
- ウェブフックURLを知っている人はそのチャンネルに投稿できる。身内チャンネル向け。
  不要になったら Discord 側でウェブフックを削除すれば即無効になる
- コードは8文字（40ビット）。PBKDF2 30万回と合わせれば総当たりは現実的でないが、
  国家級の相手を想定した強度ではない
- **退出させただけでは、その人が知っているコードは無効にならない。** 本当に締め出す
  には共有設定の「コードを作り直す」を使う（中身は保ったまま新しいコードで暗号化
  し直すので、古いコードの端末は全員コード入力に戻る）
- Discord のレート制限に当たったら自動で待つ（`retry_after` に従う）。裏に回ると 20 秒間隔に落とす
- プレイヤーが極端に多いとメッセージの 2000 文字上限に当たる（その場合はエラーを出す）

### 画面の文言について

アプリの画面には **「Discord」という文言を出していない**（利用者にとっては
「みんなと共有」できればよく、裏側が何かは関係ないため）。エラー文言も
「共有先に接続できませんでした」のように中立にしてある。
コード内の識別子やこの README では Discord のままにしている。

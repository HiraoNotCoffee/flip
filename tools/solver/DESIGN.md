# プリフロップGTOソルバ 設計書

## 1. スコープ

- **フェーズ1**: ヘッズアップ（HU、SB vs BB）100bb プリフロップのみ
- **レーキ条件 3パターン**: 10% / 5bb cap, 10% / 4bb cap, 10% / 3bb cap
- 言語: TypeScript on Node.js
- 出力: ポジション × アクション履歴ごとの混合戦略JSON
- アプリ側: `src/components/GtoRange.tsx` でレンジを可視化

フェーズ2以降（6max/9max）は本設計の拡張で対応する想定。

---

## 2. ゲームモデル

### スタック・ブラインド
- スタック: 100bb（両者同額）
- SB: 0.5bb 投入済み、BB: 1bb 投入済み
- 通貨単位は全て **bb**（floatで保持）

### プレイヤー
- 2人（SB, BB）
- SBが最初に行動（プリフロップの慣例）

### ハンド
- 169バケット（13×13 のグリッド: ペア13 + sui­ted 78 + offsuit 78）
- カード除去効果 (card removal) は **エクイティ計算時に考慮**（オールイン後のショウダウン EV にて）

---

## 3. アクションツリー（v1: シンプル版）

### SB の初手（ノード `root`）
| アクション | 内容 |
|---|---|
| `fold` | SBが0.5bb失って終了 |
| `limp` | コール（追加0.5bb で 1bb 投入） |
| `open_2.5` | 2.5bb open（追加2bb） |

### BB vs SB limp（ノード `vs_limp`）
| アクション | 内容 |
|---|---|
| `check` | フロップへ（ポット2bb）|
| `raise_3.5` | 3.5bb raise（追加2.5bb） |

### BB vs SB open（ノード `vs_open`）
| アクション | 内容 |
|---|---|
| `fold` | BBが1bb失って終了 |
| `call` | コール（追加1.5bb、ポット5bb でフロップへ） |
| `3bet_11` | 11bb 3bet（追加10bb） |

### SB vs BB raise/3bet（ノード `vs_3bet` / `vs_raise`）
| アクション | 内容 |
|---|---|
| `fold` | 投入分を失って終了 |
| `call` | コールしてフロップへ |
| `4bet_25` | 25bb 4bet（vs 3bet時のみ） |

### BB vs SB 4bet（ノード `vs_4bet`）
| アクション | 内容 |
|---|---|
| `fold` | 投入分を失って終了 |
| `call` | コールしてフロップへ（ポット 50bb） |
| `5bet_allin` | オールイン（100bb） |

### SB vs BB 5bet=AllIn（ノード `vs_allin`）
| アクション | 内容 |
|---|---|
| `fold` | 投入分を失って終了 |
| `call` | オールインコール（ショウダウン） |

### 終端ノード（terminal）
1. **片方がフォールド**: 残った側がポット獲得（レーキは適用条件次第、下記4節）
2. **両者オールインしショウダウン**: エクイティで分配、レーキ適用
3. **コールでフロップへ進行**: エクイティで決着と近似（v1）、レーキ適用

---

## 4. レーキ計算

サイトの慣例「No Flop No Drop」を採用：

- **プリフロップ中にフォールドで決着** → レーキなし、ポット全額が勝者へ
- **フロップ以降に進行（コール後 or オールイン）** → レーキ徴収

レーキ式：
```
rake = min(pot * 0.10, cap_bb)
```
ただし `pot` は両者の拠出合計（bb単位）。

`cap_bb` は条件ごと：
| 条件名 | cap |
|---|---|
| `rake_5bb` | 5 |
| `rake_4bb` | 4 |
| `rake_3bb` | 3 |

実装は `payoff.ts` に `computeRake(pot: number, cap: number): number` として配置。

---

## 5. ペイオフ計算

EV はSB視点（BB視点なら符号反転）。

### フォールド終端
- SBフォールド: `EV_SB = -invested_SB`
- BBフォールド: `EV_SB = +invested_BB`
- レーキなし

### ショウダウン終端（オールイン or コール後）
1. 両者の **拠出後ポット** `pot = invested_SB + invested_BB`
2. レーキ控除: `net_pot = pot - rake`
3. エクイティ計算: SB のハンドXX vs BB のハンドYY の勝率 `eq(X, Y)`
4. `EV_SB = eq(X,Y) * net_pot - invested_SB`
   - 既存の `src/utils/preflopTable.json` を流用可能（HU向けエクイティ）

### コール後フロップ進行（v1近似）
- 「両者がポストフロップでチェック・チェックでショウダウンする」想定
- 実質オールインショウダウンと同じ計算
- v2以降でポストフロップEVテーブルに置き換え可能な抽象化を残す

---

## 6. CFR+ アルゴリズム

### infoset の定義
`infoset = (player, action_history, hand_bucket)`
- `player`: SB or BB
- `action_history`: ルートからのアクション列（例: `open_2.5 -> 3bet_11`）
- `hand_bucket`: 169 のうちの1つ（例: `AKs`）

### 戦略保存
各infoset で以下を保持：
- `regret_sum: number[]`（各アクションの累積regret、CFR+ では負値を0クリップ）
- `strategy_sum: number[]`（平均戦略の累積、後で正規化して出力）

### 反復ループ
```
for iter in 1..N:
  for player in [SB, BB]:
    reach_probs を更新しつつ tree を walk
    各infoset で:
      strategy = regret_matching_plus(regret_sum)
      strategy_sum += reach_prob * strategy
      CF utilities を計算
      regret_sum += max(0, instant_regret)  // CFR+
```

### ハンド分布の扱い
- 各infoset の `reach_prob` は **そのハンドでそのアクション列に到達する確率**
- カード除去: SBハンドXX に対してBBが取りうるハンドはXX以外 → BB側のreachの和を計算するとき、SBハンドのカードを含むBBハンドを除外

### 収束基準
- exploitability `< 0.5 mbb/pot`（プリフロップソルブの標準）
- または最大反復数（例: 5000）に達したら終了

### パフォーマンス目標（HU）
- infoset数: 数万オーダー
- 1反復: < 1秒
- 5000反復で **数時間以内に収束** を目標

---

## 7. ディレクトリ構成

```
tools/solver/
  DESIGN.md              ← この設計書
  tsconfig.json
  package.json
  src/
    types.ts             ← ActionNode, Strategy, GameConfig 等の型
    tree.ts              ← アクションツリー構築
    payoff.ts            ← レーキ + ペイオフ計算
    equity.ts            ← 169バケットの vs エクイティ取得（preflopTable.json を利用）
    hand.ts              ← 169バケット定義、カード除去ユーティリティ
    cfr.ts               ← CFR+ 反復ループ
    runner.ts            ← CLIエントリ（レーキ条件を引数で受ける）
    output.ts            ← 結果をアプリ用JSONに整形
  outputs/               ← 出力先（gitignore に追加）
    rake_5bb.json
    rake_4bb.json
    rake_3bb.json
```

実行例:
```bash
cd tools/solver
npm install
npx tsx src/runner.ts --rake-cap 5
npx tsx src/runner.ts --rake-cap 4
npx tsx src/runner.ts --rake-cap 3
```

最終的に3条件をまとめて `src/utils/gtoTable_HU.json` に統合する。

---

## 8. 出力JSONフォーマット

`outputs/rake_5bb.json` の構造例：
```json
{
  "meta": {
    "scenario": "HU_100bb_preflop",
    "rake_pct": 0.10,
    "rake_cap_bb": 5,
    "iterations": 5000,
    "exploitability_mbb_pot": 0.42,
    "generated_at": "2026-05-12T..."
  },
  "nodes": {
    "root": {
      "player": "SB",
      "actions": ["fold", "limp", "open_2.5"],
      "strategy": {
        "AA": [0, 0.0, 1.0],
        "AKs": [0, 0.05, 0.95],
        ...
      }
    },
    "open_2.5": {
      "player": "BB",
      "actions": ["fold", "call", "3bet_11"],
      "strategy": { ... }
    },
    "open_2.5/3bet_11": {
      "player": "SB",
      "actions": ["fold", "call", "4bet_25"],
      "strategy": { ... }
    },
    ...
  }
}
```

ノードキーはルートからのアクションパス（`/` 区切り）。`strategy[hand]` は `actions` と同じ長さの混合戦略ベクトル（合計1.0）。

---

## 9. アプリ統合プレビュー

`src/components/GtoRange.tsx`:
- ポジション選択（HUなのでSB/BB固定）
- レーキ条件選択（5bb/4bb/3bb タブ）
- アクション履歴ナビゲーション（root → open → 3bet → ... をドリルダウン）
- 169×13グリッドで各ハンドを色分け表示（fold=灰、call=緑、raise=赤、混合は色比率）

`type Page` に `'gto'` を追加し、メニュー項目を追加。

---

## 10. 6max / 9max への拡張余地（参考）

- `tree.ts` を multi-player 対応の汎用構造に
- `payoff.ts` でサイドポット計算を追加
- `cfr.ts` は変更最小限（ノードのutilityベクトルが拡張されるのみ）
- infoset爆発に対応するため、reach_prob 計算をハンド分布ベクトル単位でベクトル化（Float64Array）
- 速度が足りなくなったらRust移植を検討

---

## 11. v1で意図的に切り捨てる点

| 切り捨て | 理由 | v2での対応 |
|---|---|---|
| 複数オープンサイズ（3xなど） | ツリー肥大 | v2-A で対応 |
| 複数3betサイズ | 同上 | v2-A で対応 |
| コール後ポストフロップEV（プレイバリュー） | 計算重い | v2-B で対応 |
| アンティ・ストラドル | スコープ外 | v3以降 |
| ICM補正 | キャッシュゲーム想定 | 対応予定なし |

---

## 11.1. v2 計画（v1完成後に順次追加）

### v2-A: 複数ベットサイズ対応

ツリーの各意思決定ノードで複数のレイズサイズを許す：

| ノード | v1 | v2-A |
|---|---|---|
| SB Open | 2.5bb のみ | **2bb / 2.5bb / 3bb** |
| BB vs limp raise | 3.5bb のみ | **3bb / 4bb** |
| BB 3bet vs Open | 11bb のみ | **9bb / 11bb / 13bb** |
| SB 4bet vs 3bet | 25bb のみ | **22bb / 26bb / all-in** |
| BB 5bet | all-in のみ | **all-in 固定（100bbでは妥当）** |

実装方針：
- `tree.ts` の `actions` をサイズ配列で生成
- アクションID命名規則: `open_2.5`, `3bet_11` のように bb 単位を含める
- 出力JSONフォーマットは変更なし（actions配列が長くなるだけ）

予想負荷：infosetが約3〜5倍に増加 → 反復時間も比例増。HUなら数時間〜数十時間圏内。

### v2-B: ポストフロップEVテーブル対応

v1の「コール後 = エクイティ決着」近似を置き換え、コール後フロップへ進む各スポットの真の継続価値を組み込む。

#### 必要なもの
1. **subgame EV table**: 各「コール終端スポット」（例: `open_2.5/call` でフロップへ）について、両者のレンジ × スタック残額に対するSBのEV
2. ソルブ手段：TexasSolverの `console_solver.exe`（ポストフロップ専用）で各スポットをポストフロップソルブ
3. 結果: `{spot_id, sb_range, bb_range, sb_ev}` の辞書を `tools/solver/postflop_ev/` に保存

#### 統合
- `payoff.ts` の `computeShowdownEV` を `computePostflopEV(spot, sbHand, bbRange)` に分岐
- v1のエクイティ計算は **オールイン到達時のみ** 使用、コール後はEVテーブル参照

#### 注意
- ポストフロップ EV はSB/BBそれぞれのレンジに依存 → CFR+ の各反復でレンジが変化するため、**完全に正確にやるとEVテーブル自体を毎反復再計算する必要がある**
- 現実解: 「最初のv1ソルブで得たレンジを使ってEVテーブルを1回計算」→「そのEVを使ってもう一度CFR+を回す」の **2パスソルブ**
- それでも収束させたい場合は「数回反復」する

### v2-C: 6max への拡張

HUで完成したコードを multi-player 対応にする。

#### 必要な変更
- `tree.ts`: ポジション列を `[UTG, MP, CO, BTN, SB, BB]` に拡張、各ポジションでfold/call/raiseの分岐
- `payoff.ts`: **サイドポット計算**を追加（複数オールイン時）
- `cfr.ts`: ノードの player フィールドが6種類になるが、ロジックは同じ
- `hand.ts`: 変更なし（169バケット維持）
- `equity.ts`: マルチウェイのエクイティ計算が必要 → 既存の `preflopTable.json` は2人向けなので、新しく**マルチウェイエクイティテーブル**を作る必要あり（モンテカルロで事前計算）

#### 予想負荷
- infoset数: HUの100倍〜（フォールド分岐が増えるため）
- 1反復: 数十秒〜数分（TypeScriptで実装の場合）
- 収束まで数日〜1週間を覚悟。**この段階で Rust移植 を真剣に検討**

### v2-D: 9max への拡張

6maxの自然な拡張。
- ポジション列を `[UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB, BB]` に
- それ以外は v2-C と同じ
- 速度問題が深刻化するため **Rust必須** の見込み

### v2の実施順序

```
v1（HU 単一サイズ）完成
  ↓
v2-A（HU 複数サイズ）← v1の延長で実装容易
  ↓
v2-B（HU + ポストフロップEV）← 精度向上の山場
  ↓
v2-C（6max）← 構造変更の山場、Rust移植判断
  ↓
v2-D（9max）← 完了
```

各フェーズの完了基準：
- 出力JSONがアプリで表示できる
- 既知のリファレンス（GTO Wizardの公開チャート等）と±5%程度で一致

### v2で出力JSONフォーマットを変えない方針

`nodes` 配下のキー命名規則とstrategyのベクトル形式は v1〜v2-D で維持する：
- アクションサイズが増えれば `actions` 配列が伸びる
- ポジションが増えれば `nodes` のキーが増える
- アプリ側UIは「actions配列を順番に色分け表示する」前提で書くと将来も動く

これにより `src/components/GtoRange.tsx` を v1で書いたら v2でも流用できる。

---

## 12. リスクと検証

- **収束しないリスク**: CFR+ の実装ミス → プッシュフォールド等の既知Nash均衡でユニットテスト
- **エクイティ計算ミス**: 既存 `preflopTable.json` の値を一部手計算で検証
- **遅すぎリスク**: HUでも収束に丸一日かかる可能性 → プロトタイプ段階で計測、必要ならアクション数削減

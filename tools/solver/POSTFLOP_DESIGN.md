# Postflop CFR+ 設計書

## 1. 背景と目的

v1〜v2-A のpreflopソルバは「コール後フロップ進行」を**両者投資額のみで決着するエクイティ**で近似していた。その結果ポストフロップEDGEが反映されず、76s等の playable handsが過度にフォールドされる問題があった。

v2-B では **TexasSolver連動** を試みたが、出力JSONにEVが含まれない致命的制約で頓挫。
本設計では **自前で postflop CFR+ を実装**し、各「コール終端スポット」の真の継続価値を計算する。

---

## 2. スコープ段階

| Phase | 内容 | 工数感 |
|---|---|---|
| **A** | フロップbet/call/fold/raise、ターン以降は all-in equity 近似 | 1週間 |
| **B** | ターンもCFR で解く（リバーは all-in 近似） | 1週間 |
| **C** | リバーまでフルCFR | 数日 |
| **D** | ボード抽象化（クラスタ・サンプリング） | 数日 |
| **E** | preflop CFR との 2-pass solve 統合 | 半日 |

Phase A → B → C → D → E の順で進める。

---

## 3. ゲームモデル

### 3.1 入力（preflop からのハンドオフ）

各 `terminal_postflop` ノードから以下が与えられる：
- `potBb`: 開始ポット（両者投資合計）
- `investedSb`, `investedBb`: 各プレイヤーの既投資額
- `effectiveStackBb`: 残スタック（min(SB残, BB残)）
- `sbRangeWeights`, `bbRangeWeights`: 169バケット × 重み（preflop CFR の reach prob）
- `sbInPosition`: ポストフロップでのIP判定（HU では常にtrue: SB=BTN=IP）
- `rakePct`, `rakeCapBb`

### 3.2 ボード

- フロップ: 3枚（事前に与える、または列挙）
- ターン: 4枚目（chance node で 48通り遷移）
- リバー: 5枚目（chance node で 47通り遷移）

### 3.3 アクション（Phase A）

| ストリート | プレイヤー | アクション |
|---|---|---|
| flop | OOP (BB) | check, bet (50% pot, 100% pot) |
| flop | OOP after check, IP bet | fold, call, raise (3x前ベット, all-in) |
| flop | IP (SB) | check, bet (50%, 100%) |
| flop | IP after OOP check | check (→ ターン all-in equity), bet |
| flop | IP after OOP bet | fold, call, raise, all-in |
| turn以降 | - | all-in 同等のショウダウン（Phase A の簡略） |

Phase B 以降でターン・リバーも本格 CFR に拡張。

### 3.4 ペイオフ計算

#### フォールド時
- 残った側がポット獲得
- レーキ適用（プリフロップフォールドではないので適用、ただし v1 と整合）

#### ショウダウン時
- 7カード評価（ハンド2 + ボード5）で勝者決定
- pot - rake が勝者へ。引き分けは pot/2
- レーキ式: `min(pot * 0.10, cap_bb)`

#### 全コールでチェックダウン
- ターン・リバーをランダム遷移してショウダウン
- Phase A では「all-in equity」近似で1ステップ計算

---

## 4. ハンド評価

### 4.1 5カード評価

カテゴリ:
| ランク | カテゴリ |
|---|---|
| 8 | Straight Flush (Royalを含む) |
| 7 | Four of a Kind |
| 6 | Full House |
| 5 | Flush |
| 4 | Straight |
| 3 | Three of a Kind |
| 2 | Two Pair |
| 1 | One Pair |
| 0 | High Card |

エンコード: `category × 13^5 + rank1 × 13^4 + ... + rank5`

特殊: A-2-3-4-5 (ホイール) は5ハイのストレート

### 4.2 7カード評価

7枚から C(7,5)=21 の5カード組み合わせを試して最大値。

### 4.3 性能

ナイーブ実装は ~10us/eval。CFR反復で数十万回呼ぶ場合は数秒〜数十秒。  
ボトルネック化したら lookup table 化（32MB 程度）を検討。

---

## 5. CFR+ アルゴリズム

### 5.1 infoset
`(player, action_history, hand)`
- ボード固定で 1solve → ボードはinfoset key に含めない
- 別ボードは別ソルブ

### 5.2 ハンド表現
- v2-B では **169バケット + jointCombos** を踏襲（preflop CFR と共通）
- ただし**ボードカードを除外したcombo数**を使う必要あり（フロップに Q が出たら AQs の combo数が減る）
- 関数: `boardAwareJointCombos(handA, handB, board)`

### 5.3 chance node
Phase A 以降のturn/river遷移：
- ターンカード = ボードに使われない 48 - 4 = 44 枚から選択（さらに両者ハンドのカードも除外、infosetごとに違うので reach に組み込む）
- 各カードで再帰し、平均（残りデッキの均等分布）

### 5.4 ベクトル化
- `handReach: Float64Array(NUM_HANDS)` を sb / bb で保持
- ターン chance node では各カードごとに再帰、結果を `1/numCardsRemaining` で平均
- 計算量大: 1326 ハンドで具体ハンドベースだとさらに重い → 最初は169バケットで実装

---

## 6. ボード扱い

### 6.1 列挙
- 全フロップ = C(50, 3) = 19,600（プリフロップでデッキ52、両者既知2なし）
- フラッシュ・ストレートを除いてsuited同型: 約1,755 ユニーククラス

### 6.2 サンプリング（Phase D 推奨）
- 1755 のクラスから 50〜200 を均一サンプリング
- 各クラスをソルブし、 spot ごとに per-hand EV を平均

### 6.3 クラスタリング（理想形、後回し）
- フロップの特徴（ハイカード、ペア、フラッシュドロー、ストレートドロー等）でクラスタリング
- 同クラスタ内のEVが近似的に等しいと仮定

Phase A では**サンプリング50ボード**から開始。

---

## 7. 出力フォーマット

```
tools/solver/outputs/postflop_ev/
  spot_<spotPath>__rake<cap>.json
```

中身（例）:
```json
{
  "meta": {
    "spotPath": "open_2.5/call",
    "potBb": 5,
    "investedBb": 2.5,
    "effectiveStackBb": 97.5,
    "rakeCapBb": 5,
    "boards": ["Qs,Jh,2h", "Ad,7c,3s", ...],
    "iterations_per_board": 500
  },
  "ev_sb": {
    "AA": 12.4,
    "AKs": 8.1,
    ...
  },
  "ev_bb": {
    "AA": -7.4,
    ...
  }
}
```

これを preflop CFR が読み込み、`terminal_postflop` 終端の per-hand SB EV / BB EV として使う。

---

## 8. preflop CFR との統合（Phase E）

### 8.1 1パス目
- 既存の v2-A preflop CFR を走らせる（コール終端は all-in equity 近似）
- 各 `terminal_postflop` でのSB/BB レンジを取得

### 8.2 postflop EV テーブル構築
- 各 spot × 各 board でCFRソルブ
- spot ごとに per-hand EV を平均

### 8.3 2パス目
- preflop CFR を再度走らせる
- `terminal_postflop` での payoff を postflop EV テーブル参照に切替
- 結果のレンジは1パス目と少し異なる

### 8.4 反復
- 2パス目のレンジで postflop EV を再計算 → 3パス目
- 収束まで（通常 3〜5パス）

---

## 9. ディレクトリ構成

```
tools/solver/src/postflop/
  eval.ts            ← 5/7カードハンド評価
  card.ts            ← カード表記/索引
  ptree.ts           ← postflop アクションツリー
  pcfr.ts            ← postflop CFR+
  pequity.ts         ← terminal showdown EV、turn/river expansion
  board.ts           ← フロップ列挙・サンプリング
  ranges.ts          ← preflop レンジ → postflop 入力
  runner.ts          ← postflop バッチソルブ
  texassolver.ts     ← (使わない、削除候補)
```

---

## 10. リスクと未確定事項

| リスク | 影響 | 対策 |
|---|---|---|
| ハンド評価が遅い | CFR反復が現実時間で完了しない | lookup table 化 |
| ボードサンプリングの誤差 | preflopレンジに歪み | サンプル数を増やす |
| 2-pass solve が収束しない | レンジ振動 | discounted update |
| メモリ不足（infoset爆発） | OOM | 169 bucketのまま、ボードごとに別ソルブ |
| TypeScript速度限界 | 数日以上の実行 | Rust移植検討 |

---

## 11. Phase A の最初の成果物

1. `eval.ts` 動作: 主要ハンドの判定が正しい（テスト）
2. `card.ts` ボードカード表記 ("Qs,Jh,2h") のパース
3. `pequity.ts` 「Qs,Jh,2h on board, AA vs KK の equity」が0.92程度（既知）
4. `ptree.ts` 単純フロップツリー（check/bet/fold）の構築
5. `pcfr.ts` 1ボードで CFR+ が収束、SBのEVが出る

ここまでで Phase A の骨格が完成。次に複数ボード平均化と preflop 統合へ。

---

## 12. Phase B 詳細設計

Phase A の構造的限界（AQs/TPTKが過剰に check するなど）を解消するため、 **ターンも本格 CFR で解く**。リバーは依然 all-in equity 近似（Phase C で本格化）。

### 12.1 ゲームモデルの拡張

フロップでの各「コール終端」を chance node に置き換え：
- flop check/check → turn chance node → turn subtree
- flop bet/call → turn chance node → turn subtree
- flop bet/raise/call → turn chance node → turn subtree
- ...

chance node は **48通りのターンカード**を均等確率で選ぶ（既知カード4枚: 3フロップ + chance済みなし、 ハンドの2カードは reach に組み込み済み）。

ターン上のアクションツリーは Phase A のフロップツリーと同型（OOP first acts、check/bet/fold/raise/allin）。

### 12.2 turn equity matrix

ターン後（フロップ3 + ターン1 = 4 cards）の 169×169 equity matrix。
- リバーの 47 カード全列挙でshowdown
- 各 (sbBucket, bbBucket) ペアで eval7 を呼んでwin/tie集計
- フロップ equity matrix と同様、 totalCombos (board-aware) も含む

計算量見積もり（ターン1枚固定 = 4-card board）:
- 169×169 = 28,561 bucket pair
- 各 pair: avg combos × avg combos × 47 river cards
- per board: roughly 1/49 of Phase A flop calc (since one card fewer to enumerate)
- 推定 5-15秒/turn board after optimization

ボード総数: 1 フロップ × 48 ターン = 48 turn boards per flop solve.

### 12.3 chance node CFR

ツリー上の chance node は CFR で以下のように扱う：
```
chance_value(I, h) = sum over turn_card t of (P(t) × child_value(I, h, t))
P(t) = 1 / 48  (uniform)
```

ただし t が h の hole cards に含まれる場合は除外し正規化。

実装:
- chance node を tree に追加 (`PfTurnChance`)
- traverse 時、 chance node に到達したら 48 ターン card で再帰、結果を 1/47 程度の重みで集約（ハンドh依存で valid な turn cards を考慮）

### 12.4 infoset数の爆発

各フロップ意思決定後、 turn subtree が 48 倍くらい。
- フロップ decision: 42
- ターン chance node 後: 各「コール終端」につき 48 turn cards × ~30 ターン decision ≈ 1500
- 合計 infoset 数: 42 + 12 × 1500 = ~18,000 decision nodes (各 169 hand）

これだと 169 × 18,000 = 3M infosets. Float64Array 24MB.

メモリは OK だが、 1反復あたりの計算量はフロップだけの数十倍。

### 12.5 1ボード Phase B の見積もり

- フロップ equity: 7分（既存）
- turn equity × 48 ボード: 48 × 10秒 = 8分
- CFR+ 5000反復: 1反復 ~1秒 → 80分
- 合計 1フロップ Phase B: **~95分**
- 50 フロップ: 80時間 (3.3日)

これは大きい。並列化（worker threads）が必要かも。

### 12.6 段階的実装

| Sub | 内容 |
|---|---|
| **B-1** | ptreeTurn.ts: ターンツリー実装（flop と同型） |
| **B-2** | turnEquity.ts: 4-card board の equity |
| **B-3** | pcfr.ts 拡張: chance node 処理 + ターン subtree 解 |
| **B-4** | 1 フロップで動作確認（数十分） |
| **B-5** | 結果検証（AQs が bet するか） |

B-5 で「AQs/T9s が妥当に bet する」ことを確認できれば Phase B 成功。失敗なら Phase C へ（リバーも CFR）。

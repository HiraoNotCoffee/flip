// 麻雀手牌の画像認識（Claude ビジョンAPIをブラウザから直接呼び出す）
// APIキーは利用者の端末（localStorage）にのみ保存され、リクエストは
// api.anthropic.com へ直接送られる。フェーズ2のカメラ入力用。

export interface VisionMeld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan'
  tiles: string[]
}

export interface VisionHandResult {
  tiles: string[] // 手牌（左→右）。'1m'..'9m'/'1p'/'1s'/'1z'..'7z'、赤5は'0m/0p/0s'
  melds: VisionMeld[]
  winningTile: string // アガリ牌（不明なら ''）
  notes: string
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-8'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tiles', 'melds', 'winning_tile', 'notes'],
  properties: {
    tiles: { type: 'array', items: { type: 'string' } },
    melds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'tiles'],
        properties: {
          type: { type: 'string', enum: ['chi', 'pon', 'minkan', 'ankan'] },
          tiles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    winning_tile: { type: 'string' },
    notes: { type: 'string' },
  },
}

const PROMPT = `You are an expert at Japanese riichi mahjong. The image shows a player's mahjong hand (tiles laid out). Identify every tile from left to right.

Notation for each tile:
- Man (萬子, characters): "1m".."9m"
- Pin (筒子, circles/dots): "1p".."9p"
- Sou (索子, bamboo sticks; 1s is a bird): "1s".."9s"
- Honors (字牌): "1z"=East 東, "2z"=South 南, "3z"=West 西, "4z"=North 北, "5z"=White dragon 白 (often a blue frame or blank), "6z"=Green dragon 發, "7z"=Red dragon 中
- Red five (赤ドラ, a five with red): "0m", "0p", "0s"

Rules:
- Put concealed hand tiles in "tiles", in left-to-right order.
- If some tiles are clearly a called meld (rotated sideways or clearly set apart as a group), put that group in "melds" with the correct type; otherwise leave "melds" as an empty array.
- If a winning/just-drawn tile is clearly separated (usually on the far right), put it in "winning_tile"; otherwise "".
- Only include tiles you can actually see. Note any uncertainty in "notes".`

/** Claude ビジョンAPIで手牌画像を認識する。imageBase64 はdata URLではなく生のbase64。 */
export async function recognizeMahjongHand(
  imageBase64: string,
  mediaType: string,
  apiKey: string
): Promise<VisionHandResult> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
  } catch {
    throw new Error('通信に失敗しました。ネットワークを確認してください')
  }

  if (!res.ok) {
    let msg = `APIエラー (${res.status})`
    if (res.status === 401) msg = 'APIキーが無効です。設定を確認してください'
    else if (res.status === 429) msg = 'レート制限です。少し待って再試行してください'
    else if (res.status === 400) msg = 'リクエストが不正です'
    else if (res.status >= 500) msg = 'サーバーエラーです。少し待って再試行してください'
    try {
      const e = await res.json()
      if (e?.error?.message) msg += `: ${e.error.message}`
    } catch {
      // ignore
    }
    throw new Error(msg)
  }

  const data = await res.json()
  if (data?.stop_reason === 'refusal') {
    throw new Error('この画像は処理できませんでした')
  }
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? []
  const textBlock = blocks.find((b) => b.type === 'text' && b.text)
  if (!textBlock?.text) throw new Error('認識結果が空でした')

  try {
    return JSON.parse(textBlock.text) as VisionHandResult
  } catch {
    throw new Error('認識結果の解析に失敗しました')
  }
}

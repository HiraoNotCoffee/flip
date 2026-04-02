/**
 * Generate a preflop equity lookup table for heads-up (2 players).
 * Maps canonical hand-type pairs to equity percentages.
 *
 * Run: npx tsx scripts/generatePreflopTable.ts
 */
import type { Card, Rank, Suit } from '../src/utils/card'
import { evaluateHand, rankHands } from '../src/utils/handEvaluator'

const SUITS: Suit[] = ['spade', 'heart', 'diamond', 'club']
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as Rank[]

function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

// Canonical hand type: "14-14" (pair), "14-13s" (suited), "14-13o" (offsuit)
// Always high rank first
function handType(c1: Card, c2: Card): string {
  const high = Math.max(c1.rank, c2.rank)
  const low = Math.min(c1.rank, c2.rank)
  if (high === low) return `${high}-${low}`
  const suited = c1.suit === c2.suit ? 's' : 'o'
  return `${high}-${low}${suited}`
}

// Generate all 169 hand types
function allHandTypes(): string[] {
  const types: string[] = []
  for (let i = RANKS.length - 1; i >= 0; i--) {
    for (let j = i; j >= 0; j--) {
      if (i === j) {
        types.push(`${RANKS[i]}-${RANKS[j]}`)
      } else {
        types.push(`${RANKS[i]}-${RANKS[j]}s`)
        types.push(`${RANKS[i]}-${RANKS[j]}o`)
      }
    }
  }
  return types
}

// Get all specific 2-card hands that match a hand type
function handsForType(type: string): Card[][] {
  const match = type.match(/^(\d+)-(\d+)(s|o)?$/)
  if (!match) throw new Error(`Invalid type: ${type}`)
  const r1 = Number(match[1]) as Rank
  const r2 = Number(match[2]) as Rank
  const suitedness = match[3] || undefined

  const hands: Card[][] = []
  if (r1 === r2) {
    // Pair: all suit combos
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        hands.push([{ rank: r1, suit: SUITS[i] }, { rank: r2, suit: SUITS[j] }])
      }
    }
  } else if (suitedness === 's') {
    for (const suit of SUITS) {
      hands.push([{ rank: r1, suit }, { rank: r2, suit }])
    }
  } else {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i !== j) {
          hands.push([{ rank: r1, suit: SUITS[i] }, { rank: r2, suit: SUITS[j] }])
        }
      }
    }
  }
  return hands
}

function isSameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit
}

function hasOverlap(h1: Card[], h2: Card[]): boolean {
  return h1.some(c1 => h2.some(c2 => isSameCard(c1, c2)))
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const MC_ITERATIONS = 5000

function computeMatchup(type1: string, type2: string): number {
  const hands1 = handsForType(type1)
  const hands2 = handsForType(type2)
  const deck = createDeck()

  let totalWins = 0
  let totalTrials = 0

  // Sample card assignments and MC boards
  for (let iter = 0; iter < MC_ITERATIONS; iter++) {
    // Pick random specific hands
    const h1 = hands1[Math.floor(Math.random() * hands1.length)]
    const h2 = hands2[Math.floor(Math.random() * hands2.length)]
    if (hasOverlap(h1, h2)) continue

    const usedCards = [...h1, ...h2]
    const remaining = deck.filter(c => !usedCards.some(u => isSameCard(c, u)))
    const board = shuffle(remaining).slice(0, 5)

    const ev1 = evaluateHand(h1, board)
    const ev2 = evaluateHand(h2, board)
    const ranks = rankHands([ev1, ev2])

    if (ranks[0] === 1 && ranks[1] !== 1) totalWins++
    else if (ranks[0] === 1 && ranks[1] === 1) totalWins += 0.5

    totalTrials++
  }

  return totalTrials > 0 ? (totalWins / totalTrials) * 100 : 50
}

// Main
const types = allHandTypes()
const table: Record<string, number> = {}
const total = types.length * (types.length + 1) / 2
let count = 0

console.log(`Computing ${total} matchups...`)

for (let i = 0; i < types.length; i++) {
  for (let j = i; j < types.length; j++) {
    const key = `${types[i]}|${types[j]}`
    const eq = computeMatchup(types[i], types[j])
    table[key] = Math.round(eq * 10) / 10
    count++
    if (count % 500 === 0) {
      console.log(`  ${count}/${total} (${(count / total * 100).toFixed(1)}%)`)
    }
  }
}

const fs = await import('fs')
const outPath = 'C:\\Users\\hirak\\個人開発\\flip\\src\\utils\\preflopTable.json'
fs.writeFileSync(outPath, JSON.stringify(table))
console.log(`Done! Written to ${outPath} (${Object.keys(table).length} entries)`)

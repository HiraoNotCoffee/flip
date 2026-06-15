// PokerStars-format hand history generator for GTO Wizard import.
//
// GTO Wizard's HH Analyzer parses PokerStars NLHE cash-game text. This module
// builds that text from a structured Hand. It is a *pure formatter* plus a small
// betting engine that the UI uses to know whose turn it is and which actions are
// legal — no network access, the user assembles the hand manually.

import type { Card } from './card'

// ---- Cards ---------------------------------------------------------------

const RANK_CODE: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
}
const SUIT_CODE: Record<Card['suit'], string> = {
  spade: 's', heart: 'h', diamond: 'd', club: 'c',
}

/** Card -> PokerStars code, e.g. {spade,10} -> "Ts". */
export function cardCode(card: Card): string {
  return RANK_CODE[card.rank] + SUIT_CODE[card.suit]
}

// ---- Positions -----------------------------------------------------------

// Each array is in PREFLOP action order (first to act ... BB last).
export const POSITIONS_BY_SIZE: Record<number, string[]> = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
}

export function positionsForSize(n: number): string[] {
  return POSITIONS_BY_SIZE[n] ?? POSITIONS_BY_SIZE[6]
}

/** The button position. Heads-up: the SB is on the button. */
export function buttonPosition(positions: string[]): string {
  return positions.includes('BTN') ? 'BTN' : 'SB'
}

/** Postflop action order: SB first, then clockwise. */
export function postflopOrder(positions: string[]): string[] {
  const sbIdx = positions.indexOf('SB')
  if (sbIdx < 0) return positions
  return [...positions.slice(sbIdx), ...positions.slice(0, sbIdx)]
}

/**
 * Seat layout: Seat 1 = SB, Seat 2 = BB, then clockwise to the button.
 * GTO Wizard re-derives each player's position from the button seat and the
 * blind posts, so this layout just has to be internally consistent.
 */
export function seatOrder(positions: string[]): string[] {
  return postflopOrder(positions)
}

// ---- Hand model ----------------------------------------------------------

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise'

export interface ActionEntry {
  pos: string
  type: ActionType
  /** For bet/raise: the TOTAL amount this player is now committed to this street. */
  toAmount?: number
}

export interface Hand {
  numPlayers: number
  sb: number
  bb: number
  ante?: number
  /** Stacks in money units, keyed by position. Missing => defaultStack. */
  stacks: Record<string, number>
  defaultStack: number
  heroPos: string
  heroCards: [Card | null, Card | null]
  /** Board cards in order (flop x3, turn, river). */
  board: (Card | null)[]
  /** Actions per street, in the order they happened. */
  actions: Record<Street, ActionEntry[]>
}

export function emptyActions(): Record<Street, ActionEntry[]> {
  return { preflop: [], flop: [], turn: [], river: [] }
}

export function createHand(numPlayers = 6): Hand {
  const positions = positionsForSize(numPlayers)
  return {
    numPlayers,
    sb: 0.5,
    bb: 1,
    stacks: {},
    defaultStack: 100,
    heroPos: positions[0],
    heroCards: [null, null],
    board: [null, null, null, null, null],
    actions: emptyActions(),
  }
}

export function stackOf(hand: Hand, pos: string): number {
  return hand.stacks[pos] ?? hand.defaultStack
}

// ---- Betting engine ------------------------------------------------------

export interface StreetState {
  /** Committed this street, per position. */
  committed: Record<string, number>
  /** Highest committed this street. */
  currentBet: number
  /** Positions that have folded (cumulative across streets). */
  folded: Set<string>
  /** Positions all-in (cumulative). */
  allIn: Set<string>
  /** Acted at least once this street. */
  acted: Set<string>
  /** Position whose turn it is, or null when the street's action is closed. */
  toAct: string | null
  /** True when no further action is possible (street complete). */
  closed: boolean
  /** True when only one player remains (hand is over). */
  handOver: boolean
}

/**
 * Replay a street's actions and report the resulting state. Used both to format
 * lines and to drive the UI (toAct / legal actions).
 *
 * `foldedBefore` / `allInBefore` carry state in from earlier streets.
 */
export function streetState(
  hand: Hand,
  street: Street,
  foldedBefore: Set<string>,
  allInBefore: Set<string>,
): StreetState {
  const positions = positionsForSize(hand.numPlayers)
  const order = street === 'preflop' ? positions : postflopOrder(positions)
  const folded = new Set(foldedBefore)
  const allIn = new Set(allInBefore)
  const acted = new Set<string>()
  const committed: Record<string, number> = {}
  for (const p of positions) committed[p] = 0

  let currentBet = 0
  if (street === 'preflop') {
    // Post blinds (heads-up still has SB + BB).
    if (positions.includes('SB')) committed['SB'] = hand.sb
    if (positions.includes('BB')) committed['BB'] = hand.bb
    currentBet = hand.bb
  }

  const entries = hand.actions[street]
  let lastActor: string | null = null
  for (const a of entries) {
    acted.add(a.pos)
    lastActor = a.pos
    switch (a.type) {
      case 'fold':
        folded.add(a.pos)
        break
      case 'check':
        break
      case 'call':
        committed[a.pos] = currentBet
        break
      case 'bet':
      case 'raise':
        committed[a.pos] = a.toAmount ?? currentBet
        currentBet = Math.max(currentBet, committed[a.pos])
        break
    }
    // All-in detection.
    if (committed[a.pos] >= stackOf(hand, a.pos) - 1e-9 && a.type !== 'fold') {
      allIn.add(a.pos)
    }
  }

  const stillIn = positions.filter(p => !folded.has(p))
  const handOver = stillIn.length <= 1

  // Players who can still act this street.
  const canAct = order.filter(p => !folded.has(p) && !allIn.has(p))

  // Determine whose turn it is: starting just after the last actor, find the
  // first player who either hasn't matched the current bet or hasn't acted yet.
  let toAct: string | null = null
  if (!handOver && canAct.length > 0) {
    const startIdx = lastActor ? (order.indexOf(lastActor) + 1) : firstToActIndex(order, folded, allIn)
    for (let k = 0; k < order.length; k++) {
      const p = order[(startIdx + k) % order.length]
      if (folded.has(p) || allIn.has(p)) continue
      const needsToMatch = committed[p] < currentBet - 1e-9
      const neverActed = !acted.has(p)
      if (needsToMatch || neverActed) { toAct = p; break }
    }
  }

  const closed = toAct === null
  return { committed, currentBet, folded, allIn, acted, toAct, closed, handOver }
}

function firstToActIndex(order: string[], folded: Set<string>, allIn: Set<string>): number {
  for (let i = 0; i < order.length; i++) {
    if (!folded.has(order[i]) && !allIn.has(order[i])) return i
  }
  return 0
}

export type LegalAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; min: number; max: number }
  | { type: 'raise'; min: number; max: number }

/** Legal actions for the player to act, given the current street state. */
export function legalActions(hand: Hand, st: StreetState): LegalAction[] {
  const pos = st.toAct
  if (!pos) return []
  const out: LegalAction[] = []
  const facing = st.currentBet - (st.committed[pos] ?? 0)
  const stack = stackOf(hand, pos)
  const remaining = stack - (st.committed[pos] ?? 0)
  if (facing > 1e-9) {
    out.push({ type: 'fold' })
    out.push({ type: 'call', amount: Math.min(facing, remaining) })
    if (remaining > facing + 1e-9) {
      // Min-raise: raise by at least the size of the previous bet/raise; we use
      // bb as a simple floor and let the user type any value the table allowed.
      out.push({ type: 'raise', min: st.currentBet + hand.bb, max: stack })
    }
  } else {
    out.push({ type: 'check' })
    if (remaining > 1e-9) {
      // currentBet>0 with nothing to call = the BB option preflop -> a raise,
      // not an opening bet.
      if (st.currentBet > 1e-9) out.push({ type: 'raise', min: st.currentBet + hand.bb, max: stack })
      else out.push({ type: 'bet', min: hand.bb, max: stack })
    }
  }
  return out
}

// ---- Cross-street helpers ------------------------------------------------

/** Replays every street up to (not including) `street`, returning folded/allIn. */
export function carryInto(hand: Hand, street: Street): { folded: Set<string>; allIn: Set<string> } {
  let folded = new Set<string>()
  let allIn = new Set<string>()
  for (const s of STREETS) {
    if (s === street) break
    const st = streetState(hand, s, folded, allIn)
    folded = st.folded
    allIn = st.allIn
  }
  return { folded, allIn }
}

/** Current betting state for a given street, with prior streets replayed. */
export function stateForStreet(hand: Hand, street: Street): StreetState {
  const { folded, allIn } = carryInto(hand, street)
  return streetState(hand, street, folded, allIn)
}

// ---- Money formatting ----------------------------------------------------

function money(n: number): string {
  return '$' + n.toFixed(2)
}

// ---- PokerStars text generation -----------------------------------------

export interface FormatOptions {
  handId?: string
  /** ISO-ish date string "YYYY/MM/DD HH:MM:SS". */
  dateStr?: string
  tableName?: string
}

/** Build the full PokerStars-format hand history text. */
export function formatPokerStars(hand: Hand, opts: FormatOptions = {}): string {
  const positions = positionsForSize(hand.numPlayers)
  const seats = seatOrder(positions)
  const btn = buttonPosition(positions)
  const btnSeat = seats.indexOf(btn) + 1

  const handId = opts.handId ?? '1'
  const dateStr = opts.dateStr ?? '2026/01/01 00:00:00'
  const tableName = opts.tableName ?? 'TenFour'

  const lines: string[] = []
  const nameOf = (pos: string) => (pos === hand.heroPos ? 'Hero' : pos)

  // Header
  lines.push(
    `PokerStars Hand #${handId}:  Hold'em No Limit (${money(hand.sb)}/${money(hand.bb)} USD) - ${dateStr} ET`,
  )
  lines.push(`Table '${tableName}' ${hand.numPlayers}-max Seat #${btnSeat} is the button`)
  seats.forEach((pos, i) => {
    lines.push(`Seat ${i + 1}: ${nameOf(pos)} (${money(stackOf(hand, pos))} in chips)`)
  })

  // Blinds
  if (positions.includes('SB')) lines.push(`${nameOf('SB')}: posts small blind ${money(hand.sb)}`)
  if (positions.includes('BB')) lines.push(`${nameOf('BB')}: posts big blind ${money(hand.bb)}`)

  // Hole cards
  lines.push('*** HOLE CARDS ***')
  if (hand.heroCards[0] && hand.heroCards[1]) {
    lines.push(`Dealt to Hero [${cardCode(hand.heroCards[0])} ${cardCode(hand.heroCards[1])}]`)
  }

  // Street action
  let folded = new Set<string>()
  let allIn = new Set<string>()
  const boardCodes = hand.board.map(c => (c ? cardCode(c) : null))

  const emitStreet = (street: Street) => {
    const st = streetState(hand, street, folded, allIn)
    for (const a of hand.actions[street]) {
      lines.push(formatActionLine(hand, street, a, nameOf))
    }
    folded = st.folded
    allIn = st.allIn
  }

  emitStreet('preflop')

  // FLOP
  if (boardCodes[0] && boardCodes[1] && boardCodes[2]) {
    lines.push(`*** FLOP *** [${boardCodes[0]} ${boardCodes[1]} ${boardCodes[2]}]`)
    emitStreet('flop')
  }
  // TURN
  if (boardCodes[3]) {
    lines.push(`*** TURN *** [${boardCodes[0]} ${boardCodes[1]} ${boardCodes[2]}] [${boardCodes[3]}]`)
    emitStreet('turn')
  }
  // RIVER
  if (boardCodes[4]) {
    lines.push(
      `*** RIVER *** [${boardCodes[0]} ${boardCodes[1]} ${boardCodes[2]} ${boardCodes[3]}] [${boardCodes[4]}]`,
    )
    emitStreet('river')
  }

  // Summary (minimal — GTO Wizard is lenient, but a valid pot helps).
  const totalPot = computeTotalPot(hand)
  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${money(totalPot)} | Rake ${money(0)}`)
  const boardForSummary = boardCodes.filter(Boolean) as string[]
  if (boardForSummary.length >= 3) {
    lines.push(`Board [${boardForSummary.join(' ')}]`)
  }

  return lines.join('\n')
}

/** Format a single action line, computing the PokerStars "raises X to Y" wording. */
function formatActionLine(
  hand: Hand,
  street: Street,
  action: ActionEntry,
  nameOf: (pos: string) => string,
): string {
  // Re-derive the state immediately before this action to compute amounts.
  const { folded, allIn } = carryInto(hand, street)
  const positions = positionsForSize(hand.numPlayers)
  const order = street === 'preflop' ? positions : postflopOrder(positions)
  const committed: Record<string, number> = {}
  for (const p of positions) committed[p] = 0
  let currentBet = 0
  if (street === 'preflop') {
    if (positions.includes('SB')) committed['SB'] = hand.sb
    if (positions.includes('BB')) committed['BB'] = hand.bb
    currentBet = hand.bb
  }
  void folded; void allIn; void order

  // Replay actions on this street up to (not including) this one.
  const entries = hand.actions[street]
  const idx = entries.indexOf(action)
  for (let i = 0; i < idx; i++) {
    const a = entries[i]
    if (a.type === 'call') committed[a.pos] = currentBet
    else if (a.type === 'bet' || a.type === 'raise') {
      committed[a.pos] = a.toAmount ?? currentBet
      currentBet = Math.max(currentBet, committed[a.pos])
    }
  }

  const name = nameOf(action.pos)
  switch (action.type) {
    case 'fold':
      return `${name}: folds`
    case 'check':
      return `${name}: checks`
    case 'call': {
      const amt = currentBet - (committed[action.pos] ?? 0)
      return `${name}: calls ${money(amt)}`
    }
    case 'bet': {
      const to = action.toAmount ?? 0
      return `${name}: bets ${money(to)}`
    }
    case 'raise': {
      const to = action.toAmount ?? 0
      const by = to - currentBet
      return `${name}: raises ${money(by)} to ${money(to)}`
    }
  }
}

/**
 * Running pot total from preflop through (and including) `street` — i.e. all
 * chips committed up to the end of that street's action entered so far.
 */
export function potThroughStreet(hand: Hand, street: Street): number {
  const positions = positionsForSize(hand.numPlayers)
  const perPlayer: Record<string, number> = {}
  for (const p of positions) perPlayer[p] = 0
  let folded = new Set<string>()
  let allIn = new Set<string>()
  for (const s of STREETS) {
    const st = streetState(hand, s, folded, allIn)
    for (const p of positions) perPlayer[p] += st.committed[p] ?? 0
    folded = st.folded
    allIn = st.allIn
    if (s === street) break
  }
  return Object.values(perPlayer).reduce((a, b) => a + b, 0)
}

/** Total pot = sum of every player's committed amount across all streets. */
export function computeTotalPot(hand: Hand): number {
  const positions = positionsForSize(hand.numPlayers)
  const perPlayer: Record<string, number> = {}
  for (const p of positions) perPlayer[p] = 0
  let folded = new Set<string>()
  let allIn = new Set<string>()
  for (const s of STREETS) {
    const st = streetState(hand, s, folded, allIn)
    for (const p of positions) perPlayer[p] += st.committed[p] ?? 0
    folded = st.folded
    allIn = st.allIn
  }
  return Object.values(perPlayer).reduce((a, b) => a + b, 0)
}

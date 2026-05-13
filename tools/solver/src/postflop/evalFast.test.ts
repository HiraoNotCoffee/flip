import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, parseCard } from './card.js';
import { eval5, eval7 } from './eval.js';
import { eval5Fast, eval7Fast } from './evalFast.js';

test('eval5Fast matches eval5 on diverse 5-card combos', () => {
  const samples = [
    'Ad,Kc,Qh,Js,Td', // straight Ahigh
    'Ad,2c,3h,4s,5d', // wheel
    '5s,6s,7s,8s,9s', // straight flush
    'Ts,Js,Qs,Ks,As', // royal
    '2s,5s,9s,Js,Ks', // flush
    'Ad,Ac,Ah,As,Kd', // quads
    'Ad,Ac,Ah,Ks,Kd', // full house
    'Ad,Ac,Ah,Ks,Qd', // trips
    'Ad,Ac,Kh,Ks,Qd', // two pair
    'Ad,Ac,Kh,Qs,Jd', // pair
    'Ad,Kc,Qh,Js,9d', // high
    '2d,2c,3h,4s,5d', // small pair
  ];
  for (const s of samples) {
    const cards = parseBoard(s);
    const a = eval5(cards);
    const b = eval5Fast(cards[0], cards[1], cards[2], cards[3], cards[4]);
    assert.equal(b, a, `mismatch on ${s}: slow=${a} fast=${b}`);
  }
});

test('eval5Fast random samples match eval5 (1000 cases)', () => {
  let seed = 42;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  for (let i = 0; i < 1000; i++) {
    const used = new Set<number>();
    const cards: number[] = [];
    while (cards.length < 5) {
      const c = Math.floor(rand() * 52);
      if (used.has(c)) continue;
      used.add(c);
      cards.push(c);
    }
    const a = eval5(cards);
    const b = eval5Fast(cards[0], cards[1], cards[2], cards[3], cards[4]);
    assert.equal(b, a, `random case ${i}: ${cards.join(',')} slow=${a} fast=${b}`);
  }
});

test('eval7Fast matches eval7', () => {
  const cards = ['Ad', 'Ac', 'Kh', 'Qs', 'Jd', 'Td', 'Th'].map(parseCard);
  const a = eval7(cards);
  const b = eval7Fast(cards);
  assert.equal(b, a);
});

test('eval7Fast random samples (200 cases)', () => {
  let seed = 7;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  for (let i = 0; i < 200; i++) {
    const used = new Set<number>();
    const cards: number[] = [];
    while (cards.length < 7) {
      const c = Math.floor(rand() * 52);
      if (used.has(c)) continue;
      used.add(c);
      cards.push(c);
    }
    const a = eval7(cards);
    const b = eval7Fast(cards);
    assert.equal(b, a, `random case ${i}: ${cards.join(',')} slow=${a} fast=${b}`);
  }
});

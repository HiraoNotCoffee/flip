import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, parseCard } from './card.js';
import { categoryOf, eval5, eval7, HAND_CATEGORY } from './eval.js';

function eval5Of(s: string): number {
  return eval5(parseBoard(s));
}

test('high card vs pair', () => {
  const high = eval5Of('Ad,Kc,Qh,Js,9d'); // A high
  const pair = eval5Of('2d,2c,3h,4s,5d');
  assert.ok(pair > high);
  assert.equal(categoryOf(high), HAND_CATEGORY.HIGH);
  assert.equal(categoryOf(pair), HAND_CATEGORY.PAIR);
});

test('two pair vs pair', () => {
  const tp = eval5Of('Ad,Ac,Kh,Ks,9d');
  const p = eval5Of('Ad,Ac,Kh,Qs,9d');
  assert.ok(tp > p);
  assert.equal(categoryOf(tp), HAND_CATEGORY.TWO_PAIR);
});

test('trips vs two pair', () => {
  const trips = eval5Of('Ad,Ac,Ah,Ks,9d');
  const tp = eval5Of('Ad,Ac,Kh,Ks,9d');
  assert.ok(trips > tp);
  assert.equal(categoryOf(trips), HAND_CATEGORY.TRIPS);
});

test('straight detection (high)', () => {
  const straight = eval5Of('Ad,Kc,Qh,Js,Td');
  assert.equal(categoryOf(straight), HAND_CATEGORY.STRAIGHT);
});

test('straight wheel (A-2-3-4-5)', () => {
  const wheel = eval5Of('Ad,2c,3h,4s,5d');
  assert.equal(categoryOf(wheel), HAND_CATEGORY.STRAIGHT);
  // wheel should be less than 6-high straight
  const six = eval5Of('6d,2c,3h,4s,5d');
  assert.ok(wheel < six);
});

test('flush vs straight', () => {
  const flush = eval5Of('2s,5s,9s,Js,Ks');
  const straight = eval5Of('Ad,Kc,Qh,Js,Td');
  assert.ok(flush > straight);
  assert.equal(categoryOf(flush), HAND_CATEGORY.FLUSH);
});

test('full house vs flush', () => {
  const fh = eval5Of('Ad,Ac,Ah,Ks,Kd');
  const flush = eval5Of('2s,5s,9s,Js,Ks');
  assert.ok(fh > flush);
  assert.equal(categoryOf(fh), HAND_CATEGORY.FULL_HOUSE);
});

test('quads vs full house', () => {
  const quads = eval5Of('Ad,Ac,Ah,As,Kd');
  const fh = eval5Of('Ad,Ac,Ah,Ks,Kd');
  assert.ok(quads > fh);
  assert.equal(categoryOf(quads), HAND_CATEGORY.QUADS);
});

test('straight flush', () => {
  const sf = eval5Of('5s,6s,7s,8s,9s');
  const flush = eval5Of('2s,5s,9s,Js,Ks');
  const quads = eval5Of('Ad,Ac,Ah,As,Kd');
  assert.ok(sf > flush);
  assert.ok(sf > quads);
  assert.equal(categoryOf(sf), HAND_CATEGORY.STRAIGHT_FLUSH);
});

test('royal flush is straight flush with A high', () => {
  const royal = eval5Of('Ts,Js,Qs,Ks,As');
  const sf9 = eval5Of('5s,6s,7s,8s,9s');
  assert.ok(royal > sf9);
});

test('pair kicker matters', () => {
  const aaKh = eval5Of('Ad,Ac,Kh,3s,2d');
  const aaQh = eval5Of('Ad,Ac,Qh,3s,2d');
  assert.ok(aaKh > aaQh);
});

test('full house tie-breaker uses trips rank', () => {
  const aaaKK = eval5Of('Ad,Ac,Ah,Ks,Kd');
  const KKKAA = eval5Of('Kd,Kc,Kh,As,Ad');
  assert.ok(aaaKK > KKKAA);
});

test('eval7 picks best 5 from 7', () => {
  // 7 cards: Ad,Ac,Kh,Qs,Jd,Td,Th -> best is Ad Kh Qs Jd Td straight (A-high)
  const cards = ['Ad', 'Ac', 'Kh', 'Qs', 'Jd', 'Td', 'Th'].map(parseCard);
  const v = eval7(cards);
  assert.equal(categoryOf(v), HAND_CATEGORY.STRAIGHT);
});

test('eval7 detects flush among 7', () => {
  // 5 spades + 2 others
  const cards = ['2s', '5s', '9s', 'Js', 'Ks', 'Qh', 'Td'].map(parseCard);
  const v = eval7(cards);
  // Best 5 is 5 spades flush
  assert.equal(categoryOf(v), HAND_CATEGORY.FLUSH);
});

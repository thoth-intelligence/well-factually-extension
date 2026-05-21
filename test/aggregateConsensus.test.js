// aggregateConsensus.test.js — strict-majority truth table.
//
// Pins the v0.5.1 N-voice generalization so a future tweak (e.g. switch to
// supermajority, or relax the 2-of-2 special case) doesn't silently regress
// the consensus badge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateConsensus } from "../chrome-extension/consensus.js";

const agree = (n) => Array(n).fill({ verdict: "agree" });
const mix = (a, d) => [
  ...Array(a).fill({ verdict: "agree" }),
  ...Array(d).fill({ verdict: "disagree" }),
];

test("N=0 -> inconclusive", () => {
  const r = aggregateConsensus([]);
  assert.equal(r.verdict, "inconclusive");
});

test("N=1 -> inconclusive (no peer to consense with)", () => {
  assert.equal(aggregateConsensus(agree(1)).verdict, "inconclusive");
});

test("2-of-2 -> agree", () => {
  assert.equal(aggregateConsensus(agree(2)).verdict, "agree");
});

test("1-of-2 -> inconclusive (special-cased per spec §4)", () => {
  assert.equal(aggregateConsensus(mix(1, 1)).verdict, "inconclusive");
});

test("0-of-2 -> inconclusive", () => {
  assert.equal(aggregateConsensus(mix(0, 2)).verdict, "inconclusive");
});

test("2-of-3 -> agree", () => {
  assert.equal(aggregateConsensus(mix(2, 1)).verdict, "agree");
});

test("3-of-3 -> agree (unanimous)", () => {
  assert.equal(aggregateConsensus(agree(3)).verdict, "agree");
});

test("1-of-3 -> split", () => {
  assert.equal(aggregateConsensus(mix(1, 2)).verdict, "split");
});

test("3-of-4 -> agree", () => {
  assert.equal(aggregateConsensus(mix(3, 1)).verdict, "agree");
});

test("2-of-4 -> split (tie does NOT satisfy strict majority)", () => {
  assert.equal(aggregateConsensus(mix(2, 2)).verdict, "split");
});

test("4-of-4 -> agree (unanimous, full house)", () => {
  assert.equal(aggregateConsensus(agree(4)).verdict, "agree");
});

test("verdict result carries agreed/total counts", () => {
  const r = aggregateConsensus(mix(2, 1));
  assert.equal(r.agreed, 2);
  assert.equal(r.total, 3);
});

test("malformed voices (null entries) are not counted as agree", () => {
  const r = aggregateConsensus([
    { verdict: "agree" },
    null,
    { verdict: "agree" },
  ]);
  assert.equal(r.agreed, 2);
  assert.equal(r.total, 3);
  // 2-of-3 majority, but a null entry shouldn't crash.
  assert.equal(r.verdict, "agree");
});

test("non-array input -> inconclusive (defensive)", () => {
  assert.equal(aggregateConsensus(null).verdict, "inconclusive");
  assert.equal(aggregateConsensus(undefined).verdict, "inconclusive");
  assert.equal(aggregateConsensus("not an array").verdict, "inconclusive");
});

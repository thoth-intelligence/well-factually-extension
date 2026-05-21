// postProcess.test.js — factflag output guard.
//
// Pins:
//   - Confidence prefix [N] extraction (1-5 only)
//   - Markdown fence stripping (v0.5.1 — defense against Gemini ``` wrapping)
//   - SKIP token handling (leading, embedded)
//   - Min-word / max-word caps
//   - Sentence-terminator requirement

import { test } from "node:test";
import assert from "node:assert/strict";
import { postProcess } from "../chrome-extension/format_guard.js";

test("[N] sentence parses to {confidence:N, isSkip:false, text}", () => {
  const r = postProcess("[5] The GDP claim is misleading.");
  assert.equal(r.isSkip, false);
  assert.equal(r.confidence, 5);
  assert.match(r.text, /GDP claim/);
});

test("fenced confidence prefix survives strip (v0.5.1)", () => {
  const r = postProcess("```\n[5] The GDP claim is misleading.\n```");
  assert.equal(r.isSkip, false);
  assert.equal(r.confidence, 5);
  assert.match(r.text, /GDP claim/);
});

test("```json fenced SKIP -> isSkip", () => {
  const r = postProcess("```json\nSKIP\n```");
  assert.equal(r.isSkip, true);
});

test("plain SKIP token -> isSkip", () => {
  const r = postProcess("SKIP");
  assert.equal(r.isSkip, true);
});

test("empty input -> isSkip with null confidence", () => {
  const r = postProcess("");
  assert.equal(r.isSkip, true);
  assert.equal(r.confidence, null);
});

test("null/undefined input -> isSkip safely", () => {
  assert.equal(postProcess(null).isSkip, true);
  assert.equal(postProcess(undefined).isSkip, true);
});

test("missing sentence-end punctuation -> isSkip", () => {
  const r = postProcess("[3] no terminator");
  assert.equal(r.isSkip, true);
});

test("under 3 words -> isSkip", () => {
  const r = postProcess("[2] Too short.");
  assert.equal(r.isSkip, true);
});

test("over 45 words -> isSkip (meta-commentary cap)", () => {
  const longSentence = "[3] " + "word ".repeat(50) + "end.";
  const r = postProcess(longSentence);
  assert.equal(r.isSkip, true);
});

test("confidence prefix outside 1-5 not extracted", () => {
  // The LEADING_CONFIDENCE regex matches [1-5] only. [6] is treated as
  // prose (left as-is in text); no confidence is extracted.
  const r = postProcess("[6] Something happened here.");
  assert.equal(r.confidence, null);
});

test("CJK characters stripped from output", () => {
  const r = postProcess("[3] The claim 之 is sketchy.");
  assert.equal(r.isSkip, false);
  assert.equal(r.confidence, 3);
  assert.ok(!/[一-鿿]/.test(r.text), "CJK should be stripped");
});

test("embedded SKIP truncates", () => {
  const r = postProcess("[3] Real claim here. SKIP and then more.");
  // The EMBEDDED_SKIP regex truncates at SKIP, leaving "Real claim here."
  assert.equal(r.isSkip, false);
  assert.match(r.text, /Real claim here/);
  assert.ok(!/SKIP/.test(r.text));
});

test("leading 'Here is the flag:' preamble stripped", () => {
  const r = postProcess("[3] Here is the flag: an unsourced statistic appears.");
  assert.equal(r.isSkip, false);
  assert.ok(!/Here is/i.test(r.text));
});

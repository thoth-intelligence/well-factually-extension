// parseConsensusVerdict.test.js — pins the defensive parser's contract.
//
// Llama / Grok / Claude consensus voices emit JSON verdicts. The parser
// defends against: markdown fences (Llama loves wrapping JSON in ```),
// <thinking> blocks (Grok reasoning leakage), prose prefixes ("Sure: ..."),
// and non-string verdict values. v0.5.1 calibrates these cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConsensusVerdict } from "../chrome-extension/format_guard.js";

const cases = [
  // Happy path
  ['{"verdict":"agree"}', "agree"],
  ['{"verdict":"disagree"}', "disagree"],

  // Markdown fence wrapping (Llama)
  ['```json\n{"verdict":"agree"}\n```', "agree"],
  ['```\n{"verdict":"disagree"}\n```', "disagree"],

  // <thinking> block (Grok)
  ['<thinking>this is a serious claim</thinking>\n{"verdict":"agree"}', "agree"],
  ['<thinking>a</thinking><thinking>b</thinking>{"verdict":"disagree"}', "disagree"],

  // Prose prefix
  ['Sure: {"verdict":"agree"}', "agree"],
  ['Here is the JSON: {"verdict":"disagree"}', "disagree"],

  // Case coercion — model emits uppercase
  ['{"verdict":"AGREE"}', "agree"],
  ['{"verdict":" Agree "}', "agree"],
  ['{"verdict":"Disagree"}', "disagree"],

  // Whitespace / formatting variations
  ['  {"verdict":"agree"}  ', "agree"],
  ['{\n  "verdict": "agree"\n}', "agree"],

  // Reject: invalid verdict values
  ['{"verdict":"maybe"}', null],
  ['{"verdict":""}', null],
  ['{"verdict":"true"}', null],

  // Reject: non-string verdict (numeric, boolean, etc.)
  ['{"verdict":1}', null],
  ['{"verdict":true}', null],
  ['{"verdict":null}', null],

  // Reject: malformed
  ["not json at all", null],
  ["", null],
  [null, null],
  [undefined, null],
  ["{", null],
  ['{"verdict":"agree"', null],   // missing closing brace
];

for (const [input, expected] of cases) {
  test(`parse: ${JSON.stringify(input)}`, () => {
    const r = parseConsensusVerdict(input);
    assert.equal(r.verdict, expected);
  });
}

test("greedy-brace span captures first-to-last brace (multiple objects)", () => {
  // The parser uses indexOf("{") / lastIndexOf("}") — so the greedy span
  // includes ANY content between. If the inner span fails to JSON.parse
  // we fall back to null. Pin this behavior so a future "switch to first
  // balanced object" refactor is a deliberate choice.
  const input = '{"x":1} text {"verdict":"agree"}';
  // The greedy span '{"x":1} text {"verdict":"agree"}' is not valid JSON.
  // Result: null (no-vote). This is the safe failure mode.
  assert.equal(parseConsensusVerdict(input).verdict, null);
});

test("never throws on adversarial input", () => {
  const adversarial = [
    "}{",
    "{".repeat(10000),
    "<thinking>" + "unclosed",
    "```" + "no close fence " + "{",
    String.fromCharCode(0) + '{"verdict":"agree"}' + String.fromCharCode(0),
  ];
  for (const x of adversarial) {
    assert.doesNotThrow(() => parseConsensusVerdict(x));
  }
});

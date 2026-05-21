// Port of an earlier sidebar prototype — unit-tested against
// real qwen/Claude failure samples. Strips leading SKIP variants, label leaks,
// CJK monologue. Embedded SKIP truncates. Requires sentence-end punctuation
// and ≥3 words.

const CJK_PATTERN = /[　-〿㐀-䶿一-鿿＀-￯]+/g;
const LEADING_SKIP = /^\s*\(?SKIP\)?\.?\s*/i;
const LEADING_LABEL = /^(What'?s wrong:|Actually focusing[^.:]*[.:])\s*/i;
const LEADING_PREAMBLE = /^(Here'?s|Here\s+is|The (?:question|summary|flag)\s+is)\s*[:\-]?\s*/i;
const EMBEDDED_SKIP = /(?:\(SKIP\)|(?:^|\s)SKIP(?=[\s.]|$))/i;
const ENDS_WITH_PUNCT = /[.!?…]$/;
// Confidence score prefix added 2026-05-14: factflag prompt now begins each
// output with `[N]` where N is 1-5. Extract it before other postprocessing.
const LEADING_CONFIDENCE = /^\s*\[([1-5])\]\s*/;

export function postProcess(raw) {
  if (!raw) return { isSkip: true, text: "", confidence: null };
  let t = raw.trim();
  let confidence = null;
  const c = t.match(LEADING_CONFIDENCE);
  if (c) {
    confidence = parseInt(c[1], 10);
    t = t.slice(c[0].length);
  }
  t = t.replace(CJK_PATTERN, " ");
  t = t.replace(LEADING_SKIP, "");
  t = t.replace(LEADING_LABEL, "");
  t = t.replace(LEADING_PREAMBLE, "");
  const m = t.match(EMBEDDED_SKIP);
  if (m) t = t.slice(0, m.index).trim();
  t = t.replace(/\s+/g, " ").trim();
  if (t && !ENDS_WITH_PUNCT.test(t)) return { isSkip: true, text: "", confidence };
  const words = t.split(/\s+/).filter(Boolean);
  if (!t || words.length < 3) return { isSkip: true, text: "", confidence };
  // Hard cap on output length — the prompt asks for ≤30 words. Anything
  // dramatically longer is the model wandering into meta-commentary (e.g.
  // "The most recent lines contain rhetorical characterization of…"). Treat
  // as SKIP rather than letting a wall of text into the sidebar.
  if (words.length > 45) return { isSkip: true, text: "", confidence };
  return { isSkip: false, text: t, confidence };
}

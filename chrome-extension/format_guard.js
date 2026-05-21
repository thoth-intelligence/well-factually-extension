// Port of an earlier sidebar prototype — unit-tested against
// real qwen/Claude failure samples. Strips leading SKIP variants, label leaks,
// CJK monologue. Embedded SKIP truncates. Requires sentence-end punctuation
// and ≥3 words.
//
// v9.5 additions (2026-05-21): markdown-fence pre-strip (defense in depth
// against Gemini's occasional ```...``` wrapping) and parseConsensusVerdict
// helper for the new Llama/Grok/Claude consensus path.

const CJK_PATTERN = /[　-〿㐀-䶿一-鿿＀-￯]+/g;
const LEADING_SKIP = /^\s*\(?SKIP\)?\.?\s*/i;
const LEADING_LABEL = /^(What'?s wrong:|Actually focusing[^.:]*[.:])\s*/i;
const LEADING_PREAMBLE = /^(Here'?s|Here\s+is|The (?:question|summary|flag)\s+is)\s*[:\-]?\s*/i;
const EMBEDDED_SKIP = /(?:\(SKIP\)|(?:^|\s)SKIP(?=[\s.]|$))/i;
const ENDS_WITH_PUNCT = /[.!?…]$/;
// Confidence score prefix added 2026-05-14: factflag prompt now begins each
// output with `[N]` where N is 1-5. Extract it before other postprocessing.
const LEADING_CONFIDENCE = /^\s*\[([1-5])\]\s*/;

// Strip a leading and/or trailing markdown code fence. Defensive: a few of
// the consensus-voice vendors (notably Llama 4 Maverick) like to wrap any
// JSON in ```...``` even when instructed not to. Apply this to ANY raw
// model output before further parsing.
const FENCE_LEAD = /^\s*```(?:json|JSON|markdown|md)?\s*/;
const FENCE_TRAIL = /\s*```\s*$/;
function stripFences(s) {
  return String(s).replace(FENCE_LEAD, "").replace(FENCE_TRAIL, "");
}

// Strip `<thinking>...</thinking>` blocks. Grok reasoning models can emit
// these even on the OpenAI-compat surface; spec §7 calls for stripping
// before JSON parse.
const THINKING_BLOCK = /<thinking[\s\S]*?<\/thinking>/gi;
function stripThinking(s) {
  return String(s).replace(THINKING_BLOCK, "");
}

export function postProcess(raw) {
  if (!raw) return { isSkip: true, text: "", confidence: null };
  // Strip markdown fences first — Gemini occasionally wraps the [N] sentence
  // in ``` when asked for "strict format" output. Defensive: cheap, idempotent.
  let t = stripFences(raw).trim();
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

// parseConsensusVerdict — defensive parser for the JSON verdict object that
// Llama / Grok / Claude (and Gemini when used as a consensus voice) emit.
// Strips markdown fences, strips Grok's `<thinking>` reasoning blocks,
// extracts the first {...} JSON object, parses it, coerces `verdict` to
// "agree" or "disagree". Returns { verdict: "agree"|"disagree"|null }.
// Never throws — failures collapse to { verdict: null }, which the caller
// treats as a no-vote.
export function parseConsensusVerdict(raw) {
  if (!raw) return { verdict: null };
  let s = stripThinking(stripFences(String(raw))).trim();
  // Find the first balanced-looking JSON object. We're permissive about
  // surrounding prose: the prompt forbids prose but a misbehaving voice
  // might emit "Sure: {\"verdict\":\"agree\"}" — accept it anyway.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return { verdict: null };
  const candidate = s.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (_e) {
    return { verdict: null };
  }
  if (!parsed || typeof parsed !== "object") return { verdict: null };
  const v = String(parsed.verdict || "").toLowerCase().trim();
  if (v === "agree" || v === "disagree") return { verdict: v };
  return { verdict: null };
}

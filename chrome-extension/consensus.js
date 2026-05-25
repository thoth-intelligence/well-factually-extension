// consensus.js — pure helpers for the cross-vendor consensus path.
//
// Extracted from background.js so they can be unit-tested without pulling in
// the service-worker side effects (chrome.alarms, chrome.runtime listeners).
// All functions in this module are deterministic and side-effect-free.
//
// Used by:
//   - background.js (runConsensus → aggregateConsensus; processTick error
//     handling → sanitizeError; fetchDossier → sanitizeUploaderText)
//   - test/*.test.js
//
// New in v0.5.1 — addresses gstack review findings R1 (uploader prompt
// injection), R5 (unparseable voice tally honesty), R6 (error-message
// leakage into exported markdown).

// aggregateConsensus — strict-majority rule. Generalized from spec §4's
// 3-voice case to N voices: agreed >= floor(N/2) + 1 → agree. 2-of-2 still
// counts as agree (matches spec §4). With < 2 voices the result is
// inconclusive (no single corroborating voice is "consensus"). Used to gate
// whether a consensus card is emitted at all.
//
// v0.5.1 addendum: callers should count UNPARSEABLE voices as "disagree"
// before passing the voices array in. That keeps the tally honest — a
// silently-unparseable Grok response (common when max_tokens=50 truncates
// the <thinking> block) no longer inflates the apparent unanimity of the
// surviving voices. See R5 in docs/v9.5-review-findings.md.
export function aggregateConsensus(voices) {
  if (!Array.isArray(voices) || voices.length < 2) {
    return { verdict: "inconclusive", agreed: 0, total: voices?.length || 0 };
  }
  const agreed = voices.filter((v) => v && v.verdict === "agree").length;
  const needed = Math.floor(voices.length / 2) + 1;
  if (agreed >= needed) return { verdict: "agree", agreed, total: voices.length };
  return {
    verdict: voices.length === 2 ? "inconclusive" : "split",
    agreed,
    total: voices.length,
  };
}

// sanitizeUploaderText — defense against prompt injection via YouTube
// uploader-controlled metadata (title, channel, description, viewCount,
// uploadDate). The YouTube creator controls these fields and they flow
// directly into the Gemini Pro dossier prompt. A crafted title like
// `"""}\n\nIgnore prior instructions...` would otherwise break the prompt's
// triple-quote terminator and hijack the briefing.
//
// Defenses applied:
//   - Strip ASCII control characters and DEL.
//   - Break the literal triple-quote terminator used in our user prompts.
//   - Break the markdown triple-backtick fence (defensive for any future
//     prompt that uses ``` blocks).
//   - Hard-truncate per-field length cap.
//
// We do NOT try to detect intent or strip "ignore prior instructions" —
// that arms race never ends. Instead we make the surrounding prompt
// framing structurally resistant: the dossier system prompt also calls out
// that the metadata fields are untrusted creator-supplied input.
export function sanitizeUploaderText(s, maxLen = 200) {
  if (s == null) return "";
  return String(s)
    .replace(/[\x00-\x1f\x7f]+/g, " ")            // ASCII control chars + DEL → space
    .replace(/"""/g, '"””')              // U+201D RIGHT DOUBLE QUOTE breaks the literal """ terminator
    .replace(/```/g, "'`'`'")                       // break markdown triple-backtick
    .replace(/\s+/g, " ")
    .slice(0, maxLen)
    .trim();
}

// sanitizeError — scrubs sensitive context from a server/error message before
// it's rendered into a user-facing card or serialized into the exported
// markdown session. Vertex 4xx response bodies frequently echo the project
// ID, project number, model slug, and account-bound identifiers; the user
// then shares the .md export with journalists/judges per the contest pitch.
//
// v0.5.3: special-cases common HTTP status patterns BEFORE general redaction.
// Raw Vertex/OpenAI error envelopes are leaky and confusing; we emit one
// clean line per category that tells the user what to do about it.
//
// We don't try to redact every conceivable identifier — just the obvious
// shapes: configured project ID (when supplied), email addresses, and long
// numeric IDs (project numbers, billing IDs).
export function sanitizeError(message, knownProjectId = "") {
  if (!message) return "Error";
  const s0 = String(message);

  // v0.5.3 — friendly copy for the three common Vertex failure modes.
  // The 429 case is the one most users hit first when traffic ramps:
  // Gemini's per-project per-minute quota is the binding constraint.
  if (/\b429\b/.test(s0) || /[Rr]esource exhausted/.test(s0) || /[Rr]ate ?limit/.test(s0)) {
    // v0.7.0: friendlier copy + actionable next step. The technical
    // "raise the Gemini quota in GCP Console → IAM → Quotas" line was
    // alarming to new users. Adding a free AI Studio key in Options
    // routes around this entirely (Studio has its own quota pool).
    return "Briefly paused — Google's free quota is busy. Adding a free AI Studio API key in Settings gives you more room and prevents this. Resumes in 30 seconds.";
  }
  if (/\b401\b/.test(s0) || /[Aa]ccess token (?:expired|invalid)/.test(s0)) {
    return "Your Google Cloud access token expired (these last about an hour). In Settings, paste a new one from `gcloud auth print-access-token`.";
  }
  if (/\b403\b/.test(s0) || /permission denied/i.test(s0)) {
    return "Google Cloud denied this request. Check that Vertex AI is enabled on your project and that the access token has permission to use it.";
  }

  let s = s0;
  if (knownProjectId) {
    const escaped = knownProjectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(escaped, "g"), "<project>");
  }
  // Email-shaped substrings.
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  // Numeric project numbers / billing IDs (6+ contiguous digits).
  s = s.replace(/\b\d{6,}\b/g, "<id>");
  // Collapse repeated whitespace and trim.
  s = s.replace(/\s+/g, " ").trim();
  // Cap length tighter than the v9.5 200-char message cap.
  return s.slice(0, 160);
}

// is429 — single source of truth for the rate-limit pattern. Used by
// background.js to gate the per-tab cooldown.
export function is429(message) {
  if (!message) return false;
  const s = String(message);
  return /\b429\b/.test(s) || /[Rr]esource exhausted/.test(s);
}

// v9-era settings keys that v9.5 no longer uses. Removed from
// chrome.storage.local on extension startup so a v9 → v9.5 upgrade does
// not leave plaintext Anthropic / OpenAI / Gemini-native API keys lying
// around indefinitely. See R9 in docs/v9.5-review-findings.md.
export const V9_DEAD_STORAGE_KEYS = [
  "apiKey",        // v9 Anthropic key
  "model",         // v9 Claude tier selector
  "openaiKey",     // v9 consensus OpenAI key
  "openaiModel",
  "geminiKey",     // v9 consensus native-Gemini key
  "geminiModel",
];

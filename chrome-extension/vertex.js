// vertex.js — Vertex AI OpenAI-compatible chat-completions client and model registry.
//
// Single source of truth for which model serves which role. v9.6 will add Claude
// as a one-row registry change (commented stub below), not a refactor. All cloud
// calls go through callVertex(role, messages, opts) — background.js does not
// import any vendor SDKs or build URLs of its own.
//
// Auth track: D1=B for v9.5 — user pastes a bearer token from
// `gcloud auth print-access-token` in Options (60-min validity). 401 surfaces
// as a clear "token expired" error card. v9.5.1 will layer chrome.identity
// OAuth on top by branching getAccessToken() — no caller needs to change.

// Gemini OpenAI-compat thinking control: confirmed working at this nested key
// path during the 2026-05-19 smoke test. Smoke-test data: a 5-token user
// message returned ~23 reasoning tokens unless this was passed. Apply on every
// latency-sensitive role (classifier / chitchat / citation). The dossier role
// intentionally omits this — pre-roll is latency-tolerant and benefits from
// the extra deliberation.
const GEMINI_NO_THINK = { google: { thinking_config: { thinking_budget: 0 } } };

// 2026-05-21 addendum: every voice runs on the GLOBAL endpoint. Prior plan
// pinned Llama to us-east5 (where the smoke test landed) and Claude to v9.6;
// the addendum overrides both. If a voice fails at global, the consensus
// mechanism in background.js silently no-votes after the 4s timeout — we do
// NOT add region-fallback logic. Failures fall back to a different VOICE,
// per the addendum.
export const MODEL_REGISTRY = {
  classifier:         { slug: "google/gemini-2.5-flash",                      region: "global", extraBody: GEMINI_NO_THINK },
  chitchat:           { slug: "google/gemini-2.5-flash",                      region: "global", extraBody: GEMINI_NO_THINK },
  citation:           { slug: "google/gemini-2.5-flash",                      region: "global", extraBody: GEMINI_NO_THINK },
  dossier:            { slug: "google/gemini-2.5-pro",                        region: "global", extraBody: {} },
  // Llama 4 Maverick: addendum-migrated from us-east5 to global. If global
  // 404s the voice no-votes silently and Gemini+Grok+Claude still form a
  // consensus.
  "consensus-llama":  { slug: "meta/llama-4-maverick-17b-128e-instruct-maas", region: "global", extraBody: {} },
  // Grok 4.1 Fast Reasoning: every call costs ~664 prompt tokens before the
  // user message because the Vertex/xAI gateway injects a system wrapper.
  // Mitigation lives in background.js — only fires on confidence-4/5 flags.
  "consensus-grok":   { slug: "xai/grok-4.1-fast-reasoning",                  region: "global", extraBody: {} },
  // Claude Haiku 4.5: Anthropic-side approval confirmed 2026-05-21 (Haiku
  // fully enabled on Vertex). Has three separate per-model quotas (input
  // tokens / output tokens / requests per minute). On 429: ONE short backoff
  // + retry, then voice-fallback (handled in background.js callConsensusVoice).
  // Sonnet 4.5 (slug "anthropic/claude-sonnet-4-5@20250929") is conditionally
  // available — approval may still be pending. Not wired up for v9.5; v9.5.1
  // can flip it on once Anthropic approves.
  "consensus-claude": { slug: "anthropic/claude-haiku-4-5@20251001",          region: "global", extraBody: {} },
};

export function buildVertexUrl({ region }, projectId) {
  // The global endpoint drops the region prefix from the host AND uses
  // `locations/global` in the path. Regional endpoints embed the region in
  // both places. Confirmed via the 2026-05-19 smoke test against all four
  // shipping models. v0.5.1: projectId is encodeURIComponent'd to defuse
  // any '/', '?', or '#' that would otherwise let a malformed project ID
  // redirect the request to a different Google API path within the same
  // host (matches the test-connection handler in options.js).
  const safeProject = encodeURIComponent(projectId);
  if (region === "global") {
    return `https://aiplatform.googleapis.com/v1beta1/projects/${safeProject}/locations/global/endpoints/openapi/chat/completions`;
  }
  return `https://${region}-aiplatform.googleapis.com/v1beta1/projects/${safeProject}/locations/${region}/endpoints/openapi/chat/completions`;
}

// getAuthAndProject — fused storage read. v0.5.1 collapses the prior
// sequential getAccessToken + getProjectId pair into a single
// chrome.storage.local.get call so a conf-4/5 tick (chitchat + classifier +
// citation + 3 consensus voices = up to 6 callVertex invocations) does 1
// storage hop instead of 12. The original two-getter API is preserved for
// callers that genuinely need only one of the values.
async function getAuthAndProject() {
  const { vertexBearerToken, gcpProjectId } = await chrome.storage.local.get({
    vertexBearerToken: "",
    gcpProjectId: "",
  });
  const t = (vertexBearerToken || "").trim();
  const p = (gcpProjectId || "").trim();
  if (!t) {
    throw new Error(
      "No Vertex AI access token set. Open extension Options and paste a fresh `gcloud auth print-access-token` value.",
    );
  }
  if (!p) {
    throw new Error("No GCP project ID set. Open extension Options and enter your project ID.");
  }
  return { token: t, projectId: p };
}

// getAccessToken / getProjectId kept as exports for any caller that genuinely
// needs a single value (currently none in tree, but the surface is part of
// the module's public contract).
export async function getAccessToken() { return (await getAuthAndProject()).token; }
export async function getProjectId() { return (await getAuthAndProject()).projectId; }

// callVertex — single dispatch point for every Vertex call. The role argument
// is the registry key, not a model slug; this is deliberate so that
// model-swap decisions live in MODEL_REGISTRY only.
export async function callVertex(role, messages, opts = {}) {
  const {
    maxTokens = 220,
    temperature = 0.4,
    tools = null,                // OpenAI-style tools array (used by citation).
    responseFormat = null,       // e.g. { type: "json_object" } when supported.
    signal = null,               // AbortSignal — used by withTimeout in background.
  } = opts;

  const entry = MODEL_REGISTRY[role];
  if (!entry) throw new Error(`Unknown Vertex role: ${role}`);

  const { token, projectId } = await getAuthAndProject();

  const body = {
    model: entry.slug,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (entry.extraBody && Object.keys(entry.extraBody).length) {
    body.extra_body = entry.extraBody;
  }
  if (tools) body.tools = tools;
  if (responseFormat) body.response_format = responseFormat;

  const url = buildVertexUrl(entry, projectId);
  const fetchOpts = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (signal) fetchOpts.signal = signal;

  const resp = await fetch(url, fetchOpts);
  if (!resp.ok) {
    const truncated = (await resp.text()).slice(0, 300);
    if (resp.status === 401) {
      throw new Error(
        `Vertex 401 — your access token expired or is invalid. Refresh it in Options. (${truncated})`,
      );
    }
    if (resp.status === 403) {
      throw new Error(
        `Vertex 403 — project lacks access to ${entry.slug} or the AI Platform API is not enabled. (${truncated})`,
      );
    }
    throw new Error(`Vertex ${role} HTTP ${resp.status}: ${truncated}`);
  }
  return await resp.json();
}

// Extract the text content from a Vertex/OpenAI-compat response envelope.
// Encapsulated here so callers do not poke at choices[0].message.content
// in five places.
export function extractText(vertexResponse) {
  return (vertexResponse?.choices?.[0]?.message?.content || "").trim();
}

// Convenience: build the OpenAI-style messages array from system + user strings.
// Most call sites in background.js have these as separate inputs so the
// existing prompt-building code in prompts.js can stay unchanged.
export function toMessages(system, user) {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// withTimeout — wrap a promise in a race against an AbortController-driven
// timer. Used for the 4s consensus-voice cap (treat slower responses as
// no-vote). Exported here so background.js does not re-implement it.
export function withTimeout(promise, ms, controller) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (controller) {
        try { controller.abort(); } catch (_e) { /* already aborted */ }
      }
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// callGeminiWithSearch — uses Vertex's NATIVE `:generateContent` endpoint
// (NOT the OpenAI-compat chat/completions surface) because the OpenAI-compat
// layer does not pass Gemini's `googleSearch` grounding tool through.
// Confirmed in v0.5.1 production: a tools:[{googleSearch:{}}] field on the
// OpenAI-compat endpoint is silently ignored, citation cards never appeared.
//
// This is the ONLY path that hits the native Gemini endpoint shape — every
// other role still routes through callVertex(role, messages, opts) on the
// OpenAI-compat surface. Used solely by retrieveCitation in background.js.
//
// Response is returned raw; caller uses extractGroundedCitation to pull
// the source URL out of candidates[].groundingMetadata.groundingChunks[].web.
export async function callGeminiWithSearch(systemPrompt, userPrompt, opts = {}) {
  const {
    maxTokens = 800,
    temperature = 0.0,
    signal = null,
    modelSlug = "gemini-2.5-flash",
    region = "global",
  } = opts;
  const { token, projectId } = await getAuthAndProject();
  const host = region === "global"
    ? "aiplatform.googleapis.com"
    : `${region}-aiplatform.googleapis.com`;
  const safeProject = encodeURIComponent(projectId);
  const url = `https://${host}/v1beta1/projects/${safeProject}/locations/${region}/publishers/google/models/${encodeURIComponent(modelSlug)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const fetchOpts = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (signal) fetchOpts.signal = signal;
  const resp = await fetch(url, fetchOpts);
  if (!resp.ok) {
    const truncated = (await resp.text()).slice(0, 300);
    if (resp.status === 401) throw new Error(`Gemini-native 401 — access token expired. Refresh in Options. (${truncated})`);
    if (resp.status === 403) throw new Error(`Gemini-native 403 — project lacks Gemini access. (${truncated})`);
    throw new Error(`Gemini-native HTTP ${resp.status}: ${truncated}`);
  }
  return await resp.json();
}

// extractGroundedCitation — pull source URL + model summary from a
// callGeminiWithSearch response. groundingMetadata.groundingChunks[].web
// is where Gemini reports the URLs it consulted. Returns null when the
// response was not grounded (model answered from training data without
// triggering a search) — we don't fabricate citations.
export function extractGroundedCitation(geminiResp) {
  const candidate = geminiResp?.candidates?.[0];
  if (!candidate) return null;
  const text = (candidate.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text || /^NONE\.?$/i.test(text)) return null;
  const chunks = candidate.groundingMetadata?.groundingChunks || [];
  for (const c of chunks) {
    const url = c.web?.uri || "";
    if (!/^https?:\/\//i.test(url)) continue;
    return {
      url,
      title: String(c.web?.title || url).slice(0, 120),
      excerpt: text.slice(0, 240),
    };
  }
  return null;
}

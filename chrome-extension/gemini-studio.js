// gemini-studio.js — Google AI Studio fallback for the dossier + citation roles.
//
// Studio (generativelanguage.googleapis.com) uses a completely separate
// quota pool from Vertex AI's per-project per-base-model limits — which
// means a v0.5.x install can ship cards while the Vertex quota is still
// stuck at the 5 RPM new-project default. Auth is a paste-in API key
// instead of a bearer token (Studio keys never expire).
//
// Scope for v0.6.0: this module only handles the roles that ALREADY use
// the native `:generateContent` request shape — citation and dossier.
// Classifier + chitchat stay on the Vertex OpenAI-compat surface (Studio
// has no chat/completions endpoint), so they remain subject to Vertex
// quota. A future v0.6.x can fan classifier/chitchat through Studio too
// by translating message shape, but that's a separate change.
//
// Decision logic in background.js:
//   - If chrome.storage.local.geminiStudioKey is set → use Studio
//   - Otherwise → use the v0.5.x Vertex path (callGeminiWithSearch)

const STUDIO_HOST = "https://generativelanguage.googleapis.com";

// Role-keyed model slugs for the Studio API. Studio uses bare model names
// without the `google/` vendor prefix that Vertex's OpenAI-compat surface
// expects.
const STUDIO_MODEL_FOR_ROLE = {
  classifier: "gemini-2.5-flash",
  chitchat:   "gemini-2.5-flash",
  citation:   "gemini-2.5-flash",
  dossier:    "gemini-2.5-pro",
};

async function getStudioKey() {
  const { geminiStudioKey } = await chrome.storage.local.get({ geminiStudioKey: "" });
  return (geminiStudioKey || "").trim();
}

// Public predicate — used by background.js to decide whether to route via
// Studio or Vertex on each call.
export async function isStudioConfigured() {
  return !!(await getStudioKey());
}

// callGeminiStudioSearch — mirrors callGeminiWithSearch in vertex.js but
// hits the Studio host with API-key auth. Same native request shape
// (systemInstruction + contents + generationConfig + tools). Same response
// shape (candidates[].content.parts[], candidates[].groundingMetadata).
// → extractGroundedCitation from vertex.js works on this response unchanged.
export async function callGeminiStudioSearch(role, systemPrompt, userPrompt, opts = {}) {
  const {
    maxTokens = 800,
    temperature = 0.0,
    signal = null,
    tools = [{ googleSearch: {} }],
    thinkingBudget = 0,
  } = opts;
  const key = await getStudioKey();
  if (!key) throw new Error("Studio API key not configured.");
  const model = STUDIO_MODEL_FOR_ROLE[role];
  if (!model) throw new Error(`Studio: unknown role ${role}`);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  if (thinkingBudget != null) body.generationConfig.thinkingConfig = { thinkingBudget };
  if (tools) body.tools = tools;

  const url = `${STUDIO_HOST}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const fetchOpts = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (signal) fetchOpts.signal = signal;

  // Transient-error retry: Studio 503 ("model is currently experiencing high
  // demand") and 429 (rate) are usually momentary spikes. Retry a couple of
  // times with backoff before surfacing an error card, so a brief capacity
  // blip doesn't interrupt the stream. Bounded by the caller's AbortSignal /
  // PRIMARY_TIMEOUT_MS — if that fires, fetch throws AbortError and we stop.
  // Other statuses (400/403/etc.) are permanent and fail immediately.
  const BACKOFF_MS = [400, 1000];
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    const resp = await fetch(url, fetchOpts);
    if (resp.ok) return await resp.json();
    const truncated = (await resp.text()).slice(0, 300);
    if (resp.status === 400) throw new Error(`Studio 400 — bad API key or malformed request. (${truncated})`);
    if (resp.status === 403) throw new Error(`Studio 403 — API key lacks Gemini access. (${truncated})`);
    if (resp.status === 429 || resp.status === 503) {
      lastErr = new Error(`Studio HTTP ${resp.status}: ${truncated}`);
      if (attempt < BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      throw lastErr;
    }
    throw new Error(`Studio ${role} HTTP ${resp.status}: ${truncated}`);
  }
  throw lastErr;
}

// callGeminiStudioPlain — for the dossier role which doesn't use grounding.
// Same shape as callGeminiStudioSearch but with tools omitted by default.
export async function callGeminiStudioPlain(role, systemPrompt, userPrompt, opts = {}) {
  return callGeminiStudioSearch(role, systemPrompt, userPrompt, {
    tools: null,
    thinkingBudget: opts.thinkingBudget ?? null,  // dossier allows thinking
    ...opts,
  });
}

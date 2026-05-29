// Options page controller for v9.5-Gemini-Grok-Llama.
// v9's per-vendor secondary keys (openaiKey/geminiKey/etc.) are gone: every
// cloud voice now routes through Vertex's OpenAI-compat endpoint with a
// single bearer token. v9's `apiKey` (Anthropic-direct) and `model` (claude-
// haiku/sonnet selector) are likewise gone. Old storage values are
// effectively dead keys — harmless, will get GC'd on next /clear.

const els = {
  backend: document.getElementById("backend"),
  backendVertex: document.getElementById("backend-vertex"),
  backendLmstudio: document.getElementById("backend-lmstudio"),
  gcpProjectId: document.getElementById("gcpProjectId"),
  vertexBearerToken: document.getElementById("vertexBearerToken"),
  vertexTest: document.getElementById("vertexTest"),
  vertexStatus: document.getElementById("vertexStatus"),
  geminiStudioKey: document.getElementById("geminiStudioKey"),
  lmEndpoint: document.getElementById("lmEndpoint"),
  lmModel: document.getElementById("lmModel"),
  lmModelBadge: document.getElementById("lmModelBadge"),
  lmDiscover: document.getElementById("lmDiscover"),
  lmTest: document.getElementById("lmTest"),
  lmStatus: document.getElementById("lmStatus"),
  mode: document.getElementById("mode"),
  chitchatGate: document.getElementById("chitchatGate"),
  sourcePref: document.getElementById("sourcePref"),
  consensusEnabled: document.getElementById("consensusEnabled"),
  consensusVoicesSection: document.getElementById("consensus-voices-section"),
  consensusSection: document.getElementById("consensus-section"),
  // v0.8.0 tier UI
  tierIndicator: document.getElementById("tierIndicator"),
  tierVertexNote: document.getElementById("tierVertexNote"),
  tierConsensusNote: document.getElementById("tierConsensusNote"),
  voiceLlamaEnabled: document.getElementById("voiceLlamaEnabled"),
  voiceGrokEnabled: document.getElementById("voiceGrokEnabled"),
  voiceClaudeEnabled: document.getElementById("voiceClaudeEnabled"),
  glossary: document.getElementById("glossary"),
  // v0.7.0 Pro tier
  proLicense: document.getElementById("proLicense"),
  proVerify: document.getElementById("proVerify"),
  proStatus: document.getElementById("proStatus"),
  save: document.getElementById("save"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status"),
};

const VALIDATED_LOCAL_MODELS = new Set(["gemma-3-12b-it"]);

const DEFAULTS = {
  backend: "vertex",
  gcpProjectId: "",
  vertexBearerToken: "",
  geminiStudioKey: "",
  lmEndpoint: "http://127.0.0.1:1234",
  lmModel: "gemma-3-12b-it",
  mode: "factflag",
  // v0.5.4: default OFF to fit the 5 RPM new-project quota. Re-enable
  // once Vertex quota approves.
  chitchatGate: false,
  // Default to "all" — primary-only is too restrictive for typical
  // YouTube content (most claims don't have peer-reviewed sources) and
  // showed up as "empty cards" for new users. Users can drop to primary
  // themselves via the in-sidebar slider if they want academic rigor.
  sourcePref: "all",
  consensusEnabled: false,
  voiceLlamaEnabled: false,
  voiceGrokEnabled: false,
  voiceClaudeEnabled: false,
  glossary: "",
  // v0.8.0 tier — license is the Stripe customer ID (cus_xxx).
  // proTier ("free"|"premium"|"journalist") + proIsActive (legacy mirror) +
  // proExpiresAt + proValidatedAt are populated by the license-check call;
  // we only remember the license string so users don't re-paste every load.
  proLicense: "",
  proTier: "free",
  proIsActive: false,
  proExpiresAt: null,
  proValidatedAt: 0,
};

// Tier display names — must match the website pricing UI exactly.
const TIER_DISPLAY = {
  free: "Well (f)actually Youtube Sidebar (Free)",
  premium: "Well (f)actually Youtube Sidebar Premium",
  journalist: "Well (f)actually Youtube Sidebar Journalist",
};

// Normalize a stored/fetched state into a tier slug. Falls back to the
// legacy proIsActive bool (→ premium) for profiles saved by v0.7.0.
function resolveTier(s) {
  if (s && (s.proTier === "premium" || s.proTier === "journalist" || s.proTier === "free")) {
    return s.proTier;
  }
  return s && s.proIsActive ? "premium" : "free";
}
// Affiliate / ad-slot defaults are NOT mutable from Options on purpose —
// they're shipped behavior, not user toggles. content.js + affiliate.js
// own the defaults and read them straight from chrome.storage.local
// (which is empty for a fresh install, so the in-code defaults stand).

// Load
chrome.storage.local.get(DEFAULTS, (s) => {
  els.backend.value = s.backend;
  els.gcpProjectId.value = s.gcpProjectId;
  els.vertexBearerToken.value = s.vertexBearerToken;
  els.geminiStudioKey.value = s.geminiStudioKey;
  els.lmEndpoint.value = s.lmEndpoint;
  if (s.lmModel && ![...els.lmModel.options].some(o => o.value === s.lmModel)) {
    els.lmModel.add(new Option(s.lmModel, s.lmModel));
  }
  els.lmModel.value = s.lmModel;
  els.mode.value = s.mode;
  els.chitchatGate.checked = s.chitchatGate;
  els.sourcePref.value = s.sourcePref;
  els.consensusEnabled.checked = s.consensusEnabled;
  els.voiceLlamaEnabled.checked = s.voiceLlamaEnabled;
  els.voiceGrokEnabled.checked = s.voiceGrokEnabled;
  els.voiceClaudeEnabled.checked = s.voiceClaudeEnabled;
  els.glossary.value = s.glossary;
  if (els.proLicense) els.proLicense.value = s.proLicense || "";
  renderProStatus(s);
  refreshBackendSection();
  refreshLmModelBadge();
  refreshConsensusSection();
});

// v0.8.0 tier — render the status line below the license input AND the
// current-plan indicator, then re-gate the UI so each tier only exposes the
// features it's entitled to. Pulls from cached chrome.storage.local state.
function renderProStatus(s) {
  const tier = resolveTier(s);
  // Current-plan indicator (always shows the active tier name).
  if (els.tierIndicator) {
    els.tierIndicator.textContent = TIER_DISPLAY[tier] || TIER_DISPLAY.free;
    els.tierIndicator.dataset.tier = tier;
  }
  applyTierGating(tier);

  if (!els.proStatus) return;
  if (tier !== "free") {
    const label = tier === "journalist" ? "JOURNALIST" : "PREMIUM";
    const expires = s.proExpiresAt
      ? new Date(s.proExpiresAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : null;
    els.proStatus.textContent = expires
      ? `Status: ${label} — renews ${expires}`
      : `Status: ${label} — active`;
    els.proStatus.className = "text-xs text-good";
  } else if (!s.proLicense || !s.proLicense.trim()) {
    els.proStatus.textContent = "Status: Free tier (local-only)";
    els.proStatus.className = "text-xs text-ink-400";
  } else if (s.proValidatedAt) {
    els.proStatus.textContent = "Status: code not active (cancelled or invalid) — on Free tier";
    els.proStatus.className = "text-xs text-warn";
  } else {
    els.proStatus.textContent = "Status: not yet verified — click Verify";
    els.proStatus.className = "text-xs text-ink-400";
  }
}

// applyTierGating — show/lock features per tier in the Options UI.
//   free       → only LM Studio backend usable; Vertex + consensus locked.
//   premium    → LM Studio + Vertex (BYO key) usable; consensus locked.
//   journalist → everything usable (hosted backend handles routing).
// "Locked" = visibly disabled + an explanatory upsell note, not hidden, so
// users understand what each upgrade unlocks.
function applyTierGating(tier) {
  const vertexAllowed = tier === "premium" || tier === "journalist";
  const consensusAllowed = tier === "journalist";

  // Backend dropdown: the cloud/Vertex option is only selectable on a paid
  // tier. On Free we lock the select to LM Studio.
  if (els.backend) {
    const vertexOpt = [...els.backend.options].find((o) => o.value === "vertex");
    if (vertexOpt) {
      vertexOpt.disabled = !vertexAllowed;
      vertexOpt.textContent = vertexAllowed
        ? "Google Cloud Vertex AI (cloud — Gemini, optional second-opinion voices)"
        : "Google Cloud Vertex AI — Premium/Journalist only 🔒";
    }
    if (!vertexAllowed && els.backend.value === "vertex") {
      els.backend.value = "lmstudio";
      refreshBackendSection();
    }
  }
  if (els.tierVertexNote) {
    els.tierVertexNote.classList.toggle("hidden", vertexAllowed);
  }

  // Consensus section: Journalist-only (hosted backend runs the second-opinion
  // voices on our keys). Lock the whole section otherwise.
  if (els.consensusEnabled) els.consensusEnabled.disabled = !consensusAllowed;
  if (els.consensusSection) {
    els.consensusSection.classList.toggle("tier-locked", !consensusAllowed);
  }
  if (els.tierConsensusNote) {
    els.tierConsensusNote.classList.toggle("hidden", consensusAllowed);
  }
}

// Verify button — POST the license to /api/license-check, store the
// result in chrome.storage.local. Same endpoint the extension's
// background uses for the periodic 24h revalidation.
if (els.proVerify) {
  els.proVerify.addEventListener("click", async () => {
    const license = (els.proLicense.value || "").trim();
    if (!license) {
      els.proStatus.textContent = "Paste a license code first.";
      els.proStatus.className = "text-xs text-warn";
      return;
    }
    if (!/^cus_[A-Za-z0-9]+$/.test(license)) {
      els.proStatus.textContent = "Malformed code — should start with cus_";
      els.proStatus.className = "text-xs text-warn";
      return;
    }
    els.proStatus.textContent = "Verifying…";
    els.proStatus.className = "text-xs text-ink-400";
    try {
      const res = await fetch("https://well-factually.com/api/license-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license }),
      });
      const data = await res.json();
      const now = Date.now();
      // Prefer the new `tier` field; fall back to the legacy `pro` bool.
      const tier = (data.tier === "premium" || data.tier === "journalist" || data.tier === "free")
        ? data.tier
        : (data.pro ? "premium" : "free");
      const update = {
        proLicense: license,
        proTier: tier,
        proIsActive: tier !== "free",
        proExpiresAt: data.expires_at || null,
        proValidatedAt: now,
      };
      chrome.storage.local.set(update, () => renderProStatus(update));
    } catch (err) {
      els.proStatus.textContent = "Couldn't reach the verify server. Try again in a moment.";
      els.proStatus.className = "text-xs text-warn";
    }
  });
}

function flash(msg, isErr = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("err", isErr);
  setTimeout(() => { els.status.textContent = ""; els.status.classList.remove("err"); }, 2500);
}

function refreshBackendSection() {
  els.backendVertex.classList.toggle("active", els.backend.value === "vertex");
  els.backendLmstudio.classList.toggle("active", els.backend.value === "lmstudio");
}

function refreshConsensusSection() {
  els.consensusVoicesSection.classList.toggle("disabled", !els.consensusEnabled.checked);
}

function refreshLmModelBadge() {
  const m = els.lmModel.value;
  if (VALIDATED_LOCAL_MODELS.has(m)) {
    els.lmModelBadge.innerHTML = `<span class="pill validated">✓ Validated</span> Benched as the strongest local pick for fact-flag.`;
  } else {
    els.lmModelBadge.innerHTML = `<span class="pill unvalidated">⚠ Unvalidated</span> Not in our bench. May show opener-lock, format leaks, or low fire rate.`;
  }
}

els.backend.addEventListener("change", refreshBackendSection);
els.lmModel.addEventListener("change", refreshLmModelBadge);
els.consensusEnabled.addEventListener("change", refreshConsensusSection);

// Vertex test connection — hits Gemini Flash on the global endpoint with a
// 3-token prompt. Surfaces 401/403/400 with actionable copy. Closes
// smoke-test bug #4 (no live key validation on Save).
els.vertexTest.addEventListener("click", async () => {
  const projectId = els.gcpProjectId.value.trim();
  const token = els.vertexBearerToken.value.trim();
  if (!projectId) {
    els.vertexStatus.textContent = "✕ enter a project ID first";
    els.vertexStatus.classList.add("err");
    return;
  }
  if (!token) {
    els.vertexStatus.textContent = "✕ paste an access token first";
    els.vertexStatus.classList.add("err");
    return;
  }
  els.vertexStatus.textContent = "testing…";
  els.vertexStatus.classList.remove("err");
  const url = `https://aiplatform.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}/locations/global/endpoints/openapi/chat/completions`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: "Reply with ONLY the word: ok" }],
        max_tokens: 5,
        temperature: 0.0,
        extra_body: { google: { thinking_config: { thinking_budget: 0 } } },
      }),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 200);
      let hint = "";
      if (r.status === 401) hint = "access token expired or invalid — refresh with `gcloud auth print-access-token`";
      else if (r.status === 403) hint = "project lacks Vertex AI access, or Generative Language API not enabled";
      else if (r.status === 400) hint = body;
      throw new Error(`HTTP ${r.status} — ${hint || body}`);
    }
    const d = await r.json();
    const txt = (d.choices?.[0]?.message?.content || "").trim();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    els.vertexStatus.textContent = `✓ reachable, ${dt}s — replied: "${txt.slice(0, 30)}"`;
  } catch (e) {
    els.vertexStatus.textContent = `✕ ${String(e.message || e).slice(0, 160)}`;
    els.vertexStatus.classList.add("err");
  }
});

els.lmDiscover.addEventListener("click", async () => {
  const endpoint = (els.lmEndpoint.value || DEFAULTS.lmEndpoint).replace(/\/$/, "");
  els.lmStatus.textContent = "discovering…";
  els.lmStatus.classList.remove("err");
  try {
    const r = await fetch(endpoint + "/v1/models", { method: "GET" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const ids = (d.data || []).map(m => m.id).filter(Boolean);
    if (!ids.length) throw new Error("no models found");
    const current = els.lmModel.value;
    els.lmModel.innerHTML = "";
    for (const id of ids) els.lmModel.add(new Option(id, id));
    if (ids.includes(current)) els.lmModel.value = current;
    else if (ids.includes("gemma-3-12b-it")) els.lmModel.value = "gemma-3-12b-it";
    refreshLmModelBadge();
    els.lmStatus.textContent = `✓ found ${ids.length} models`;
  } catch (e) {
    els.lmStatus.textContent = `✕ ${e.message}`;
    els.lmStatus.classList.add("err");
  }
});

els.lmTest.addEventListener("click", async () => {
  const endpoint = (els.lmEndpoint.value || DEFAULTS.lmEndpoint).replace(/\/$/, "");
  const model = els.lmModel.value;
  els.lmStatus.textContent = "testing…";
  els.lmStatus.classList.remove("err");
  const t0 = Date.now();
  try {
    const r = await fetch(endpoint + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with ONLY the word: ok" }],
        max_tokens: 8,
        temperature: 0.0,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const txt = (d.choices?.[0]?.message?.content || "").trim();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    els.lmStatus.textContent = `✓ reachable, ${dt}s — replied: "${txt.slice(0, 30)}"`;
  } catch (e) {
    els.lmStatus.textContent = `✕ ${e.message} — is LM Studio's server started on this port?`;
    els.lmStatus.classList.add("err");
  }
});

els.save.addEventListener("click", () => {
  const projectId = els.gcpProjectId.value.trim();
  const token = els.vertexBearerToken.value.trim();
  if (els.backend.value === "vertex") {
    if (!projectId) {
      flash("Enter a GCP Project ID for the Vertex backend", true);
      return;
    }
    if (!token) {
      flash("Paste an access token (gcloud auth print-access-token)", true);
      return;
    }
  }
  chrome.storage.local.set(
    {
      backend: els.backend.value,
      gcpProjectId: projectId,
      vertexBearerToken: token,
      geminiStudioKey: els.geminiStudioKey.value.trim(),
      lmEndpoint: els.lmEndpoint.value.trim() || DEFAULTS.lmEndpoint,
      lmModel: els.lmModel.value,
      mode: els.mode.value,
      chitchatGate: els.chitchatGate.checked,
      sourcePref: els.sourcePref.value,
      consensusEnabled: els.consensusEnabled.checked,
      voiceLlamaEnabled: els.voiceLlamaEnabled.checked,
      voiceGrokEnabled: els.voiceGrokEnabled.checked,
      voiceClaudeEnabled: els.voiceClaudeEnabled.checked,
      glossary: els.glossary.value,
      // v0.7.0: persist the license string. proIsActive / proExpiresAt /
      // proValidatedAt are NOT written here — they're owned by the Verify
      // button + background's periodic revalidation. Save just remembers
      // the code so the user doesn't have to re-paste.
      proLicense: (els.proLicense && els.proLicense.value.trim()) || "",
    },
    () => flash("Saved ✓"),
  );
});

els.clear.addEventListener("click", () => {
  if (!confirm("Clear your Vertex AI access token from this extension?")) return;
  chrome.storage.local.set({ vertexBearerToken: "" }, () => {
    els.vertexBearerToken.value = "";
    flash("Token cleared");
  });
});

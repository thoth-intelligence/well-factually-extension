const els = {
  backend: document.getElementById("backend"),
  backendAnthropic: document.getElementById("backend-anthropic"),
  backendLmstudio: document.getElementById("backend-lmstudio"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
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
  openaiKey: document.getElementById("openaiKey"),
  openaiModel: document.getElementById("openaiModel"),
  geminiKey: document.getElementById("geminiKey"),
  geminiModel: document.getElementById("geminiModel"),
  glossary: document.getElementById("glossary"),
  save: document.getElementById("save"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status"),
};

const VALIDATED_LOCAL_MODELS = new Set(["gemma-3-12b-it"]);

const DEFAULTS = {
  backend: "anthropic",
  apiKey: "",
  model: "claude-haiku-4-5",
  lmEndpoint: "http://127.0.0.1:1234",
  lmModel: "gemma-3-12b-it",
  mode: "factflag",
  chitchatGate: true,
  sourcePref: "primary",
  consensusEnabled: false,
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
  glossary: "",
};

// Load
chrome.storage.local.get(DEFAULTS, (s) => {
  els.backend.value = s.backend;
  els.apiKey.value = s.apiKey;
  els.model.value = s.model;
  els.lmEndpoint.value = s.lmEndpoint;
  // Populate the local model dropdown with the saved value
  if (s.lmModel && ![...els.lmModel.options].some(o => o.value === s.lmModel)) {
    els.lmModel.add(new Option(s.lmModel, s.lmModel));
  }
  els.lmModel.value = s.lmModel;
  els.mode.value = s.mode;
  els.chitchatGate.checked = s.chitchatGate;
  els.sourcePref.value = s.sourcePref;
  els.consensusEnabled.checked = s.consensusEnabled;
  els.openaiKey.value = s.openaiKey;
  // Allow user to keep a value not in the static dropdown (newer model release)
  if (s.openaiModel && ![...els.openaiModel.options].some(o => o.value === s.openaiModel)) {
    els.openaiModel.add(new Option(s.openaiModel, s.openaiModel));
  }
  els.openaiModel.value = s.openaiModel;
  els.geminiKey.value = s.geminiKey;
  if (s.geminiModel && ![...els.geminiModel.options].some(o => o.value === s.geminiModel)) {
    els.geminiModel.add(new Option(s.geminiModel, s.geminiModel));
  }
  els.geminiModel.value = s.geminiModel;
  els.glossary.value = s.glossary;
  refreshBackendSection();
  refreshLmModelBadge();
});

function flash(msg, isErr = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("err", isErr);
  setTimeout(() => { els.status.textContent = ""; els.status.classList.remove("err"); }, 2500);
}

function refreshBackendSection() {
  els.backendAnthropic.classList.toggle("active", els.backend.value === "anthropic");
  els.backendLmstudio.classList.toggle("active", els.backend.value === "lmstudio");
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
    // Try to keep the previous selection, else default to gemma if present, else first.
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
  const key = els.apiKey.value.trim();
  if (els.backend.value === "anthropic" && key && !key.startsWith("sk-ant-")) {
    flash("Anthropic keys start with sk-ant-", true);
    return;
  }
  chrome.storage.local.set(
    {
      backend: els.backend.value,
      apiKey: key,
      model: els.model.value,
      lmEndpoint: els.lmEndpoint.value.trim() || DEFAULTS.lmEndpoint,
      lmModel: els.lmModel.value,
      mode: els.mode.value,
      chitchatGate: els.chitchatGate.checked,
      sourcePref: els.sourcePref.value,
      consensusEnabled: els.consensusEnabled.checked,
      openaiKey: els.openaiKey.value.trim(),
      openaiModel: els.openaiModel.value,
      geminiKey: els.geminiKey.value.trim(),
      geminiModel: els.geminiModel.value,
      glossary: els.glossary.value,
    },
    () => flash("Saved ✓"),
  );
});

els.clear.addEventListener("click", () => {
  if (!confirm("Clear your API key from this extension?")) return;
  chrome.storage.local.set({ apiKey: "" }, () => {
    els.apiKey.value = "";
    flash("API key cleared");
  });
});

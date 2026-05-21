// Service worker: receives caption updates from content scripts, buffers windows,
// calls Anthropic Messages API directly (allowed via host_permissions), returns
// fact-flag cards. One per tab — state keyed by tabId.

import { MODE_PROMPTS, MODE_TAGS, CHITCHAT_SYS, ANTI_RESTATE_KEEP,
         buildPreamble, buildUserMsg } from "./prompts.js";
import { postProcess } from "./format_guard.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CONTEXT_WINDOW_S = 60;
const COMMENT_EVERY_S = 18;
const NEW_LINES_WINDOW_S = 14;

// Models that didn't escape qwen-family format/opener-lock in our bench.
// Keep the format-guard tight when one of these is selected.
const STRICT_GUARD_MODELS = new Set([
  // Add specific local model ids here as we bench them; for now any
  // non-validated model could exhibit qwen-family quirks.
]);

const tabState = new Map();

function getState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      lines: [],            // {t, s, x} — captions accumulated so far
      lastCommentT: -999,   // last cue at which we fired
      inFlight: false,
      recentByMode: { question: [], missing: [], factflag: [], summary: [] },
    });
  }
  return tabState.get(tabId);
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        backend: "anthropic",
        apiKey: "",
        model: "claude-haiku-4-5",
        lmEndpoint: "http://127.0.0.1:1234",
        lmModel: "gemma-3-12b-it",
        mode: "factflag",
        glossary: "",
        chitchatGate: true,
        sourcePref: "primary",
        consensusEnabled: false,
        openaiKey: "",
        openaiModel: "gpt-4o-mini",
        geminiKey: "",
        geminiModel: "gemini-2.5-flash",
      },
      resolve,
    );
  });
}

async function callAnthropic({ apiKey, model, system, user, maxTokens = 220, temperature = 0.4 }) {
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Anthropic HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return (d.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Citation source profiles — Feature 5 (2026-05-14, bias-balanced sourcing).
// The "primary" profile preserves the v6 behavior exactly so users who don't
// touch the new Options dropdown see no change. The other four profiles let
// the user opt in to a specific editorial alignment — the contest pitch is
// "we don't impose a single editorial line, the user picks their lens" — so
// the partisan profiles are by design, not a bug. Across all profiles we
// keep the news-desk-over-opinion guardrail so an outlet's reporting is
// preferred over its editorial page (matters especially for WSJ and NYT).
const CITATION_PROFILES = {
  primary:
`Prefer primary and reference sources: government statistics agencies (BLS, Census, CDC, ONS, Eurostat), peer-reviewed academic journals (PubMed, JSTOR, arXiv), original reporting by news wires (Reuters, AP, AFP), established encyclopedias and reference works. Avoid opinion pieces, partisan magazines, blog posts, and aggregator sites.`,
  centrist:
`Prefer sources with a reputation for centrist or independent editorial stance: Reuters, AP, BBC News, The Economist, Bloomberg, Christian Science Monitor, NPR News (news desk, not opinion). Also acceptable: government statistics agencies, peer-reviewed journals, and established reference works. Avoid sources commonly rated as strongly left-leaning or right-leaning.`,
  left:
`The user has indicated they trust left-leaning mainstream sources. Prefer: The New York Times, The Washington Post, The Guardian, NPR, The Atlantic, ProPublica, Mother Jones, Vox, MSNBC reporting. Also acceptable: government statistics agencies, peer-reviewed journals, and established reference works. Avoid right-leaning outlets (Fox News, Washington Examiner, Daily Wire, Breitbart, The Federalist).`,
  right:
`The user has indicated they trust right-leaning mainstream sources. Prefer: The Wall Street Journal (news desk), National Review, Washington Examiner, Fox News (reporting), The Dispatch, The Free Press, RealClearPolitics. Also acceptable: government statistics agencies, peer-reviewed journals, and established reference works. Avoid left-leaning outlets (MSNBC, Mother Jones, HuffPost, Vox, Slate).`,
  all:
`Any reputable source is acceptable: news organizations from any reasonable editorial perspective, encyclopedias, government data, academic journals, and named subject-matter analysts. Only avoid outright unreliable sources (anonymous-author blog posts, content farms, sites with a documented history of fabrication or hoax content).`,
};

function buildCitationSystemPrompt(sourcePref) {
  const profile = CITATION_PROFILES[sourcePref] || CITATION_PROFILES.primary;
  return `You verify factual claims for a real-time YouTube fact-checker. Use web_search to find ONE authoritative source for the given fact-check note.

Source preference for this user:
${profile}

Across all profiles: prefer reporting/news-desk content over opinion or editorial sections of the same outlet. Avoid pseudo-news content farms regardless of political alignment.

After searching, output EXACTLY one JSON object as your last content (and nothing else):
{"url":"https://...","title":"page title","excerpt":"one-sentence summary of what the source says about the note"}

If no authoritative source within the preferred profile is found, output exactly: NONE`;
}

// retrieveCitation — Feature 3 (2026-05-14): for each non-SKIP factflag, fire a
// separate Anthropic call with the native web_search tool to find one
// authoritative source. Async / fire-and-forget so the main card lands first
// and the citation slots in 3-8 seconds later. Failures silently return null —
// card simply renders without a source rather than showing an error.
// 2026-05-14 (Feature 5): system prompt now profile-aware via sourcePref.
async function retrieveCitation({ apiKey, model, flagText, sourcePref }) {
  const sys = buildCitationSystemPrompt(sourcePref);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        temperature: 0.0,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        system: sys,
        messages: [{ role: "user", content: `Fact-check note:\n${flagText}` }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = (d.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const jsonMatch = text.match(/\{[^{}]*"url"\s*:[^{}]*"excerpt"\s*:[^{}]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.url || !/^https?:\/\//i.test(parsed.url)) return null;
    return {
      url: String(parsed.url),
      title: String(parsed.title || parsed.url).slice(0, 120),
      excerpt: String(parsed.excerpt || "").slice(0, 240),
    };
  } catch (e) {
    return null;
  }
}

// fetchDossier — Feature 4 (2026-05-14): pre-roll briefing. Triggered once
// per YouTube watch-page load by the content script, with the video metadata
// (title, channel, description, view count, upload date) it scraped from the
// DOM. Returns a one-paragraph briefing the content script renders as the
// very first card, before captions arrive. Force-Haiku on Anthropic (~$0.0005
// per call) since this is a low-stakes framing pass. Silently returns null on
// missing key, model-returns-NONE, or any error — no error card for the
// pre-roll since it would compete with the actual fact-check stream.
async function fetchDossier(meta) {
  const settings = await getSettings();
  if (settings.backend === "anthropic" && !settings.apiKey) return null;
  if (!meta || (!meta.title && !meta.description)) return null;

  const sys =
`You are a careful media analyst introducing a YouTube video to a viewer who is about to watch it. Based ONLY on the metadata provided (title, channel name, description, view count, upload date), write a single concise paragraph that:
1. Names the topic and who is speaking in one clause.
2. Identifies two to four specific things a careful viewer should listen for or be skeptical of — controversial claims, unverified statistics, common-myth territory, contested framings. Be concrete, not generic.
3. Stays grounded in what the metadata actually says. Do NOT invent biographical facts about the speaker. If their track record is unclear from the description, omit that angle rather than guessing.

Tone: neutral, calibrated, like a competent producer briefing the host. Plain prose, no lists, no bold, no headings. ≤120 words. Do not include preamble or sign-off.

If the metadata is too thin to write anything useful (e.g. empty description and uninformative title), output exactly: NONE`;

  const desc = (meta.description || "").slice(0, 2000);
  const user =
`Title: ${meta.title || "(not available)"}
Channel: ${meta.channel || "(not available)"}
Upload date: ${meta.uploadDate || "(not available)"}
Views: ${meta.viewCount || "(not available)"}

Description:
"""
${desc || "(no description provided)"}
"""

Briefing:`;

  try {
    const raw = await callBackend({
      settings,
      overrideModel: settings.backend === "anthropic" ? "claude-haiku-4-5" : undefined,
      system: sys,
      user,
      maxTokens: 320,
      temperature: 0.4,
    });
    const trimmed = (raw || "").trim();
    if (!trimmed || /^NONE\.?$/i.test(trimmed)) return null;
    return trimmed.slice(0, 1200);
  } catch (_e) {
    return null;
  }
}

async function callLmStudio({ endpoint, model, system, user, maxTokens = 220, temperature = 0.4 }) {
  const url = endpoint.replace(/\/$/, "") + "/v1/chat/completions";
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`LM Studio HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return (d.choices?.[0]?.message?.content || "").trim();
}

// callOpenAI / callGemini — Feature 6 (2026-05-14, cross-model consensus).
// Both are direct calls (no streaming, no tools) used only by consensusCheck
// below. They mirror callAnthropic / callLmStudio's signature so they can
// share the same prompt-building code; errors propagate to the caller, which
// treats failures as "this leg unavailable" rather than as user-facing errors.
async function callOpenAI({ apiKey, model, system, user, maxTokens = 220, temperature = 0.4 }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`OpenAI HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return (d.choices?.[0]?.message?.content || "").trim();
}

async function callGemini({ apiKey, model, system, user, maxTokens = 220, temperature = 0.4 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Gemini HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// consensusCheck — Feature 6 (2026-05-14): cross-model agreement check for
// high-confidence Claude flags. Triggered only on conf 4–5 to control cost
// (~$0.005 per podcast hour when both secondaries are configured). Fans the
// SAME factflag system prompt and user message out to one or both secondaries
// in parallel, runs each response through the shared postProcess parser, and
// returns a small badge + per-model breakdown. A secondary's "AGREE" signal
// is simply "didn't return SKIP" — generous on purpose, since a non-Claude
// model may not match the [N] prefix format but its non-SKIP output still
// counts as engagement with the claim. Network errors on one leg don't
// tank the other: they downgrade to a per-leg "error" entry in details.
// Returns null when no secondaries are configured (feature is silently off).
async function consensusCheck({ settings, sysPrompt, userMsg }) {
  const calls = [];
  if (settings.openaiKey && settings.openaiModel) {
    calls.push(
      callOpenAI({
        apiKey: settings.openaiKey,
        model: settings.openaiModel,
        system: sysPrompt,
        user: userMsg,
        maxTokens: 220,
        temperature: 0.4,
      })
        .then((raw) => ({ model: settings.openaiModel, vendor: "openai", parsed: postProcess(raw) }))
        .catch((e) => ({ model: settings.openaiModel, vendor: "openai", error: String(e.message || e).slice(0, 160) })),
    );
  }
  if (settings.geminiKey && settings.geminiModel) {
    calls.push(
      callGemini({
        apiKey: settings.geminiKey,
        model: settings.geminiModel,
        system: sysPrompt,
        user: userMsg,
        maxTokens: 220,
        temperature: 0.4,
      })
        .then((raw) => ({ model: settings.geminiModel, vendor: "gemini", parsed: postProcess(raw) }))
        .catch((e) => ({ model: settings.geminiModel, vendor: "gemini", error: String(e.message || e).slice(0, 160) })),
    );
  }
  if (calls.length === 0) return null;
  const results = await Promise.all(calls);

  // Tally: how many of the legs flagged (parsed.isSkip == false)?
  let agreed = 0;
  let usable = 0;
  const details = [];
  for (const r of results) {
    if (r.error) {
      details.push({ model: r.model, vendor: r.vendor, status: "error", error: r.error });
      continue;
    }
    usable++;
    const isFlagged = r.parsed && !r.parsed.isSkip;
    if (isFlagged) agreed++;
    details.push({
      model: r.model,
      vendor: r.vendor,
      status: isFlagged ? "agree" : "disagree",
      confidence: r.parsed?.confidence ?? null,
      text: (r.parsed?.text || "").slice(0, 200),
    });
  }
  if (usable === 0) return null; // every leg errored — surface nothing

  // Badge logic. Claude is always in the "agree" camp here (consensusCheck
  // only fires after Claude already produced a conf-4-or-5 flag), so the
  // total population is `usable + 1` and the agreed count is `agreed + 1`.
  const totalVotes = usable + 1;
  const totalAgree = agreed + 1;
  let badge;
  let level; // strong | partial | weak — drives the CSS class
  if (totalAgree === totalVotes) {
    badge = totalVotes === 3 ? "✓✓✓" : "✓✓";
    level = "strong";
  } else if (totalAgree > totalVotes / 2) {
    badge = "✓✓";
    level = "partial";
  } else {
    badge = "⚠";
    level = "weak";
  }
  return { badge, level, agreed: totalAgree, total: totalVotes, details };
}

// Backend-agnostic call dispatcher
async function callBackend({ settings, system, user, maxTokens, temperature, overrideModel }) {
  if (settings.backend === "lmstudio") {
    return callLmStudio({
      endpoint: settings.lmEndpoint,
      model: overrideModel || settings.lmModel,
      system, user, maxTokens, temperature,
    });
  }
  return callAnthropic({
    apiKey: settings.apiKey,
    model: overrideModel || settings.model,
    system, user, maxTokens, temperature,
  });
}

async function processTick(tabId) {
  const state = getState(tabId);
  if (state.inFlight) return;
  if (state.lines.length === 0) return;

  // Use the video's current playhead time as "now". The content script sends
  // it along with every caption update.
  const now = state.currentTime ?? state.lines[state.lines.length - 1].t;
  if (now - state.lastCommentT < COMMENT_EVERY_S) return;

  const minT = now - CONTEXT_WINDOW_S;
  const window = state.lines.filter((l) => l.t >= minT && l.t <= now);
  const newLines = window.filter((l) => l.t > now - NEW_LINES_WINDOW_S);
  // Need at least one fresh caption line in the last NEW_LINES_WINDOW_S seconds.
  // Tightened from `< 2` (2026-05-14) — was killing most fires on slow-paced
  // content where caption text changes once every 5-10s.
  if (newLines.length < 1) return;

  const settings = await getSettings();
  if (settings.backend === "anthropic" && !settings.apiKey) {
    sendCard(tabId, {
      kind: "error",
      text: "No Anthropic API key set. Open the extension options to add one — or switch backend to LM Studio.",
    });
    state.lastCommentT = now;
    return;
  }

  state.inFlight = true;
  state.lastCommentT = now;

  try {
    const preamble = buildPreamble({}, settings.glossary);

    // Optional chitchat gate — saves backend calls on digressions but doubles them
    // when on-topic. Default ON. Always uses the same backend as the mode call
    // (Haiku for Anthropic, local model for LM Studio).
    if (settings.chitchatGate) {
      const segText = window
        .map((l) => `[${fmtCue(l.t)}] ${l.s ? l.s + ": " : ""}${l.x}`)
        .join("\n");
      const gateRaw = await callBackend({
        settings,
        // Force Haiku for the gate when on Anthropic (cheap); LM Studio uses
        // whatever model is configured.
        overrideModel: settings.backend === "anthropic" ? "claude-haiku-4-5" : undefined,
        system: preamble + CHITCHAT_SYS,
        user: `Segment:\n"""\n${segText}\n"""\n\nOne word:`,
        maxTokens: 5,
        temperature: 0.0,
      });
      if (!/ONTOPIC/i.test(gateRaw) && /DIGRESSION/i.test(gateRaw)) {
        sendCard(tabId, { kind: "gated", cue: now });
        return;
      }
    }

    // Mode call
    const mode = settings.mode;
    const sysPrompt = MODE_PROMPTS[mode](preamble);
    const keep = ANTI_RESTATE_KEEP[mode] ?? 2;
    const recent = state.recentByMode[mode].slice(-keep);
    const userMsg = buildUserMsg(window, newLines, recent);

    const t0 = Date.now();
    const raw = await callBackend({
      settings,
      system: sysPrompt,
      user: userMsg,
    });
    const elapsedMs = Date.now() - t0;

    const cleaned = postProcess(raw);
    if (cleaned.isSkip) {
      sendCard(tabId, { kind: "skip", cue: now });
      return;
    }
    state.recentByMode[mode].push(cleaned.text);
    if (state.recentByMode[mode].length > 12) state.recentByMode[mode].shift();
    sendCard(tabId, {
      kind: "comment",
      cue: now,
      tag: MODE_TAGS[mode],
      text: cleaned.text,
      confidence: cleaned.confidence,
      elapsedMs,
    });
    // Async citation lookup (Anthropic backend only — web_search is native).
    // Fire-and-forget: card already appeared above, citation arrives later.
    if (settings.backend === "anthropic" && settings.apiKey) {
      retrieveCitation({
        apiKey: settings.apiKey,
        model: "claude-haiku-4-5",
        flagText: cleaned.text,
        sourcePref: settings.sourcePref,
      })
        .then((citation) => {
          if (citation) sendCard(tabId, { kind: "citation", cue: now, citation });
        })
        .catch(() => { /* swallow — no citation, no problem */ });
    }
    // Async cross-model consensus check (Feature 6) — only on the high-stakes
    // tier (conf 4 or 5). Same fan-out / fire-and-forget pattern as citation.
    // No-ops if consensus is disabled or no secondary key is configured.
    if (
      settings.consensusEnabled &&
      cleaned.confidence != null &&
      cleaned.confidence >= 4 &&
      (settings.openaiKey || settings.geminiKey)
    ) {
      consensusCheck({ settings, sysPrompt, userMsg })
        .then((consensus) => {
          if (consensus) sendCard(tabId, { kind: "consensus", cue: now, ...consensus });
        })
        .catch(() => { /* swallow — no badge is the right failure mode */ });
    }
  } catch (e) {
    sendCard(tabId, { kind: "error", cue: now, text: String(e.message || e).slice(0, 200) });
  } finally {
    state.inFlight = false;
  }
}

function sendCard(tabId, payload) {
  chrome.tabs.sendMessage(tabId, { type: "CARD", ...payload }).catch(() => { /* tab closed */ });
}

function fmtCue(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (msg.type === "CAPTION_LINE") {
    const state = getState(tabId);
    // Dedupe by exact (t, x) — YouTube re-emits caption text on re-render
    const last = state.lines[state.lines.length - 1];
    if (!last || last.x !== msg.line.x || Math.abs(last.t - msg.line.t) > 0.5) {
      state.lines.push(msg.line);
    }
    state.currentTime = msg.currentTime;
    processTick(tabId);
    sendResponse({ ok: true });
  } else if (msg.type === "RESET") {
    tabState.delete(tabId);
    sendResponse({ ok: true });
  } else if (msg.type === "GET_STATE") {
    const s = getState(tabId);
    sendResponse({ lineCount: s.lines.length, currentTime: s.currentTime });
  } else if (msg.type === "DOSSIER_REQUEST") {
    // Fire-and-forget: content script gets a card only on success. Failures
    // (no key, NONE response, network error) silently drop — see fetchDossier.
    fetchDossier(msg.meta).then((text) => {
      if (text) sendCard(tabId, { kind: "dossier", text, meta: msg.meta });
    });
    sendResponse({ ok: true });
  }
  return true;
});

// Keep service worker alive while a tab has active state (MV3 30s idle kill).
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { /* no-op heartbeat */ });

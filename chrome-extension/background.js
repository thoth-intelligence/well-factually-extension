// Service worker for v9.5-Gemini-Grok-Llama (+ Claude per 2026-05-21 addendum).
//
// Receives caption updates from content scripts, buffers windows, and dispatches
// to Vertex AI's OpenAI-compatible chat/completions endpoint. Gemini Flash
// (global) drives the primary classifier / chitchat gate / citation; Gemini
// Pro (global) drives the pre-roll dossier. On confidence-4/5 flags, fans
// out to Llama (global), Grok (global), and Claude Haiku (global) in parallel
// for a cross-vendor consensus badge — Llama + Grok + Claude are opt-in via
// per-voice toggles. Local-mode preserved via LM Studio.
//
// One service-worker state per tab — state keyed by tabId. All cloud calls
// route through vertex.js (callVertex(role, messages, opts)); model swaps
// live in MODEL_REGISTRY, not here.

import { MODE_PROMPTS, MODE_TAGS, CHITCHAT_SYS, ANTI_RESTATE_KEEP,
         buildPreamble, buildUserMsg } from "./prompts.js";
import { postProcess, parseConsensusVerdict } from "./format_guard.js";
import { callVertex, extractText, toMessages, withTimeout } from "./vertex.js";

const CONTEXT_WINDOW_S = 60;
const COMMENT_EVERY_S = 18;
const NEW_LINES_WINDOW_S = 14;
const CONSENSUS_TIMEOUT_MS = 4000;
const CLAUDE_429_BACKOFF_MS = 500;

const tabState = new Map();

function getState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      lines: [],
      lastCommentT: -999,
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
        backend: "vertex",
        gcpProjectId: "",
        vertexBearerToken: "",
        lmEndpoint: "http://127.0.0.1:1234",
        lmModel: "gemma-3-12b-it",
        mode: "factflag",
        glossary: "",
        chitchatGate: true,
        sourcePref: "primary",
        consensusEnabled: false,
        voiceLlamaEnabled: false,
        voiceGrokEnabled: false,
        voiceClaudeEnabled: false,
      },
      resolve,
    );
  });
}

// Citation source profiles — bias-balanced sourcing kept from v9. Same five
// profiles drive the prompt sent to the citation model. The grounding
// strategy changed (Anthropic web_search → Gemini's Google Search grounding
// via the OpenAI-compat `tools` field), but the editorial-stance affordance
// is preserved end-to-end.
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
  return `You verify factual claims for a real-time YouTube fact-checker. Use Google Search to find ONE authoritative source for the given fact-check note.

Source preference for this user:
${profile}

Across all profiles: prefer reporting/news-desk content over opinion or editorial sections of the same outlet. Avoid pseudo-news content farms regardless of political alignment.

After searching, output EXACTLY one JSON object as your last content (and nothing else), with no markdown fences:
{"url":"https://...","title":"page title","excerpt":"one-sentence summary of what the source says about the note"}

If no authoritative source within the preferred profile is found, output exactly: NONE`;
}

// retrieveCitation — best-effort citation through Gemini Flash with the
// Google Search grounding tool. v9 used Anthropic's web_search_20250305; that
// vendor is no longer wired in. The OpenAI-compat surface accepts a
// `tools: [{"googleSearch": {}}]` field per Gemini's native grounding
// behavior. If grounding does not return a usable URL the function returns
// null and the card renders without a source — the existing graceful-
// degradation path from v9 is preserved.
async function retrieveCitation({ flagText, sourcePref }) {
  const sys = buildCitationSystemPrompt(sourcePref);
  try {
    const resp = await callVertex(
      "citation",
      toMessages(sys, `Fact-check note:\n${flagText}`),
      {
        maxTokens: 500,
        temperature: 0.0,
        tools: [{ googleSearch: {} }],
      },
    );
    const text = extractText(resp);
    if (!text || /^NONE\.?$/i.test(text.trim())) return null;
    const jsonMatch = text.match(/\{[^{}]*"url"\s*:[^{}]*"excerpt"\s*:[^{}]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.url || !/^https?:\/\//i.test(parsed.url)) return null;
    return {
      url: String(parsed.url),
      title: String(parsed.title || parsed.url).slice(0, 120),
      excerpt: String(parsed.excerpt || "").slice(0, 240),
    };
  } catch (_e) {
    return null;
  }
}

// fetchDossier — pre-roll briefing. Triggered once per YouTube watch-page
// load with scraped metadata. Returns a one-paragraph briefing for the very
// first card. v9.5: now routed through Gemini Pro (dossier role) for the
// sharper-than-Flash framing pass. Thinking enabled — pre-roll is
// latency-tolerant. LM-Studio path intentionally not implemented (local mode
// is for caption fact-flagging; dossier is a cloud-only nicety).
async function fetchDossier(meta) {
  const settings = await getSettings();
  if (settings.backend !== "vertex") return null;
  if (!settings.gcpProjectId || !settings.vertexBearerToken) return null;
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
    const resp = await callVertex("dossier", toMessages(sys, user), {
      maxTokens: 320,
      temperature: 0.4,
    });
    const raw = extractText(resp);
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

// callBackend — backend-agnostic dispatcher for the main classifier / chitchat
// path. Vertex routes through callVertex (role-keyed). LM Studio runs the
// single configured local model for every role. The role argument is ignored
// on the LM Studio path — one local model serves every role there.
async function callBackend({ settings, role, system, user, maxTokens, temperature }) {
  if (settings.backend === "lmstudio") {
    return callLmStudio({
      endpoint: settings.lmEndpoint,
      model: settings.lmModel,
      system, user, maxTokens, temperature,
    });
  }
  const resp = await callVertex(role, toMessages(system, user), { maxTokens, temperature });
  return extractText(resp);
}

// callConsensusVoice — wraps callVertex with the addendum's Claude-specific
// 429 retry-once policy. Other voices (Llama, Grok) just call through. We
// retry only on HTTP 429 (rate-limit) and only once; everything else
// propagates to the caller's catch in runConsensus, where the voice is
// silently dropped from the tally. The 400 "model not available" case (which
// the addendum says may surface for Sonnet) naturally falls through to the
// silent-drop path — no special handling required because we never surface
// the error to the user.
async function callConsensusVoice(role, messages, controller) {
  const opts = { maxTokens: 50, temperature: 0.0, signal: controller.signal };
  try {
    return await callVertex(role, messages, opts);
  } catch (e) {
    const msg = String(e.message || e);
    if (role === "consensus-claude" && /HTTP 429/.test(msg)) {
      await new Promise((r) => setTimeout(r, CLAUDE_429_BACKOFF_MS));
      return await callVertex(role, messages, opts);
    }
    throw e;
  }
}

// buildConsensusMessages — inlined per project convention (new feature
// prompts live at their callsite). Vendor-neutral: the same prompt goes to
// Llama, Grok, and Claude. Few-shot examples are included because Llama and
// Grok need them to hit format reliably (spec §7).
function buildConsensusMessages(primaryFlag, segmentText) {
  const sys =
`You are an independent fact-check consensus voice. Another classifier has flagged the claim below. Decide whether you AGREE the claim is suspicious for the reasons given, or DISAGREE.

Respond with a single JSON object and nothing else. Do not explain your reasoning. Do not use markdown fences. Do not add commentary.

Schema: {"verdict":"agree"|"disagree"}

Examples:
Input claim: "Speaker says GDP grew 3% in 2019 but real growth was closer to 2.3%."
Output: {"verdict":"agree"}

Input claim: "The Titanic's 'unsinkable' marketing claim is a popular myth — White Star never used the word officially."
Output: {"verdict":"agree"}

Input claim: "Speaker says the sky is blue."
Output: {"verdict":"disagree"}`;

  const user =
`Claim being flagged:
"""
${primaryFlag.text}
"""

Recent caption context (last ~60s of the video):
"""
${segmentText}
"""

Reply with the JSON verdict only.`;

  return toMessages(sys, user);
}

// runConsensus — fires enabled consensus voices in parallel on conf-4/5
// flags only. Each voice has a 4s timeout; timeouts and errors are silent
// no-votes (the addendum is explicit: never surface a Claude throttle).
// The primary Gemini flag counts as voice 1 (verdict="agree" by construction
// — the flag exists, so Gemini agrees with itself). Llama, Grok, and Claude
// are voices 2-4 if enabled. Aggregation: strict majority of voices must
// vote "agree" for a badge to render. See aggregateConsensus.
async function runConsensus({ tabId, cue, primaryFlag, segmentText, settings }) {
  if (!settings.consensusEnabled) return;
  if (primaryFlag.confidence == null || primaryFlag.confidence < 4) return;
  if (!settings.voiceLlamaEnabled && !settings.voiceGrokEnabled && !settings.voiceClaudeEnabled) return;

  const messages = buildConsensusMessages(primaryFlag, segmentText);
  const voices = [{ vendor: "google", verdict: "agree" }];   // Gemini = primary
  const details = [];

  function fireVoice(role, vendor, modelLabel) {
    const c = new AbortController();
    return withTimeout(callConsensusVoice(role, messages, c), CONSENSUS_TIMEOUT_MS, c)
      .then((resp) => {
        const raw = extractText(resp);
        const v = parseConsensusVerdict(raw);
        if (v.verdict) {
          voices.push({ vendor, verdict: v.verdict });
          details.push({ vendor, status: v.verdict === "agree" ? "agree" : "disagree", model: modelLabel });
        } else {
          details.push({ vendor, status: "error", error: "unparseable verdict", model: modelLabel });
        }
      })
      .catch((e) => {
        // Silent no-vote. The error is captured in details for the badge
        // tooltip / session export, but never surfaced as a user-facing card.
        details.push({
          vendor,
          status: "error",
          error: String(e.message || e).slice(0, 160),
          model: modelLabel,
        });
      });
  }

  const tasks = [];
  if (settings.voiceLlamaEnabled)  tasks.push(fireVoice("consensus-llama",  "meta",      "llama-4-maverick"));
  if (settings.voiceGrokEnabled)   tasks.push(fireVoice("consensus-grok",   "xai",       "grok-4.1-fast-reasoning"));
  if (settings.voiceClaudeEnabled) tasks.push(fireVoice("consensus-claude", "anthropic", "claude-haiku-4-5"));

  await Promise.allSettled(tasks);

  const aggregate = aggregateConsensus(voices);
  if (aggregate.verdict !== "agree") return;   // split / inconclusive → no badge

  // Build the card payload in the shape content.js's existing attachConsensus
  // expects. agreedCount = how many voices ultimately voted to flag; total =
  // how many voices returned a parseable verdict (errors don't count).
  const totalVotes = voices.length;
  const agreedCount = voices.filter((v) => v.verdict === "agree").length;
  let badge, level;
  if (agreedCount === totalVotes) {
    // Unanimous — badge proportional to how many voices spoke.
    if (totalVotes >= 4)      { badge = "✓✓✓✓"; level = "strong"; }
    else if (totalVotes === 3){ badge = "✓✓✓";  level = "strong"; }
    else                      { badge = "✓✓";   level = "strong"; }
  } else {
    badge = "✓✓";
    level = "partial";
  }

  sendCard(tabId, {
    kind: "consensus",
    cue,
    badge,
    level,
    agreed: agreedCount,
    total: totalVotes,
    details,
  });
}

// aggregateConsensus — strict-majority rule. Generalized from spec §4's
// 3-voice case to N voices: agreed >= floor(N/2) + 1 → agree. 2-of-2 still
// counts as agree (matches spec §4). With <2 voices the result is
// inconclusive (no single corroborating voice is "consensus"). Used to gate
// whether a badge is emitted at all.
function aggregateConsensus(voices) {
  if (voices.length < 2) return { verdict: "inconclusive" };
  const agreed = voices.filter((v) => v.verdict === "agree").length;
  const needed = Math.floor(voices.length / 2) + 1;
  if (agreed >= needed) return { verdict: "agree", agreed, total: voices.length };
  return { verdict: voices.length === 2 ? "inconclusive" : "split", agreed, total: voices.length };
}

async function processTick(tabId) {
  const state = getState(tabId);
  if (state.inFlight) return;
  if (state.lines.length === 0) return;

  const now = state.currentTime ?? state.lines[state.lines.length - 1].t;
  if (now - state.lastCommentT < COMMENT_EVERY_S) return;

  const minT = now - CONTEXT_WINDOW_S;
  const window = state.lines.filter((l) => l.t >= minT && l.t <= now);
  const newLines = window.filter((l) => l.t > now - NEW_LINES_WINDOW_S);
  if (newLines.length < 1) return;

  const settings = await getSettings();
  if (settings.backend === "vertex" && (!settings.gcpProjectId || !settings.vertexBearerToken)) {
    sendCard(tabId, {
      kind: "error",
      text: "Vertex AI not configured. Open extension options to enter a GCP Project ID and paste a fresh `gcloud auth print-access-token` value — or switch backend to LM Studio.",
    });
    state.lastCommentT = now;
    return;
  }

  state.inFlight = true;
  state.lastCommentT = now;

  try {
    const preamble = buildPreamble({}, settings.glossary);

    // Optional chitchat gate — saves backend calls on digressions but doubles
    // them when on-topic. Default ON. Routed through Gemini Flash via the
    // chitchat role (thinking_budget: 0). v9's Haiku hardcode removed —
    // there is no Anthropic-direct path in v9.5.
    if (settings.chitchatGate) {
      const segText = window
        .map((l) => `[${fmtCue(l.t)}] ${l.s ? l.s + ": " : ""}${l.x}`)
        .join("\n");
      const gateRaw = await callBackend({
        settings,
        role: "chitchat",
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

    const mode = settings.mode;
    const sysPrompt = MODE_PROMPTS[mode](preamble);
    const keep = ANTI_RESTATE_KEEP[mode] ?? 2;
    const recent = state.recentByMode[mode].slice(-keep);
    const userMsg = buildUserMsg(window, newLines, recent);

    const t0 = Date.now();
    const raw = await callBackend({
      settings,
      role: "classifier",
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

    // Async citation lookup — Vertex backend only. Fire-and-forget; failures
    // are silent no-cards. v9.5 grounds via Gemini's Google Search tool.
    if (settings.backend === "vertex") {
      retrieveCitation({
        flagText: cleaned.text,
        sourcePref: settings.sourcePref,
      })
        .then((citation) => {
          if (citation) sendCard(tabId, { kind: "citation", cue: now, citation });
        })
        .catch(() => { /* swallow — no citation, no problem */ });
    }

    // Async cross-vendor consensus check on conf-4/5 flags only. Same
    // fire-and-forget pattern. No-ops if no voice is enabled.
    if (
      settings.backend === "vertex" &&
      settings.consensusEnabled &&
      cleaned.confidence != null &&
      cleaned.confidence >= 4
    ) {
      const segmentText = window
        .map((l) => `[${fmtCue(l.t)}] ${l.s ? l.s + ": " : ""}${l.x}`)
        .join("\n");
      runConsensus({
        tabId,
        cue: now,
        primaryFlag: cleaned,
        segmentText,
        settings,
      }).catch(() => { /* swallow — no badge is the right failure mode */ });
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (msg.type === "CAPTION_LINE") {
    const state = getState(tabId);
    // Dedupe by exact (t, x) — YouTube re-emits caption text on re-render.
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

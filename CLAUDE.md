# The Receipts — Live Fact-Check Sidebar

Chrome MV3 extension that streams fact-flag cards alongside YouTube videos. Cloud path uses Google Vertex AI (Gemini for the primary classifier, with optional multi-vendor consensus voices). Local path uses LM Studio for fully on-device inference.

## Current state (2026-05-21)

- Shipped on disk: **v0.5.1** (manifest 0.5.1). Vertex AI as the cloud backend — Gemini 2.5 Flash drives the per-segment classifier / chitchat gate / citation retriever, Gemini 2.5 Pro drives the pre-roll dossier. Llama 4 Maverick (Meta), Grok 4.1 Fast Reasoning (xAI), and Claude Haiku 4.5 (Anthropic) wire up as opt-in consensus voices on confidence-4/5 flags. All voices route through the same Vertex OpenAI-compatible `chat/completions` endpoint at `locations/global`.
- Auth track for v0.5.x: bearer-token paste field in Options (user runs `gcloud auth print-access-token` and pastes; 60-minute lifespan). A future release will layer `chrome.identity` OAuth on top of `vertex.js`'s `getAccessToken()` without changing any caller.
- Anthropic Claude Sonnet 4.5 sits behind a conditional Vertex enablement that may still be pending; only Haiku 4.5 is wired up. Sonnet flips on as a one-row registry change once Anthropic approves.
- **v0.5.1 (security/correctness patch)** addresses 10 findings from the gstack review of v0.5.0: prompt-injection defense on YouTube uploader metadata (R1), Claude 429-retry race fixed with a fresh AbortController + bounded retry timer (R2), per-tab epoch token prevents cross-video card contamination on YouTube SPA navs (R3), MV3 keepalive bumped to the documented 0.5min floor + AbortController on the primary classifier path (R4), unparseable consensus voices now count as "disagree" so strict-majority quorum isn't silently inflated (R5), error messages sanitized before user display or `.md` export (R6), `encodeURIComponent` on `buildVertexUrl` project ID (Sec1), defensive URL parse in `attachCitation` (Sec3), v9-era dead storage keys GC'd on extension startup (Red9), and a new `consensus.js` module + 81-test `node:test` suite + `scripts/build.sh` that excludes `*.original.*` backups from the shipped zip (Maint7).
- Going-forward target: v0.6 — Sonnet voice (when Anthropic approves), `chrome.identity` OAuth, registry-driven per-voice config (Maint2/3/4/9 architectural cleanup), live key validation on Save, m.youtube.com + Shorts manifest patches.
- Build invariant: **PII-clean**. No project names, partner names, client identifiers, internal codenames, or specific named entities anywhere in shipped source. Memory files in `~/Library/Application Support/Claude/` are exempt (private dev context).
- Identity in all shipped artifacts: **Dave Smith**. Real personal identity stays out of code.

## Repo layout

```
chrome-extension/                          Unpacked Chrome extension. Load this in dev mode.
docs/
  v9.5-Gemini-Grok-Llama-spec.md           Active spec — implement against this for v9.5.
  v9.1-vertex-refactor-spec.md             Historical reference — superseded by v9.5 spec.
  lm-studio-setup.md                       User-facing local-mode setup guide.
  roadmap.md                               Unshipped feature backlog.
  smoke-test-report.md                     Known open bugs.
dist/                                      Release artifacts.
  live-factcheck-sidebar-0.3.0.zip         Current pre-v9.5 release.
CLAUDE.md                                  This file. Auto-loaded by Claude Code each session.
README.md                                  Public-facing repo landing.
LICENSE                                    MIT.
```

## Working conventions

- When changing shared modules (`prompts.js`, etc.), save the prior version as `<name>.original.<ext>`. **Never overwrite `prompts.original.js`** — it's the pre-YouTube-rewrite reference and is load-bearing for diff review.
- `content.js` does NOT get an `.original.js` per feature. Git history serves that role.
- New feature prompts go inline in `background.js` next to their only callsite (precedent: `retrieveCitation`, `fetchDossier`, citation profiles).
- Always use `safeSend(msg)` not raw `chrome.runtime.sendMessage` in `content.js` — silences orphan-script errors on dev reloads.
- Card-message kinds follow `{ kind, cue, ... }` shape. Existing kinds: `comment`, `error`, `skip`, `gated`, `citation`, `dossier`, `consensus`.
- Card's `data-cue` is the key for async attachment of citations and consensus badges. Preserve this when adding new card types.
- For YouTube DOM scraping, use the `firstNonEmpty(...selectors)` helper — comma-separated `querySelector` picks first match in DOM document order, not selector list order. That gotcha broke the dossier path in May 2026.
- Build invariant: when packing for release, build the zip in `/tmp` then `cat /tmp/build.zip > "$DEST/<name>.zip"`. Atomic rename fails on iCloud Drive.

## v9.5 model lineup

| Role | Model | Endpoint | Slug |
|---|---|---|---|
| Per-segment classifier | Gemini 2.5 Flash | global | `google/gemini-2.5-flash` (with `thinking_budget: 0`) |
| Pre-roll dossier | Gemini 2.5 Pro | global | `google/gemini-2.5-pro` (thinking allowed) |
| Chitchat off-topic gate | Gemini 2.5 Flash | global | same as primary, `thinking_budget: 0` |
| Citation retrieval | Gemini 2.5 Flash + Google Search tool | global | same, `thinking_budget: 0`, `tools: [{googleSearch:{}}]` |
| Consensus voice (conf-4/5 only, opt-in) | Llama 4 Maverick | global | `meta/llama-4-maverick-17b-128e-instruct-maas` |
| Consensus voice (conf-4/5 only, opt-in) | Grok 4.1 Fast Reasoning | global | `xai/grok-4.1-fast-reasoning` |
| Consensus voice (conf-4/5 only, opt-in) | Claude Haiku 4.5 | global | `anthropic/claude-haiku-4-5@20251001` |

Single source of truth: `chrome-extension/vertex.js` `MODEL_REGISTRY`. Add a row to enable a model (e.g. Sonnet 4.5 in v9.5.1, or any future voice); no other file changes.

All voices route through the GLOBAL endpoint per the 2026-05-21 addendum:
`https://aiplatform.googleapis.com/v1beta1/projects/{P}/locations/global/endpoints/openapi/chat/completions`

## Vendor gotchas

- **Gemini OpenAI-compat thinking control** — `extra_body.google.thinking_config.thinking_budget: 0` is the verified key path for disabling reasoning tokens on Vertex's OpenAI-compat endpoint. Applied to classifier / chitchat / citation roles in `vertex.js`. The dossier role intentionally omits it (~188 reasoning tokens observed on trivial responses; acceptable on a pre-roll path).
- **Grok 664-token wrapper** — every Grok call costs ~660 prompt tokens before the user message because the Vertex/xAI gateway injects a system wrapper. Restrict Grok firing to conf-4/5 cards only (already gated in `runConsensus`). Surfaced to users via tooltip on the Grok checkbox.
- **Llama region migration** — Llama 4 Maverick smoke-tested as us-east5-only in May 2026, but the 2026-05-21 addendum moved it to `global` along with everything else. If global doesn't serve Llama in practice, the 4-second consensus timeout produces a silent no-vote and Gemini+Grok+Claude still form a consensus. We do NOT add region-fallback logic — fallbacks happen at the voice level, not the region level.
- **Claude on Vertex — global only, three separate quotas** — Anthropic on Vertex uses the global endpoint exclusively. Do NOT set `CLOUD_ML_REGION`, do NOT hardcode `/locations/us-east5/` for Claude. Quotas are per-model: `global_online_prediction_input_tokens_per_minute_per_base_model`, `..._output_tokens_...`, and `..._requests_...`. `callConsensusVoice` in `background.js` retries Claude once on HTTP 429 with a 500ms backoff, then silent voice-fallback. Never surface a throttle to the user. Sonnet 4.5 (`anthropic/claude-sonnet-4-5@20250929`) approval may still be pending — on 400 "model not available", the voice no-votes silently.
- **Auth track for v9.5** — bearer-paste Options field. `gcloud auth print-access-token` produces a 60-minute token. ADC + service-account JSON keys are blocked at the org level by Secure-by-Default. v9.5.1 layers `chrome.identity` OAuth on top of `getAccessToken()` in `vertex.js`.

## Auth

v9.5 ships with the **bearer-paste track** (D1=B per the v9.5 implementation kickoff):

- User runs `gcloud auth print-access-token` and pastes the result into the Options form. The token lives in `chrome.storage.local` and is read by `vertex.js getAccessToken()` on every Vertex call.
- Token expiry (~60 min) surfaces as a 401 → "access token expired" error card. User re-pastes.
- `iam.disableServiceAccountKeyCreation` is enforced at the org level via Secure-by-Default and does not honor project-level overrides. We do NOT pursue SA-JWT auth — it's blocked.
- **v9.5.1 layer**: `chrome.identity.getAuthToken({ interactive: false })` replaces the bearer-paste field. Requires registering a Web Application OAuth client in the GCP project and adding `oauth2.client_id` to `manifest.json`. Caller signature in `vertex.js` doesn't change.

## Build + release

```bash
# Build a release zip (TBD — script to be added at scripts/build.sh)
# For now: zip the chrome-extension/ folder manually, output to dist/.

# Pre-release review
gstack review

# Cut a release after fixes
gh release create v<version> \
  dist/live-factcheck-sidebar-<version>.zip \
  --generate-notes
```

## Known open work

- **v9.5.1**: layer `chrome.identity` OAuth on top of `vertex.js` `getAccessToken()` so the access token refreshes automatically; live Vertex-token validation on Save (still partially open — Options has a Test connection button but no auto-check); `m.youtube.com/watch*` and `/shorts/*` manifest patches (two of the four v9 smoke-test bugs); copy-as-quote + share buttons on each card.
- **v9 chyron + consensus paths** haven't been live-verified on a conf-4/5 firing clip. The Murray/Smith JRE smoke-test only produced conf-2/3 cards. Re-test on a clip with hard-number claims now that v9.5 is in disk.
- **Claude Sonnet 4.5** approval status — Anthropic enablement may still be pending. When approved, uncomment the Sonnet row in `vertex.js MODEL_REGISTRY` and add a Sonnet checkbox + tooltip to Options (mirror the Haiku row).
- **10+ unshipped features** in `docs/roadmap.md`, plus a packaging-strategy decision (smart onboarding vs. Homebrew tap vs. signed installer) deferred to post-contest.

## Out of scope here

Cowork-side memory files (`~/Library/Application Support/Claude/`) and the prior Cowork session-wrap-up workflow. Claude Code is the dev surface from this point forward.

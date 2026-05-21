# The Receipts — Live Fact-Check Sidebar

Chrome MV3 extension that streams fact-flag cards alongside YouTube videos. Cloud path uses Google Vertex AI (Gemini for the primary classifier, with optional multi-vendor consensus voices). Local path uses LM Studio for fully on-device inference.

## Current state (2026-05-19)

- Shipped on disk: **v9** (manifest 0.3.0). Nine features confirmed working — pre-roll dossier, citation retrieval, bias-balanced sourcing profiles, cross-model consensus, in-video chyron, confidence-tinted cards, click-to-jump, session export, traffic-light emoji + heartbeat ghost cards.
- Going-forward target: **v9.5-Gemini-Grok-Llama**. Full spec at `docs/v9.5-Gemini-Grok-Llama-spec.md`. Pivot reasoning: Anthropic-on-Vertex quota is gated on a 48h+ new-project wait, so v9.5 routes Gemini as primary (covered by GCP credits) and adds Meta Llama 4 Maverick + xAI Grok 4.1 Fast Reasoning as the consensus voices via Vertex's OpenAI-compatible chat-completions endpoint. Anthropic Claude becomes a v9.6 delta-spec once regional Haiku/Sonnet quotas land.
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

## v9.5-Gemini-Grok-Llama model lineup

| Role | Model | Endpoint location | Slug |
|---|---|---|---|
| Per-segment classifier | Gemini 2.5 Flash | global | `google/gemini-2.5-flash` (with `thinking_budget: 0`) |
| Pre-roll dossier | Gemini 2.5 Pro | global | `google/gemini-2.5-pro` (thinking allowed) |
| Chitchat off-topic gate | Gemini 2.5 Flash | global | same as primary, `thinking_budget: 0` |
| Citation retrieval | Gemini 2.5 Flash | global | same, `thinking_budget: 0` |
| Consensus voice (conf-4/5 only, opt-in) | Llama 4 Maverick | **us-east5** | `meta/llama-4-maverick-17b-128e-instruct-maas` |
| Consensus voice (conf-4/5 only, opt-in) | Grok 4.1 Fast Reasoning | global | `xai/grok-4.1-fast-reasoning` |

All routed through `https://{region}-aiplatform.googleapis.com/v1beta1/projects/{P}/locations/{region}/endpoints/openapi/chat/completions` (or `aiplatform.googleapis.com/...locations/global/...` for global). Same OpenAI-compatible request schema across all three vendors.

**Cost note on Grok:** Vertex injects a ~664-token system wrapper into every Grok call (confirmed via smoke test — a 5-token user message returned `prompt_tokens: 664`). Restrict Grok firing to conf-4/5 cards only to keep cost predictable.

## Auth

Two tracks documented in the v9.5 spec:

- **Dev (solo)**: service account JSON via `GOOGLE_APPLICATION_CREDENTIALS`. JWT signed in the service worker using SubtleCrypto (no `jsonwebtoken` dependency).
- **Distribution (public)**: `chrome.identity` OAuth — user clicks "Sign in with Google" once, extension uses the resulting access token for Vertex AI calls. Auto-refreshes via `chrome.identity.getAuthToken({ interactive: false })`.

Note: at the time of migration, `iam.disableServiceAccountKeyCreation` was enforced at the org level via Secure-by-Default and did not honor project-level overrides. Workaround for ongoing dev: use `gcloud auth print-access-token` short-lived bearer tokens. Long-term: disable the org-level enforcement once the project graduates from contest-submission phase.

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

- **v9.5 implementation**, end-to-end per `docs/v9.5-Gemini-Grok-Llama-spec.md`. Estimated 1.5 working days.
- **Four smoke-test bugs** carried over from v9: `m.youtube.com` listed in `host_permissions` but not in `content_scripts.matches`, no YouTube Shorts URL support, chitchat gate hardcodes Haiku via `overrideModel` (needs to switch to Gemini Flash per v9.5), no live API-key validation on Save (invalid keys fail silently until first call). See `docs/smoke-test-report.md`.
- **v9 chyron + consensus paths** haven't been live-verified on a conf-4/5 firing clip. The Murray/Smith JRE smoke-test only produced conf-2/3 cards. Re-test after v9.5 ships with a clip that has hard-number claims.
- **10+ unshipped features** in `docs/roadmap.md`, plus a packaging-strategy decision (smart onboarding vs. Homebrew tap vs. signed installer) deferred to post-contest.

## Out of scope here

Cowork-side memory files (`~/Library/Application Support/Claude/`) and the prior Cowork session-wrap-up workflow. Claude Code is the dev surface from this point forward.

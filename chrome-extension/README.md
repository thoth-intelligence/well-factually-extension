# Live Fact-Check Sidebar — Chrome Extension (v0.5.0)

Streams fact-flag cards alongside any YouTube video as it plays, using Vertex
AI (Gemini Flash for the primary classifier, optional Llama / Grok / Claude
consensus on high-confidence flags) or a local LM Studio backend. No backend
to host, no account beyond a Google Cloud project, no app server.

## Install (developer mode, ~30 seconds)

1. Open Chrome → **chrome://extensions/**
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `chrome-extension/`
5. Extension appears in the list. **Pin it** to your toolbar from the puzzle-piece menu (optional, makes Options easier to reach).

## Setup (one-time, ~3 minutes)

1. Right-click the extension icon → **Options** (or `chrome-extension://<id>/options.html`)
2. **Backend**: leave on Vertex AI for the cloud path, or pick LM Studio for fully local inference
3. **Google Cloud Project ID**: the project where you've enabled Vertex AI
4. **Vertex AI access token**: run `gcloud auth print-access-token` in your terminal and paste the output. Tokens last ~60 minutes; you'll see "access token expired" in a card when it's time to refresh.
5. Click **Test connection** — confirms the token + project + Gemini Flash access in ~1 second
6. **Mode**: Fact-flag (default)
7. **Source profile** (bias-balanced sourcing): Primary (default), Centrist, Left, Right, or All
8. **Cross-vendor consensus** (optional): toggle on, then enable Llama / Grok / Claude individually. Default off — first-run cost matches Gemini-only.
9. **Domain glossary** (optional): comma-separated terms (e.g. "product names, technical jargon, proper nouns") to help the model correct STT mishearings
10. Click **Save**

The token is held in `chrome.storage.local`, scoped to this extension. Page
JavaScript on YouTube cannot read it. It's only ever sent to
`*.aiplatform.googleapis.com`.

## Use

1. Open any YouTube video on **youtube.com/watch?v=…**
2. **Enable closed captions** (the CC button on the player) — the extension reads YouTube's caption track from the DOM, so CC must be on
3. Play the video. The side panel on the right shows:
   - 🎬 Fact-Check header with **export** + **clear** buttons + collapse toggle
   - Live status line ("receiving captions · t=12:34 · mode: factflag")
   - **📋 Briefing card** that lands first, before captions, with a one-paragraph dossier on the topic and what a careful viewer should listen for
   - **Fact-flag cards** streaming in as flags fire — confidence-tinted (🟢 1 / 🟡 2 / 🟠 3 / 🔴 4 / 🚨 5) with a one-shot pulse animation on conf-4/5
   - **Citations** attached asynchronously under each flag, sourced via Gemini's Google Search grounding
   - **Consensus badges** (✓✓✓✓ / ✓✓✓ / ✓✓) on conf-4/5 flags when consensus voices are enabled and they agree with Gemini
   - **In-video chyron overlay** on conf-4/5 flags, 8-second auto-dismiss, click body to seek, × to dismiss
   - **Watching-ghosts** when the model SKIPped or the chitchat gate filtered
4. **Click any cue timestamp** to jump 3 seconds before that moment in the video
5. Hover a card to **★ pin** or **✕ dismiss**
6. Click **export** in the header to download all cards as a markdown session log with YouTube deep-links
7. Click **clear** to wipe state and start over

## What's inside

```
chrome-extension/
├── manifest.json       Manifest V3 — declares permissions
├── background.js       Service worker — buffers windows, dispatches via callVertex, retrieves citations, runs cross-vendor consensus
├── vertex.js           Model registry + Vertex AI OpenAI-compat client + bearer-token auth
├── content.js          Runs in YouTube pages — caption MutationObserver, sidebar UI, in-video chyron
├── prompts.js          Mode prompts + chitchat gate + speaker preamble
├── prompts.original.js Pre-rewrite reference (preserved for diffing — load-bearing, do not edit)
├── format_guard.js     Strips format leaks; enforces sentence-end punctuation + min 3 words + 45-word cap; parseConsensusVerdict helper
├── sidebar.css         Fixed-position panel + card + chyron styling
├── options.html        Settings UI
└── options.js
```

## Architecture

```
[YouTube page]
    │
    │  CC track renders to .ytp-caption-window-container
    │  ↓ MutationObserver picks up new caption text
    │
[content.js]
    │  ↓ chrome.runtime.sendMessage({type:"CAPTION_LINE", line, currentTime})
    │
[background.js — service worker]
    │  Buffers lines into 60s sliding window
    │  On watch-page load: fetchDossier (Gemini Pro) → briefing card
    │  Every ~18s of cue: optional chitchat-gate (Gemini Flash, thinking_budget=0)
    │    → classifier call (Gemini Flash, thinking_budget=0)
    │    → format guard → confidence parse
    │    → (if conf-4/5 + consensus on) runConsensus → Llama/Grok/Claude in parallel
    │    → (if non-SKIP) retrieveCitation → Gemini Flash + googleSearch tool
    │  ↓ chrome.tabs.sendMessage({type:"CARD", ...})
    │
[content.js]
    │  Renders card in the injected side panel
    │  Attaches citation + consensus badge asynchronously via data-cue match
    │  On conf-4/5, fires the in-video chyron overlay inside #movie_player
```

## Features shipped (v0.5.0)

- **Vertex AI primary** — Gemini 2.5 Flash for classifier / chitchat / citation, Gemini 2.5 Pro for the pre-roll dossier. All on the global endpoint.
- **Cross-vendor consensus** — high-confidence flags fan out to Llama 4 Maverick (Meta), Grok 4.1 Fast Reasoning (xAI), and Claude Haiku 4.5 (Anthropic) in parallel. 4-second per-voice timeout. Strict-majority vote produces the consensus badge.
- **Pre-roll dossier** — one-paragraph briefing before captions arrive, based on video metadata
- **Confidence scoring + traffic-light emoji** — 🟢 / 🟡 / 🟠 / 🔴 / 🚨 with conf-4/5 tinting + pulse animation
- **Citation retrieval** — every non-SKIP flag gets an authoritative source attached asynchronously, grounded via Gemini's Google Search tool
- **Bias-balanced sourcing** — 5 Options profiles (Primary / Centrist / Left / Right / All) steer citation retrieval
- **In-video chyron** — bottom-of-player overlay on conf-4/5 flags, follows fullscreen, 8-second auto-dismiss
- **Click-to-jump** — any cue timestamp re-seeks 3 seconds before the moment
- **Session export** — downloads all cards as a markdown log with YouTube deep-links
- **Local-only operation** — point at LM Studio (`http://127.0.0.1:1234`) instead of Vertex AI for fully local inference

## Caveats / known limitations

- **Captions must be enabled.** No CC = no input. Most YouTube videos have auto-captions available; click CC to turn them on.
- **Access token expires every ~60 minutes.** Refresh by re-running `gcloud auth print-access-token` and re-pasting. v0.5.1 will layer `chrome.identity` OAuth so this becomes one click.
- **YouTube SPA navigation** clears state — clicking another video resets the buffer; the dossier re-fires for the new video.
- **Service worker idle kills.** MV3 terminates the worker after 30s idle. We send a `chrome.alarms` heartbeat every 24s to keep it alive while a tab is active.
- **No live stream support yet.** Works on recorded videos. YouTube live captions arrive through a different mechanism.
- **No YouTube Shorts support.** Shorts use `/shorts/<id>` not `/watch?v=…`.
- **m.youtube.com partial support.** Listed in host_permissions but the content script doesn't match mobile URLs.
- **No icon yet** — Chrome shows a default puzzle piece. Add a 128px PNG to `icons/icon-128.png` and re-declare it in `manifest.json` when you have one.

## Roadmap

- **v0.5.1**: `chrome.identity` OAuth so the access token refreshes automatically; live API-key validation on Save (closes a smoke-test gap); copy-as-quote + share buttons on each card; sidebar pop-out for second-monitor viewing
- **v0.6**: Sonnet 4.5 as a fifth consensus voice once Anthropic enables it; live-stream caption support; synchronized reading view (transcript + flags side by side); YouTube Shorts support
- **v0.7+**: Cross-platform engine (Twitch, X audio-spaces, podcast apps); newsroom JSON API for B2B integration; community fact-check layer; classroom / debate-prep mode (reasoning chains exposed); voice-cloning / deepfake detection

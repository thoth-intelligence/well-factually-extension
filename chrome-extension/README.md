# Live Fact-Check Sidebar — Chrome Extension (v0.3.0)

Streams fact-flag cards alongside any YouTube video as it plays, using your own
Anthropic API key (or a local LM Studio backend). No backend, no hosting, no
account. Built on a caption-observation pipeline validated against long-form
podcasts and a multi-call evaluation bench.

## Install (developer mode, ~30 seconds)

1. Open Chrome → **chrome://extensions/**
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `chrome-extension/`
5. Extension appears in the list. **Pin it** to your toolbar from the puzzle-piece menu (optional, makes Options easier to reach).

## Setup (one-time, ~2 minutes)

1. Right-click the extension icon → **Options** (or `chrome-extension://<id>/options.html`)
2. **Anthropic key** (required for the cloud backend): paste from `console.anthropic.com` (starts with `sk-ant-…`)
3. **Backend**: Anthropic for the cloud path, or LM Studio (`http://127.0.0.1:1234`) for local-only
4. **Model**: Haiku for speed/cost, Sonnet for sharper questions
5. **Mode**: Fact-flag (default)
6. **Source profile** (bias-balanced sourcing): Primary (default), Centrist, Left, Right, or All
7. **OpenAI key** (optional, for cross-model consensus on high-confidence flags)
8. **Gemini key** (optional, same)
9. **Domain glossary** (optional): comma-separated terms (e.g. "product names, technical jargon, proper nouns") to help the model correct STT mishearings
10. Click **Save**

The keys are held in `chrome.storage.local`, scoped to this extension. Page JavaScript on YouTube cannot read them. They're only ever sent to the respective API endpoints from the extension's background service worker.

## Use

1. Open any YouTube video on **youtube.com/watch?v=…**
2. **Enable closed captions** (the CC button on the player) — the extension reads YouTube's caption track from the DOM, so CC must be on
3. Play the video. The side panel on the right shows:
   - 🎬 Fact-Check header with **export** + **clear** buttons + collapse toggle
   - Live status line ("receiving captions · t=12:34 · mode: factflag")
   - **📋 Briefing card** that lands first, before captions, with a one-paragraph dossier on the topic and what a careful viewer should listen for
   - **Fact-flag cards** streaming in as flags fire — confidence-tinted (🟢 1 / 🟡 2 / 🟠 3 / 🔴 4 / 🚨 5) with a one-shot pulse animation on conf-4/5
   - **Citations** attached asynchronously under each flag, sourced from credible providers
   - **Consensus badges** (✓✓✓ / ✓✓ / ⚠) on conf-4/5 flags when OpenAI + Gemini keys are configured
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
├── background.js       Service worker — buffers windows, calls Anthropic / OpenAI / Gemini, retrieves citations, runs cross-model consensus
├── content.js          Runs in YouTube pages — caption MutationObserver, sidebar UI, in-video chyron
├── prompts.js          Mode prompts + chitchat gate + speaker preamble
├── prompts.original.js Pre-rewrite reference (preserved for diffing)
├── format_guard.js     Strips format leaks, embedded SKIP; enforces sentence-end punctuation + min 3 words + 45-word cap
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
    │  On watch-page load: fetchDossier → briefing card
    │  Every ~18s of cue: optional chitchat-gate → mode call → format guard
    │    → confidence parse → (if conf-4/5) cross-model consensus fan-out
    │    → (if non-SKIP) citation retrieval via web_search
    │  ↓ chrome.tabs.sendMessage({type:"CARD", ...})
    │
[content.js]
    │  Renders card in the injected side panel
    │  Attaches citation + consensus badge asynchronously via data-cue match
    │  On conf-4/5, fires the in-video chyron overlay inside #movie_player
```

## Features shipped (v0.3.0)

- **Pre-roll dossier** — one-paragraph briefing before captions arrive, based on video metadata (title, channel, description, view count, upload date)
- **Confidence scoring + traffic-light emoji** — 🟢 / 🟡 / 🟠 / 🔴 / 🚨 with conf-4/5 tinting + pulse animation
- **Citation retrieval** — every non-SKIP flag gets an authoritative source attached asynchronously
- **Bias-balanced sourcing** — 5 Options profiles (Primary / Centrist / Left / Right / All) steer citation retrieval
- **Cross-model consensus** — high-confidence flags get fanned to OpenAI + Gemini in parallel; badge shows agreement level with per-model breakdown
- **In-video chyron** — bottom-of-player overlay on conf-4/5 flags, follows fullscreen, 8-second auto-dismiss
- **Click-to-jump** — any cue timestamp re-seeks 3 seconds before the moment
- **Session export** — downloads all cards as a markdown log with YouTube deep-links
- **Local-only operation** — point at LM Studio (`http://127.0.0.1:1234`) instead of Anthropic for fully local inference

## Caveats / known limitations

- **Captions must be enabled.** No CC = no input. Most YouTube videos have auto-captions available; click CC to turn them on.
- **YouTube SPA navigation** clears state — clicking another video resets the buffer; the dossier re-fires for the new video.
- **Service worker idle kills.** MV3 terminates the worker after 30s idle. We send a `chrome.alarms` heartbeat every 24s to keep it alive while a tab is active.
- **No live stream support yet.** Works on recorded videos. YouTube live captions arrive through a different mechanism.
- **No YouTube Shorts support.** Shorts use `/shorts/<id>` not `/watch?v=…`.
- **m.youtube.com partial support.** Listed in host_permissions but the content script doesn't match mobile URLs.
- **No icon yet** — Chrome shows a default puzzle piece. Add a 128px PNG to `icons/icon-128.png` and re-declare it in `manifest.json` when you have one.
- **No live API-key validation on Save.** Invalid keys fail silently until the first call (~18 seconds into the first video).

## Roadmap

- **v0.4**: Copy-as-quote + share buttons on each card; live API-key validation on Save; sidebar pop-out for second-monitor viewing; quick-toggle the chitchat gate from the sidebar header
- **v0.5**: Live-stream caption support; synchronized reading view (transcript + flags side by side); YouTube Shorts support
- **v0.6+**: Cross-platform engine (Twitch, X audio-spaces, podcast apps); newsroom JSON API for B2B integration; community fact-check layer; classroom / debate-prep mode (reasoning chains exposed); voice-cloning / deepfake detection

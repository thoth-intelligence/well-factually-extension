# Well, Factually

> Real-time fact-checking sidebar for YouTube videos. Catches every claim, live, while you watch.
>
> Free to install. Bring your own free Google AI Studio key (30-second signup) — or run fully local via LM Studio. No backend, no account, no data egress beyond the API call you authorize.

## Features

- **Pre-roll dossier** — one-paragraph briefing on the video and what to listen for, before captions arrive.
- **Confidence-tinted fact-flag cards** — 1–5 scale with traffic-light emoji, pulse animation on high-confidence flags.
- **Citation retrieval** — every non-skipped flag gets an authoritative source attached asynchronously.
- **In-sidebar bias picker** — pill toggle (Primary / All) plus a 3-position Left / Centrist / Right slider above the cards. Steers which family of sources the citation finder prefers without leaving the YouTube tab. Persists across sessions and syncs with the Options page.
- **Cross-model consensus** *(opt-in)* — high-confidence flags get fanned out to Meta Llama 4 Maverick, xAI Grok 4.1 Fast, and Anthropic Claude Haiku 4.5 in parallel; a "consensus" badge appears when 2-of-3 vendors agree on the flag.
- **In-video chyron** — bottom-of-player overlay on the most confident flags, follows fullscreen, 8-second auto-dismiss.
- **Click-to-jump** — any timestamp re-seeks the video 3 seconds before the moment.
- **Session export** — download all cards as a markdown log with YouTube deep-links.
- **Local-only operation** — point at LM Studio (`http://127.0.0.1:1234`) instead of any cloud API for fully local inference. No cloud, no costs, no caption data leaving your machine.
- **Free tier ad supported** — occasional sponsored book-recommendation cards (every ~4 flags) help fund development. Subscribe to **Pro** at [well-factually.com](https://well-factually.com/#pricing) for $3.50/mo to remove them entirely.

## Install

1. [Download the latest release](https://github.com/thoth-intelligence/well-factually-extension/releases/latest) (zip file).
2. Unzip.
3. Chrome → `chrome://extensions/` → toggle **Developer mode** (top right) → **Load unpacked** → select the `chrome-extension/` folder from the unzipped directory.
4. Right-click the extension icon → **Options**.
5. In the "AI provider" section, the easiest path is **Google AI Studio** — paste a free API key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). For privacy-first users: switch to **LM Studio** and point at `http://127.0.0.1:1234`. For enterprise GCP users: pick Vertex AI and configure your project.
6. *(Optional)* Subscribe to Pro at [well-factually.com](https://well-factually.com/#pricing), copy the license code from the success page, paste into the Options "Pro subscription" section, click **Verify**. The `PRO` pill will appear in your sidebar header on YouTube and sponsored cards will stop appearing.
7. Open any YouTube video, **turn on closed captions** (CC button on the player), and play.

For the local-only LM Studio setup, see [docs/lm-studio-setup.md](docs/lm-studio-setup.md).

## Why this exists

Real-time fact-checking that respects three constraints most existing tools violate: (1) **real-time, not retrospective** — flags arrive during the watch, not after; (2) **local-first option** so privacy-conscious users can run the whole pipeline without any caption data leaving their machine; (3) **epistemic humility on the cloud path** — high-confidence flags get verified by four independent vendors (Google + Meta + xAI + Anthropic), so no single model decides truth.

## Pricing

- **Free** — full fact-checking, all features, occasional sponsored book-recommendation cards (every ~4 flags). You bring your own AI Studio key (free) or run local via LM Studio.
- **Pro** ($3.50/mo) — same product, ad-free. Subscribe at [well-factually.com/#pricing](https://well-factually.com/#pricing). Cancel anytime; ads come back the next time the extension revalidates your subscription (within 24 hours).

Affiliate links: when a citation happens to point at Amazon, we append our Associates tag (`thothintellig-20`) so we earn a small commission if you buy. Affiliate links carry a visible `$` badge and `rel="sponsored"` so you can always see which links are commissioned. The classifier doesn't see ads or affiliate inventory — confidence scores reflect the underlying claim, not what's promoted.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md). Current shipped: **v0.7.0** (affiliate + Pro tier + bias picker in sidebar + esbuild bundle). Next: `chrome.identity` OAuth for Vertex token auto-refresh, `m.youtube.com` + Shorts manifest patches, copy-as-quote and share buttons on each card, Chrome Web Store submission.

## License

MIT — see [LICENSE](LICENSE).

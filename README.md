# Well, Factually

> Real-time fact-checking sidebar for YouTube videos. Catches every claim, live, while you watch.
>
> Bring your own Google Cloud project (Gemini via Vertex AI) or run fully local via LM Studio. No backend, no account, no data egress beyond the API call you authorize.

## Features

- **Pre-roll dossier** — one-paragraph briefing on the video and what to listen for, before captions arrive.
- **Confidence-tinted fact-flag cards** — 1–5 scale with traffic-light emoji, pulse animation on high-confidence flags.
- **Citation retrieval** — every non-skipped flag gets an authoritative source attached asynchronously.
- **Bias-balanced sourcing** — five Options profiles (Primary / Centrist / Left / Right / All) steer citation retrieval, so the same product serves both ends of the political spectrum.
- **Cross-model consensus** *(opt-in)* — high-confidence flags get fanned out to Meta Llama 4 Maverick and xAI Grok 4.1 Fast in parallel; a "consensus" badge appears when 2-of-3 vendors agree on the flag.
- **In-video chyron** — bottom-of-player overlay on the most confident flags, follows fullscreen, 8-second auto-dismiss.
- **Click-to-jump** — any timestamp re-seeks the video 3 seconds before the moment.
- **Session export** — download all cards as a markdown log with YouTube deep-links.
- **Local-only operation** — point at LM Studio (`http://127.0.0.1:1234`) instead of Vertex AI for fully local inference. No cloud, no costs, no caption data leaving your machine.

## Install

1. [Download the latest release](https://github.com/thoth-intelligence/well-factually-extension/releases/latest) (zip file).
2. Unzip.
3. Chrome → `chrome://extensions/` → toggle **Developer mode** (top right) → **Load unpacked** → select the `chrome-extension/` folder from the unzipped directory.
4. Right-click the extension icon → **Options** → connect your Google Cloud project (Vertex AI access) or point at `http://127.0.0.1:1234` if you're running LM Studio locally.
5. Open any YouTube video, **turn on closed captions** (CC button on the player), and play.

For the local-only LM Studio setup, see [docs/lm-studio-setup.md](docs/lm-studio-setup.md).

## Why this exists

Real-time fact-checking that respects three constraints most existing tools violate: (1) **real-time, not retrospective** — flags arrive during the watch, not after; (2) **local-first option** so privacy-conscious users can run the whole pipeline without any caption data leaving their machine; (3) **epistemic humility on the cloud path** — high-confidence flags get verified by three independent vendors (Google + Meta + xAI), so no single model decides truth.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md). Current target: **v9.5-Gemini-Grok-Llama** ([spec](docs/v9.5-Gemini-Grok-Llama-spec.md)).

## License

MIT — see [LICENSE](LICENSE).

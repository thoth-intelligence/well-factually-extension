# Feature Ideas for Live Fact-Check Sidebar

Ranked by leverage — how much each one improves the contest pitch *and* the actual product, weighed against how hard it is to build. Grouped by horizon so the easy wins are obvious.

## Quick wins (one to three days)

**Click-to-jump on every card.** The model already receives `currentTime` with every caption line, and the background sends `cue` back with every card. Wiring a click handler on `.fcs-cue` that does `document.querySelector('video').currentTime = parseCue(text) - 3` lets a viewer tap a flag and re-watch the 3 seconds before the questionable claim. This is the single most natural verb in the entire UI and it's currently absent.

**Copy-as-quote and share buttons on each card.** A right-side icon row inside `.fcs-actions` (the div is already in `addCard`, just unused) for "copy", "tweet" (prefilled `?text=…` with video URL + timestamp), "pin", and "dismiss". Pins persist in `chrome.storage.local` so reloading a video brings them back. Dramatically increases shareability and engagement during livestreams.

**Confidence score and color-coding.** Bump the system prompt to require `[1-5] | claim sentence` and render the number as a dot before the text — gray for low-confidence flags, gold for the rare 5/5. Same model, same call, costs nothing extra, and instantly makes the sidebar feel more like a tool than a chatbot.

**Live model-validation on Save.** From the smoke test: 401 and credit-balance errors only surface inside cards, ~18 seconds into a video. Fire a 5-token validation call on the Save button in `options.js` and show the precise failure in the status line. Closes off the worst onboarding cliff.

**Quick-toggle the chitchat gate from the sidebar header.** Right now changing the gate requires opening Options. A tiny switch in the sidebar that costs nothing and lets the user trade cost for sensitivity in real time.

**Session export.** A "save session" button serializes all cards plus video URL plus timestamps to markdown and offers a download. Three lines of code, useful for journalists building post-publication notes.

## Differentiators (a week or two each)

**Citation retrieval per flag.** For every non-SKIP flag, fire a second short call to Anthropic's web-search tool (or a Brave Search API call) for one authoritative source, then render a chevron under the card that expands to show the linked source and a one-line "what the source says" quote. This is the single most credibility-shifting feature you could ship — it turns "the model says this is fishy" into "the model says this is fishy, and here's the BBC/PubMed/Census Bureau page that contradicts it."

**Source consensus.** For high-stakes flags, fan out the same prompt to two or three different LLMs (Claude + a local model via LM Studio + optionally Gemini/OpenAI) and color the card by agreement level. Three-way agreement = high-confidence; disagreement = ambiguous, surface to the user. This is a defensible product moat: the value proposition becomes "no single model decides what's true" rather than "we picked the smart model."

**Sidebar pop-out.** A button that detaches the sidebar into a small always-on-top Chrome window via `chrome.windows.create({ type: 'popup', alwaysOnTop: true })`. The user puts it on a second monitor. Suddenly the experience is "watch full-screen on monitor A, fact-flags scroll on monitor B" — fundamentally a better viewing posture for the target audience (journalists, debate-watchers, news junkies).

**Pre-roll dossier.** The moment the user lands on a YouTube watch URL, fire one Claude call against the video title + description + uploader name + view count + upload date and produce a one-paragraph briefing: "Here's who's speaking, here's the topic, here are the three things to listen for, here's their historical track record on this beat." Renders as the very first card. Costs ~$0.003 per video and dramatically changes the perceived value of the extension before captions even start arriving.

**Synchronized reading view.** A second tab/panel that shows the running transcript on the left, fact-flags pinned at the matching timecode on the right, scrolling in sync with the video. Useful for revisiting a 2-hour podcast post-hoc without re-watching. Solves the "I want to find the part where they made the dumb claim about GDP" use case.

**Bias-balanced sourcing.** Let the user mark which media sources they trust (or pre-load profiles like "left-leaning", "right-leaning", "centrist", "academic-only", "primary-sources-only") and have the citation retriever respect those preferences. Now the same product serves both ends of the political spectrum without forcing a single editorial line — a feature most fact-checking tools refuse to ship.

## Big bets (multi-week, but contest-defining)

**Visual overlay on the video itself.** Instead of (or in addition to) the sidebar, draw a thin red bar across the bottom of the player when a flag fires, with the flag text rolling Chyron-style. This is the difference between "an analyst's tool" and "what news consumption should look like in 2026." Risk: more aggressive YouTube DOM coupling.

**Cross-platform engine.** Reuse the same caption-window → fact-flag pipeline against Twitch livestreams, X audio-spaces, podcasts in Pocket Casts / Apple Podcasts (via system-audio capture), and news websites with auto-playing video. The contest framing is "real-time fact-checking" — owning every surface, not just YouTube, is the long-term moat.

**Community fact-check layer.** Optional opt-in: when a flag fires that other users have also flagged on the same video at the same timestamp, show "47 other viewers flagged this moment." Persisted via a thin server. Crowd-sourced verification without a Wikipedia-style edit war, because each individual's view is their own.

**Newsroom API.** A B2B product line: same engine, but cards are streamed to a structured JSON endpoint a newsroom can integrate into their CMS. Real-time fact-checking-as-a-service for live broadcasts. Likely your biggest revenue line if this thing has legs commercially.

**Classroom / debate-prep mode.** A mode where every card includes its reasoning chain, not just the conclusion. Sold to journalism schools, debate teams, and media-literacy programs. Same model, different system prompt, low engineering cost, totally different customer.

**Voice-cloning detection.** Out of scope for the LLM but a critical adjacent feature: when the audio appears to be AI-generated (deepfake president video, fake podcast guest), surface that as the *first* flag. Open-source detectors exist (e.g., Realtime-Audio-Deepfake-Detection). Genuinely novel in this space.

## Contest-tuned framing

If the judges care most about "this product visibly improves news consumption *today*", lead with click-to-jump, citation retrieval, and pre-roll dossier — they're tight, working, and demo-able in 30 seconds. If the judges care more about "this team has thought about the structural problems with AI fact-checking", lead with source consensus, bias-balanced sourcing, and your existing local-first LM Studio option. The chitchat gate, format guard, and SKIP discipline already in the codebase are quiet proof that you've thought about hallucination control — make sure that's in the pitch even if you don't add features around it.

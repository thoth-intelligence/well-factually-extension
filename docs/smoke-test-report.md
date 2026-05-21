# Live Fact-Check Sidebar — Smoke Test Report

**Tested:** Browser 2 (deviceId `3ca53dfe-…`), extension `ofdbklbmahchocodhgbgaaelgojjoece` v0.2.0, Anthropic backend, factflag mode, chitchat gate on. Three YouTube videos exercised: a TED talk (`qp0HIF3SfI4`, Simon Sinek), an MIT lecture (`AhyznRSDjw8`), and a Tom Scott opinion piece (`jPhJbKBuNnA`). Probed via Chrome MCP injected JS rather than visual inspection.

## What's working

The basics are solid. On every `youtube.com/watch*` URL the content script injects the `#fcs-root` side panel on first load, the caption mutation observer attaches as soon as YouTube renders the `.ytp-caption-window-container` (which only happens once CC has been turned on at least once on the tab), and the status line correctly flips from `waiting for captions…` to `captions detected — watching` to `receiving captions · t=…`. Settings load reliably — `mode: factflag` appeared on every test without the `⚠ no API key` suffix, confirming `chrome.storage.local` round-trips after a Save.

Cross-video state isolation is correct. Navigating from Sinek to the MIT lecture in the same tab (via direct `location.href`) reset `cardCount` and `ghostCount` to zero, restored the empty-state placeholder, and re-attached a fresh observer. The `setInterval` URL-poll in `content.js` should handle YouTube's SPA pushState navigations identically — I couldn't verify that case end-to-end because Chrome MCP only loads tabs in the background and YouTube's autoplay policy refuses to start playback in hidden tabs, but the code path is the same.

End-to-end LLM calls succeed: the Sinek run produced a `skip` ghost at 00:25 and the Tom Scott run produced a `gated` (off-topic) ghost at 00:03. Both require a successful Anthropic round-trip, so the API key on this profile is valid and funded.

URL pattern enforcement is correct. The extension does NOT inject on `youtube.com/` (homepage), `youtube.com/feed/trending`, or any non-`/watch` path I tried. Good — silent on pages where it has no signal.

## What's surprising or broken

**The fire rate is far lower than the README implies.** On the Sinek TED talk I watched the state climb to `t=3:21` and the sidebar still showed exactly one ghost from 00:25 and zero cards. The model fired once at 00:25, returned SKIP, and then nothing else for the next three minutes despite captions clearly streaming. With `COMMENT_EVERY_S = 18` you'd expect ~11 fire opportunities over that window. The most likely culprit is the `newLines.length < 2` guard in `processTick` — for slow-paced speakers with infrequent CC line breaks the count rarely climbs above one in any 14-second window, so most ticks bail. A close second possibility is service-worker idle-death between the keepalive alarms (every 24 s, no-op listener) silently dropping state, though MV3 alarms *should* prevent that. **This is the single most user-visible issue: the sidebar looks broken because nothing appears, when really the gate is too tight.** Recommend either dropping the gate to `newLines.length >= 1` or replacing it with a "minutes of new transcript since last fire" check.

**The mode-tag warning has a coverage gap.** It only shows `⚠ no API key` when `backend === "anthropic" && !apiKey`. A user with a valid-format-but-actually-invalid key (the truncated-display copy-paste mistake we hit on the Work profile) or with a valid key but a $0 balance gets *no* warning in the meta line — only an `ERROR` card after the first fire, ~18 seconds in. Options page should `fetch` a 5-token validation call on Save and surface 401 / 402 / network errors immediately.

**The chitchat gate forces Haiku even when a user pays for a stronger model.** `background.js` line ~158 hard-codes `overrideModel: settings.backend === "anthropic" ? "claude-haiku-4-5" : undefined`. Defensible as a cost optimization, but a Sonnet/Opus customer might reasonably expect their selected model to be used for the gate too, or at least to be a setting.

**`m.youtube.com/*` is in `host_permissions` but absent from `content_scripts.matches`.** In practice desktop Chrome redirects mobile URLs to `www.youtube.com/watch?app=desktop&v=…` so I never saw the panel fail to inject, but the manifest is internally inconsistent — either drop the host permission or add an `m.youtube.com/watch*` content-script match for cases where the redirect doesn't fire.

**YouTube Shorts aren't supported.** `youtube.com/shorts/*` doesn't match `youtube.com/watch*`. When the user navigates to a Shorts URL with a regular video ID YouTube quietly redirects to `/watch`, so it accidentally works there, but real Shorts content stays on the `/shorts/` path and the panel never injects. If Shorts is a target audience (lots of opinion/news content lives there), the manifest needs `*://www.youtube.com/shorts/*` and `content.js` needs a different player selector — the Shorts UI doesn't use the same `.ytp-caption-window-container`.

**Status line lies after a CC toggle-off.** Once `attachObserver()` succeeds, the status sticks at `receiving captions · t=…` forever, because the observer is still attached to the (now empty) container. If a user turns CC *off* mid-video, the status should fall back to `waiting for captions…`. Trivial fix: poll `.ytp-caption-segment` count alongside the existing observer and downgrade the status when it stays at zero for >5 s.

**Background-tab silence is invisible.** Chrome's autoplay policy stops `<video>` playback in hidden tabs, so the side panel will sit at `receiving captions · t=00:00` forever if the user opens a YouTube link in a new background tab and walks away. The extension has no way to know this is happening. A subtle "tab is in background — bring it to focus to start" hint when `currentTime` hasn't advanced after N seconds would close the loop.

## Smaller code-review notes

The 1-second URL poll inside `content.js` (`setInterval(() => { if (location.href !== lastUrl) … }, 1000)`) is never cleared. Per-tab it's bounded so this isn't a leak in practice, but it would be cleaner to swap to a `navigation`-event observer or YouTube's `yt-navigate-finish` custom event.

`getCaptionText()` joins all visible segments with a single space. If YouTube renders two caption *windows* simultaneously (rare but possible with multi-channel audio or burned-in style captions), the result is concatenated nonsense. Worth namespacing by `.caption-window` parent before joining.

The save handler's prefix check (`!key.startsWith("sk-ant-")`) blocks the empty case but admits arbitrary nonsense as long as it leads with `sk-ant-`. Combine with the live-validation suggestion above.

`chrome.runtime.sendMessage(...).catch(() => {})` swallows errors silently in three places. Useful for the "tab closed" case but it currently masks all other failure modes. Recommend logging at `console.debug` so the service-worker console has breadcrumbs without spamming the page.

## Priority ranked

1. Loosen the `newLines.length < 2` guard (or replace with a transcript-progress check). This is the difference between "looks broken" and "feels alive".
2. Live API-key validation on Save.
3. Status-line CC-off downgrade.
4. Manifest cleanup: either honor `m.youtube.com` and `/shorts/`, or remove the dead host permission.
5. Surface background-tab stalls.
6. The smaller code-review items as cleanup.

## Sources

`chrome-extension/content.js`, `chrome-extension/background.js`, `chrome-extension/manifest.json`, `chrome-extension/options.js`.

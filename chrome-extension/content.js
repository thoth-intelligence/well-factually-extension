// Content script: runs on every youtube.com/watch page.
// Responsibilities:
//   1. Inject the side panel UI
//   2. Observe YouTube's caption DOM and forward each new caption line to the
//      service worker (which buffers and triggers fact-flag calls).
//   3. Render incoming cards from the service worker into the side panel.
//
// Captions only appear in the DOM when CC is on. If CC is off, this is silent.
// The user-facing warning lives in the side panel meta line.

(function () {
  if (window.__fcsBooted) return;
  window.__fcsBooted = true;

  // ───────────────────────────────────────────────────────────────────────
  // Side panel injection
  // ───────────────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "fcs-root";
  root.innerHTML = `
    <div class="fcs-head">
      <span class="fcs-title">🎬 Fact-Check</span>
      <span>
        <button id="fcs-export" title="Export session to markdown">export</button>
        <button id="fcs-clear" title="Clear all cards">clear</button>
        <button id="fcs-toggle" title="Collapse / expand">‹</button>
      </span>
    </div>
    <div class="fcs-meta">
      <span class="fcs-status" id="fcs-status">waiting for captions…</span>
      <span id="fcs-mode-tag">mode: factflag</span>
    </div>
    <div class="fcs-body" id="fcs-body">
      <div class="fcs-empty" id="fcs-empty">
        Turn on captions (the CC button on the YouTube player) and play the video.
        Cards will stream here.
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);

  const $ = (id) => document.getElementById(id);
  const body = $("fcs-body");
  const empty = $("fcs-empty");
  const status = $("fcs-status");
  const modeTag = $("fcs-mode-tag");

  $("fcs-toggle").addEventListener("click", () => {
    root.classList.toggle("collapsed");
    $("fcs-toggle").textContent = root.classList.contains("collapsed") ? "›" : "‹";
  });
  $("fcs-clear").addEventListener("click", () => {
    [...body.querySelectorAll(".fcs-card, .fcs-ghost")].forEach((n) => n.remove());
    body.appendChild(empty);
    cardCountSinceAd = 0;
    safeSend({ type: "RESET" });
  });
  $("fcs-export").addEventListener("click", exportSession);

  function fmtCue(s) {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60), r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function setStatus(text, live = false) {
    status.textContent = text;
    status.classList.toggle("fcs-live", live);
  }

  function clearEmpty() { if (empty.parentNode) empty.remove(); }

  // ───────────────────────────────────────────────────────────────────────
  // Affiliate / sponsored ad slot (v0.7.0)
  //
  // Reads three settings from chrome.storage.local with safe defaults:
  //   affiliateEnabled  (bool, default true)   — tag amazon.com citation URLs
  //   affiliateTag      (str, default "thothintellig-20")
  //   adFrequency       (int, default 4)       — show sponsored card every N
  //                                              cards. 0 disables.
  //
  // The tag rewriter + ad inventory live in affiliate.js (loaded before this
  // script via manifest content_scripts). Access them via
  // globalThis.__fcsAffiliate so this file stays a classic, non-module
  // content script.
  // ───────────────────────────────────────────────────────────────────────
  const __aff = globalThis.__fcsAffiliate;
  const affiliateSettings = {
    enabled: true,
    tag: __aff ? __aff.DEFAULT_AFFILIATE_TAG : "thothintellig-20",
    adFrequency: 4
  };
  let cardCountSinceAd = 0;
  let adsShown = 0;

  function loadAffiliateSettings() {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(
      {
        affiliateEnabled: true,
        affiliateTag: __aff ? __aff.DEFAULT_AFFILIATE_TAG : "thothintellig-20",
        adFrequency: 4
      },
      (s) => {
        affiliateSettings.enabled = !!s.affiliateEnabled;
        affiliateSettings.tag = (typeof s.affiliateTag === "string" && s.affiliateTag.trim()) || (__aff ? __aff.DEFAULT_AFFILIATE_TAG : "thothintellig-20");
        const f = parseInt(s.adFrequency, 10);
        affiliateSettings.adFrequency = (Number.isFinite(f) && f >= 0) ? f : 4;
      }
    );
  }
  loadAffiliateSettings();
  // Affiliate badge — small inline "$" marker shown next to a rewritten
  // citation link. Hover tooltip explains the disclosure. Kept on a single
  // shared className so the CSS scoping in sidebar.css handles styling.
  function buildAffiliateBadge() {
    const badge = document.createElement("span");
    badge.className = "fcs-affiliate-badge";
    badge.textContent = "$";
    badge.title = "Affiliate link — we may earn a commission if you buy. The classifier doesn't see ad inventory; confidence scores are unaffected.";
    badge.setAttribute("aria-label", "Affiliate link");
    return badge;
  }

  // buildAdCard — renders a single sponsored card identical in DOM shape to
  // the website's demo ad row (see assets/replica.css `.fcs-ad`). Anchor
  // gets `rel="sponsored noopener noreferrer"` per FTC + Chrome best
  // practice. Visible badge in the head pill so users see it's an ad even
  // before reading.
  function buildAdCard(ad) {
    const card = document.createElement("div");
    card.className = "fcs-card fcs-ad";
    const head = document.createElement("div");
    head.className = "fcs-ad-head";
    const pill = document.createElement("span");
    pill.className = "fcs-ad-pill";
    pill.textContent = "SPONSORED";
    const source = document.createElement("span");
    source.className = "fcs-ad-source";
    source.textContent = ad.sponsor || "";
    head.appendChild(pill);
    head.appendChild(source);
    const link = document.createElement("a");
    link.className = "fcs-ad-link";
    link.href = ad.url;
    link.target = "_blank";
    link.rel = "sponsored noopener noreferrer";
    const headline = document.createElement("div");
    headline.className = "fcs-ad-headline";
    headline.textContent = ad.headline || "";
    link.appendChild(headline);
    if (ad.tagline) {
      const tagline = document.createElement("div");
      tagline.className = "fcs-ad-tagline";
      tagline.textContent = ad.tagline;
      link.appendChild(tagline);
    }
    const footer = document.createElement("div");
    footer.className = "fcs-ad-footer";
    footer.textContent = ad.disclosure || "Affiliate link — we may earn a small commission if you buy.";
    card.appendChild(head);
    card.appendChild(link);
    card.appendChild(footer);
    return card;
  }

  // maybeSlotAd — called after every successful fact-card render. When the
  // running counter crosses the configured frequency, append a sponsored
  // card AFTER the just-added card and reset the counter. adFrequency=0
  // disables ads entirely.
  function maybeSlotAd() {
    if (!__aff || typeof __aff.pickAd !== "function") return;
    if (!affiliateSettings.enabled) return;
    const N = affiliateSettings.adFrequency;
    if (!N || N <= 0) return;
    cardCountSinceAd++;
    if (cardCountSinceAd < N) return;
    cardCountSinceAd = 0;
    const ad = __aff.pickAd(adsShown, affiliateSettings.tag);
    adsShown++;
    if (!ad) return;
    body.appendChild(buildAdCard(ad));
    body.scrollTop = body.scrollHeight;
  }

  // safeSend — wrap chrome.runtime.sendMessage so an orphaned content script
  // (extension reloaded mid-session, leaving this script's runtime invalid)
  // fails silently instead of throwing "Extension context invalidated."
  // Once we detect the runtime is gone, stop trying.
  //
  // v0.5.1 (R3): stamps every outbound message with the current epoch so the
  // background can echo it on the resulting CARD. Cards from a previous
  // video's epoch are dropped on receipt — see the CARD listener below.
  let runtimeAlive = true;
  let currentEpoch = 0;
  function safeSend(msg) {
    if (!runtimeAlive) return;
    try {
      const p = chrome.runtime.sendMessage({ ...msg, epoch: currentEpoch });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {
      runtimeAlive = false;
    }
  }

  // Jump the YouTube video to a timestamp ~3s before the flagged moment so the
  // viewer can re-watch the specific claim. Used by both addCard and addGhost.
  function seekTo(cue) {
    const video = getVideoEl();
    if (!video || cue == null || isNaN(cue)) return;
    video.currentTime = Math.max(0, cue - 3);
    video.play().catch(() => {});
  }

  // Confidence → traffic-light emoji + descriptive label for the hover tooltip.
  // Replaces the earlier colored-dot indicator (2026-05-14 → 2026-05-14 v2): a
  // 7px dot was too subtle for a sidebar people glance at while watching.
  const CONF_EMOJI = { 1: "🟢", 2: "🟡", 3: "🟠", 4: "🔴", 5: "🚨" };
  const CONF_LABEL = {
    1: "mild concern",
    2: "noteworthy gap",
    3: "meaningful issue",
    4: "strong misrepresentation",
    5: "clear factual error",
  };

  // ───────────────────────────────────────────────────────────────────────
  // Session export — serializes the current sidebar state to a downloadable
  // markdown file. Header button → exportSession(). Walks every .fcs-card in
  // the body (skipping ghosts and dismissed cards), pulls cue / tag /
  // confidence / claim / citation / pin / error flags directly off the DOM,
  // and assembles a deterministic markdown document. Includes a deep-link
  // back to the YouTube timestamp per card so a journalist can re-watch the
  // exact moment from the exported notes. No new permissions: download is
  // triggered via Blob + in-memory <a download>.
  // ───────────────────────────────────────────────────────────────────────
  function getVideoMeta() {
    const url = location.href;
    let videoId = "";
    try { videoId = new URL(url).searchParams.get("v") || ""; } catch (_e) {}
    let title = "";
    const titleEl = document.querySelector(
      "h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1",
    );
    if (titleEl) title = titleEl.textContent.trim();
    if (!title) title = document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    let channel = "";
    const chEl = document.querySelector(
      "ytd-channel-name a, #upload-info ytd-channel-name a, #owner #channel-name a",
    );
    if (chEl) channel = chEl.textContent.trim();
    return { url, videoId, title, channel };
  }

  function slugifyTitle(s) {
    return (s || "session")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session";
  }

  function nowStampLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // Read the tag text out of .fcs-tag-label without including the emoji span
  // (the emoji is rendered separately as a markdown line, not part of the tag).
  function readTagText(labelEl) {
    if (!labelEl) return "";
    let out = "";
    for (const node of labelEl.childNodes) {
      if (node.nodeType === 3) {
        out += node.textContent;
      } else if (node.nodeType === 1) {
        if (node.classList && node.classList.contains("fcs-conf-emoji")) continue;
        out += node.textContent || "";
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function readConfidenceFromClass(card) {
    for (const cls of card.classList) {
      const m = /^fcs-conf-(\d)$/.exec(cls);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function serializeCard(card) {
    if (card.classList.contains("dismissed")) return null;
    const cueRaw = card.dataset.cue;
    const cueNum = cueRaw != null && cueRaw !== "" ? parseFloat(cueRaw) : null;
    const cueStr = cueNum != null && !isNaN(cueNum) ? fmtCue(cueNum) : "";
    const isError = card.classList.contains("fcs-error");
    const pinned = card.classList.contains("pinned");
    const confidence = readConfidenceFromClass(card);
    const confEmoji = confidence != null ? CONF_EMOJI[confidence] || "" : "";
    const confLabel = confidence != null ? CONF_LABEL[confidence] || "" : "";
    const tag = readTagText(card.querySelector(".fcs-tag-label"));
    const claim = (card.querySelector(".fcs-text")?.textContent || "").trim();
    let citation = null;
    const citationLink = card.querySelector(".fcs-citation-link");
    if (citationLink) {
      const href = citationLink.getAttribute("href") || "";
      const linkText = (citationLink.textContent || "").replace(/\s*↗\s*$/, "").trim();
      const excerpt = (card.querySelector(".fcs-citation-excerpt")?.textContent || "").trim();
      if (href) citation = { url: href, title: linkText || href, excerpt };
    }
    let consensus = null;
    if (card.dataset.consensusBadge) {
      consensus = {
        badge: card.dataset.consensusBadge,
        level: card.dataset.consensusLevel || "",
        tally: card.dataset.consensusTally || "",
        summary: card.dataset.consensusSummary || "",
      };
    }
    return { cueNum, cueStr, isError, pinned, confidence, confEmoji, confLabel, tag, claim, citation, consensus };
  }

  function exportSession() {
    const meta = getVideoMeta();
    const cards = [...body.querySelectorAll(".fcs-card")]
      .map(serializeCard)
      .filter(Boolean);
    const headerTitle = meta.title || "YouTube video";
    const lines = [];
    lines.push(`# Fact-Check Session — ${headerTitle}`);
    lines.push("");
    lines.push(`- **Video:** [${headerTitle}](${meta.url})`);
    if (meta.channel) lines.push(`- **Channel:** ${meta.channel}`);
    lines.push(`- **Exported:** ${new Date().toISOString()}`);
    lines.push(`- **Cards:** ${cards.length}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    if (cards.length === 0) {
      lines.push("_No cards captured yet._");
      lines.push("");
    } else {
      for (const c of cards) {
        const emojiPart = c.confEmoji ? `${c.confEmoji} ` : (c.isError ? "⚠️ " : "");
        const cuePart = c.cueStr ? `${c.cueStr} — ` : "";
        const tagPart = c.tag || (c.isError ? "ERROR" : "FLAG");
        const pinPart = c.pinned ? " ★" : "";
        lines.push(`## ${emojiPart}${cuePart}${tagPart}${pinPart}`);
        lines.push("");
        if (c.confidence != null) {
          const label = c.confLabel ? ` — ${c.confLabel}` : "";
          lines.push(`*Confidence: ${c.confidence}/5${label}*`);
          lines.push("");
        }
        if (c.cueNum != null && !isNaN(c.cueNum) && meta.videoId) {
          const t = Math.max(0, Math.floor(c.cueNum));
          const watchUrl = `https://www.youtube.com/watch?v=${meta.videoId}&t=${t}s`;
          lines.push(`[Jump to ${c.cueStr} on YouTube](${watchUrl})`);
          lines.push("");
        }
        lines.push(c.claim || "_(no text)_");
        lines.push("");
        if (c.citation) {
          lines.push(`**Source:** [${c.citation.title}](${c.citation.url})`);
          if (c.citation.excerpt) {
            lines.push("");
            lines.push(`> ${c.citation.excerpt.replace(/\s*\n\s*/g, " ")}`);
          }
          lines.push("");
        }
        if (c.consensus) {
          const tally = c.consensus.tally ? ` (${c.consensus.tally})` : "";
          lines.push(`**Cross-model agreement:** ${c.consensus.badge}${tally}`);
          if (c.consensus.summary) {
            for (const sumLine of c.consensus.summary.split("\n")) {
              if (sumLine.trim()) lines.push(`- ${sumLine.trim()}`);
            }
          }
          lines.push("");
        }
      }
    }
    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `fact-check-${slugifyTitle(meta.title)}-${nowStampLocal()}.md`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(objUrl);
      a.remove();
    }, 200);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Pre-roll dossier — Feature 4 (2026-05-14). On YouTube watch-page load,
  // scrape video metadata (title, channel, description, view count, upload
  // date) and ask background.js for a one-paragraph briefing. Rendered as the
  // very first card via insertBefore. YouTube's DOM is lazy: retry up to 6×
  // every 800 ms (~4.8s total) until title+channel/description are present.
  // Re-fires on SPA navigation. Background returns null on missing key or
  // thin metadata, so a failed dossier is just absent — no error card.
  // ───────────────────────────────────────────────────────────────────────
  // Try each selector in order, return the first whose element has non-empty
  // text. Defends against YouTube DOM changes where an earlier-in-document
  // placeholder element matches but is empty (the original comma-separated
  // querySelector picked it and silently returned ""). See 2026-05-15 dossier
  // regression: #description yt-formatted-string existed as empty, querySelector
  // returned it, fetchDossier got an empty description → Haiku returned NONE →
  // no briefing card.
  function firstNonEmpty(...selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      const txt = el.textContent.replace(/\s+/g, " ").trim();
      if (txt) return txt;
    }
    return "";
  }

  function getDossierMeta() {
    const url = location.href;
    let videoId = "";
    try { videoId = new URL(url).searchParams.get("v") || ""; } catch (_e) {}
    let title = "";
    const titleEl = document.querySelector(
      "h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1",
    );
    if (titleEl) title = titleEl.textContent.trim();
    if (!title) title = document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    let channel = "";
    const chEl = document.querySelector(
      "ytd-channel-name a, #upload-info ytd-channel-name a, #owner #channel-name a",
    );
    if (chEl) channel = chEl.textContent.trim();
    // Description: prefer the richer text nodes first. `#expand` is the
    // "...more" toggle button (7 chars of label text) — listed last so it's
    // only used as a last resort if nothing better matched.
    const description = firstNonEmpty(
      "ytd-text-inline-expander #snippet-text",
      "#description-inline-expander",
      "#description yt-formatted-string",
      "#description #plain-text",
      "ytd-text-inline-expander #expand",
    );
    const viewCount = firstNonEmpty(
      "ytd-watch-info-text #info",
      "ytd-video-view-count-renderer",
      "span.view-count",
      "#info-container ytd-watch-info-text",
    ).slice(0, 200);
    const uploadDate = firstNonEmpty(
      "#info-strings yt-formatted-string",
      "ytd-video-primary-info-renderer #date",
    ).slice(0, 80);
    return { url, videoId, title, channel, description, viewCount, uploadDate };
  }

  let dossierRequested = false;
  function requestDossier(retriesLeft = 6) {
    if (dossierRequested) return;
    const meta = getDossierMeta();
    // Need at least a title and (channel OR description) for a useful briefing.
    if (meta.title && (meta.channel || meta.description)) {
      dossierRequested = true;
      safeSend({ type: "DOSSIER_REQUEST", meta });
      return;
    }
    if (retriesLeft <= 0) return;
    setTimeout(() => requestDossier(retriesLeft - 1), 800);
  }

  function addDossierCard(text, meta) {
    if (!text) return;
    clearEmpty();
    // If a stale dossier card is still in the DOM (e.g. SPA nav race), drop it
    const stale = body.querySelector(".fcs-dossier");
    if (stale) stale.remove();
    const card = document.createElement("div");
    card.className = "fcs-card fcs-dossier";
    card.innerHTML = `
      <div class="fcs-tag">
        <span class="fcs-tag-label">📋 BRIEFING</span>
        <span class="fcs-dossier-channel"></span>
      </div>
      <div class="fcs-text"></div>
      <div class="fcs-actions">
        <button class="fcs-dismiss" title="Dismiss">✕</button>
      </div>
    `;
    card.querySelector(".fcs-text").textContent = text;
    if (meta && meta.channel) {
      card.querySelector(".fcs-dossier-channel").textContent = meta.channel;
    }
    card.querySelector(".fcs-dismiss").addEventListener("click", () => card.remove());
    // Always prepend — the dossier should be the first card in the body,
    // above any caption-fired cards that may have already landed.
    body.insertBefore(card, body.firstChild);
  }

  function addCard({ tag, cue, text, error, confidence }) {
    clearEmpty();
    const card = document.createElement("div");
    // Card itself gets fcs-conf-N so CSS can tint the background (for 4-5)
    // and trigger the one-shot entry animation. Errors override.
    const confClass = !error && confidence != null ? ` fcs-conf-${confidence}` : "";
    card.className = "fcs-card" + (error ? " fcs-error" : "") + confClass;
    if (cue != null) card.dataset.cue = String(cue);
    const emojiHtml = !error && confidence != null
      ? `<span class="fcs-conf-emoji" title="Confidence: ${confidence}/5 — ${CONF_LABEL[confidence]}">${CONF_EMOJI[confidence]}</span>`
      : "";
    card.innerHTML = `
      <div class="fcs-tag">
        <span class="fcs-tag-label">${emojiHtml}${tag || (error ? "ERROR" : "")}</span>
        <span class="fcs-cue">${cue != null ? fmtCue(cue) : ""}</span>
      </div>
      <div class="fcs-text"></div>
      <div class="fcs-actions">
        <button class="fcs-pin" title="Pin">★</button>
        <button class="fcs-dismiss" title="Dismiss">✕</button>
      </div>
    `;
    card.querySelector(".fcs-text").textContent = text;
    card.querySelector(".fcs-pin").addEventListener("click", () => card.classList.toggle("pinned"));
    card.querySelector(".fcs-dismiss").addEventListener("click", () => card.remove());
    const cueEl = card.querySelector(".fcs-cue");
    if (cue != null && cueEl) {
      cueEl.classList.add("fcs-jumpable");
      cueEl.title = `Jump to ${fmtCue(cue)} (replays from ${fmtCue(Math.max(0, cue - 3))})`;
      cueEl.addEventListener("click", () => seekTo(cue));
    }
    body.appendChild(card);
    body.scrollTop = body.scrollHeight;
    // Slot in a sponsored card every Nth fact-flag. Errors don't count
    // (they aren't real classifications), but real cards do regardless of
    // confidence. See affiliate.js + sidebar.css for the ad-card schema.
    if (!error) maybeSlotAd();
  }

  // attachCitation — called when background.js delivers a citation for a card
  // that was sent earlier. Locates the card by data-cue and appends source +
  // excerpt. Uses textContent / href validation to defend against the model
  // returning hostile values in url/title/excerpt.
  function attachCitation(cue, citation) {
    if (!citation || !citation.url) return;
    if (!/^https?:\/\//i.test(citation.url)) return;
    // v0.5.1 (Sec3): defensive URL parse — Gemini grounding can return
    // 'https://' or other malformed strings that pass the regex but throw
    // inside the URL constructor. Throwing here would silently skip the
    // rest of the message-handling for this card.
    let hostname;
    try { hostname = new URL(citation.url).hostname; }
    catch (_e) { return; }
    const card = body.querySelector(`.fcs-card[data-cue="${String(cue)}"]`);
    if (!card) return;
    if (card.querySelector(".fcs-citation")) return; // already attached
    // v0.7.0: if affiliate tagging is enabled and the citation happens to
    // point at an Amazon storefront, rewrite the URL with our Associates
    // tag and surface a visible "$" badge so users can see at a glance
    // which links earn commission. Non-Amazon URLs pass through untouched.
    let renderUrl = citation.url;
    let isAffiliate = false;
    if (affiliateSettings.enabled && __aff && typeof __aff.tagAffiliateUrl === "function") {
      const tagged = __aff.tagAffiliateUrl(citation.url, affiliateSettings.tag);
      renderUrl = tagged.url;
      isAffiliate = tagged.isAffiliate;
    }
    const wrap = document.createElement("div");
    wrap.className = "fcs-citation";
    const link = document.createElement("a");
    link.href = renderUrl;
    link.target = "_blank";
    // rel=sponsored signals affiliate to crawlers + complies with FTC
    // disclosure guidance. Non-affiliate links stay with the original rel.
    link.rel = isAffiliate ? "sponsored noopener noreferrer" : "noopener noreferrer";
    link.className = "fcs-citation-link" + (isAffiliate ? " fcs-citation-affiliate" : "");
    link.textContent = citation.title || hostname;
    wrap.appendChild(link);
    if (isAffiliate) wrap.appendChild(buildAffiliateBadge());
    if (citation.excerpt) {
      const ex = document.createElement("div");
      ex.className = "fcs-citation-excerpt";
      ex.textContent = citation.excerpt;
      wrap.appendChild(ex);
    }
    card.appendChild(wrap);
  }

  // attachConsensus — Feature 6 (2026-05-14): when background.js completes the
  // cross-model consensus check for a conf 4-5 card, slot the agreement badge
  // into the card's tag bar (next to the existing tag-label / confidence-emoji
  // run). Tooltip carries the per-model breakdown so a curious viewer / judge
  // can see which leg said what. data-* attributes preserved on the card so
  // exportSession (Feature 1) can serialize the consensus into the .md.
  function attachConsensus(cue, payload) {
    if (!payload || !payload.badge) return;
    const card = body.querySelector(`.fcs-card[data-cue="${String(cue)}"]`);
    if (!card) return;
    if (card.querySelector(".fcs-consensus")) return; // idempotent
    const level = ["strong", "partial", "weak"].includes(payload.level) ? payload.level : "weak";
    const badge = document.createElement("span");
    badge.className = `fcs-consensus fcs-cn-${level}`;
    badge.textContent = payload.badge;
    // v9.5 vendor-label map. Background.js fireVoice only ever emits
    // vendors in {google, meta, xai, anthropic} and statuses in
    // {agree, disagree, unparseable, error}. v0.5.1 removed v9-era
    // openai/gemini-as-secondary fallback entries (Maint5/6) — they were
    // unreachable code, since the storage migration for those keys
    // happened on extension startup.
    const summary = (payload.details || []).map((d) => {
      const tag =
        d.vendor === "google"    ? "Gemini" :
        d.vendor === "meta"      ? "Llama"  :
        d.vendor === "xai"       ? "Grok"   :
        d.vendor === "anthropic" ? "Claude" :
        (d.model || d.vendor || "?");
      if (d.status === "error")       return `${tag}: error (${d.error || "unknown"})`;
      if (d.status === "unparseable") return `${tag}: unparseable verdict`;
      if (d.status === "agree")       return `${tag}: agrees`;
      if (d.status === "disagree")    return `${tag}: disagrees`;
      return `${tag}: ${d.status || "?"}`;
    }).join("\n");
    const headline = `Cross-vendor agreement: ${payload.agreed}/${payload.total} (incl. Gemini)`;
    badge.title = `${headline}\n\n${summary}`;
    // Slot the badge inside the tag-label run so it sits next to the emoji.
    const tagLabel = card.querySelector(".fcs-tag-label");
    if (tagLabel) tagLabel.appendChild(badge);
    else card.appendChild(badge);
    // Persist for export.
    card.dataset.consensusBadge = payload.badge;
    card.dataset.consensusLevel = level;
    card.dataset.consensusTally = `${payload.agreed}/${payload.total}`;
    card.dataset.consensusSummary = summary;
  }

  // ───────────────────────────────────────────────────────────────────────
  // In-video chyron overlay — Feature 7 (2026-05-15), v9 only. Renders a
  // bottom-of-player banner whenever a conf-4 or conf-5 flag lands. Appended
  // INSIDE the YouTube player container so the overlay follows the video
  // into fullscreen automatically. Sits at bottom: 56px so it floats above
  // YouTube's control bar — does not cover the main video frame. Auto-
  // dismisses after 8 seconds with a slide-down fade. New high-confidence
  // flags replace the existing banner (no stacking — stacking would block
  // the video, which is exactly the aesthetic concern this feature gates).
  // ───────────────────────────────────────────────────────────────────────
  let overlayDismissTimer = null;
  function showVideoOverlay({ cue, tag, text, confidence }) {
    if (confidence == null) return;
    const player = document.querySelector(
      "#movie_player, .html5-video-player, ytd-player #container",
    );
    if (!player) return; // no player visible (search page, etc.) — drop silently

    // Replace any existing overlay rather than stacking
    const stale = player.querySelector(".fcs-overlay");
    if (stale) stale.remove();
    if (overlayDismissTimer) {
      clearTimeout(overlayDismissTimer);
      overlayDismissTimer = null;
    }

    const overlay = document.createElement("div");
    overlay.className = `fcs-overlay fcs-overlay-conf-${confidence}`;
    if (cue != null) overlay.dataset.cue = String(cue);
    overlay.innerHTML = `
      <span class="fcs-overlay-emoji"></span>
      <span class="fcs-overlay-tag"></span>
      <span class="fcs-overlay-text"></span>
      <button class="fcs-overlay-dismiss" title="Dismiss">×</button>
    `;
    overlay.querySelector(".fcs-overlay-emoji").textContent = CONF_EMOJI[confidence] || "";
    overlay.querySelector(".fcs-overlay-tag").textContent = tag || "FLAG";
    overlay.querySelector(".fcs-overlay-text").textContent = text || "";

    const dismiss = () => {
      overlay.classList.add("fcs-overlay-leaving");
      setTimeout(() => overlay.remove(), 400);
      if (overlayDismissTimer) {
        clearTimeout(overlayDismissTimer);
        overlayDismissTimer = null;
      }
    };
    overlay.querySelector(".fcs-overlay-dismiss").addEventListener("click", dismiss);
    // Click-to-jump: tap the banner body (not the dismiss button) to seek
    // back to ~3s before the moment, same convention as the sidebar cues.
    overlay.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("fcs-overlay-dismiss")) return;
      if (cue != null) seekTo(cue);
    });

    player.appendChild(overlay);
    overlayDismissTimer = setTimeout(dismiss, 8000);
  }

  function addGhost({ kind, cue }) {
    // Don't render every SKIP / GATED — too noisy. Coalesce: only show
    // a ghost line if the most recent one is older than 60s of cue.
    const last = body.querySelector(".fcs-ghost:last-of-type");
    if (last && last.dataset.cue && cue - parseFloat(last.dataset.cue) < 60) return;
    clearEmpty();
    const g = document.createElement("div");
    g.className = "fcs-ghost";
    g.dataset.cue = String(cue);
    g.innerHTML = `<span class="fcs-cue">${fmtCue(cue)}</span><span>${kind === "gated" ? "off-topic" : "watching…"}</span>`;
    const gCueEl = g.querySelector(".fcs-cue");
    if (gCueEl) {
      gCueEl.classList.add("fcs-jumpable");
      gCueEl.title = `Jump to ${fmtCue(cue)} (replays from ${fmtCue(Math.max(0, cue - 3))})`;
      gCueEl.addEventListener("click", () => seekTo(cue));
    }
    body.appendChild(g);
    body.scrollTop = body.scrollHeight;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Caption observer
  // YouTube renders captions in .ytp-caption-window-container > .caption-window
  //   > .captions-text > .caption-visual-line > .ytp-caption-segment
  // The text updates incrementally as new captions arrive. We MutationObserver
  // the container and post new full-line text whenever it changes.
  // ───────────────────────────────────────────────────────────────────────
  function getVideoEl() { return document.querySelector("video.html5-main-video, video"); }

  function getCaptionText() {
    const segs = document.querySelectorAll(".ytp-caption-segment");
    if (!segs.length) return "";
    return [...segs].map((s) => s.textContent).join(" ").replace(/\s+/g, " ").trim();
  }

  let lastSentText = "";
  let lastSentAt = 0;

  function onCaptionUpdate() {
    const text = getCaptionText();
    if (!text) return;
    const video = getVideoEl();
    const currentTime = video ? video.currentTime : 0;
    const nowMs = Date.now();
    const textChanged = text !== lastSentText;
    const elapsedMs = nowMs - lastSentAt;
    // Send if text changed (after a 300ms debounce) OR every 1500ms as a
    // heartbeat. The 2026-05-14 change: previously we required text to differ,
    // which under-fired on slow-paced captioning. Background.js dedupes by
    // (text, time) so repeats with the same text and similar timestamp are
    // dropped harmlessly.
    if (textChanged) {
      if (elapsedMs < 300) return;
    } else {
      if (elapsedMs < 1500) return;
    }
    lastSentAt = nowMs;
    lastSentText = text;
    safeSend({ type: "CAPTION_LINE", line: { t: currentTime, s: "", x: text }, currentTime });
    setStatus(`receiving captions · t=${fmtCue(currentTime)}`, true);
  }

  // Heartbeat: ensure onCaptionUpdate runs at least every 2s during caption
  // playback, in case MutationObserver doesn't fire (caption window static
  // for several seconds with the same visible text). The function itself
  // applies the throttle, so this is safe.
  setInterval(onCaptionUpdate, 2000);

  // Set up the observer once the caption container exists. YouTube creates it
  // lazily after the user enables CC.
  function attachObserver() {
    const container = document.querySelector(".ytp-caption-window-container");
    if (!container) return false;
    const obs = new MutationObserver(onCaptionUpdate);
    obs.observe(container, { childList: true, subtree: true, characterData: true });
    setStatus("captions detected — watching", true);
    return true;
  }

  // Poll for the container until it shows up (user might enable CC any time).
  function waitForCaptions() {
    if (attachObserver()) return;
    const poll = setInterval(() => {
      if (attachObserver()) clearInterval(poll);
    }, 1000);
  }
  waitForCaptions();
  requestDossier();

  // ───────────────────────────────────────────────────────────────────────
  // Inbound messages from background
  // ───────────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "CARD") return;
    // v0.5.1 (R3): drop cards from a previous video. A YouTube SPA nav
    // bumps currentEpoch; any late-arriving citation/consensus card stamped
    // with the OLD epoch by background.js gets discarded silently — it
    // can't bind to a same-cue card in the new video's sidebar.
    if (msg.epoch != null && msg.epoch !== currentEpoch) return;
    if (msg.kind === "comment") {
      addCard({ tag: msg.tag, cue: msg.cue, text: msg.text, confidence: msg.confidence });
      // Feature 7 (v9): also fire the in-video chyron for high-stakes flags
      if (msg.confidence != null && msg.confidence >= 4) {
        showVideoOverlay({
          cue: msg.cue,
          tag: msg.tag,
          text: msg.text,
          confidence: msg.confidence,
        });
      }
    } else if (msg.kind === "error") {
      addCard({ tag: "ERROR", cue: msg.cue, text: msg.text, error: true });
    } else if (msg.kind === "skip" || msg.kind === "gated") {
      addGhost({ kind: msg.kind, cue: msg.cue });
    } else if (msg.kind === "citation") {
      attachCitation(msg.cue, msg.citation);
    } else if (msg.kind === "dossier") {
      addDossierCard(msg.text, msg.meta);
    } else if (msg.kind === "consensus") {
      attachConsensus(msg.cue, msg);
    }
  });

  // Reflect current settings in the meta bar
  function refreshModeTag() {
    chrome.storage.local.get(
      {
        mode: "factflag",
        backend: "vertex",
        gcpProjectId: "",
        vertexBearerToken: "",
        lmModel: "gemma-3-12b-it",
      },
      (s) => {
        let suffix = "";
        if (s.backend === "vertex" && (!s.gcpProjectId || !s.vertexBearerToken)) {
          suffix = "  ⚠ Vertex not configured";
        } else if (s.backend === "lmstudio") {
          suffix = `  · LM Studio (${s.lmModel})`;
        }
        modeTag.textContent = `mode: ${s.mode}${suffix}`;
      },
    );
  }
  refreshModeTag();
  chrome.storage.onChanged?.addListener((changes) => {
    if (changes.mode || changes.backend || changes.gcpProjectId || changes.vertexBearerToken || changes.lmModel) {
      refreshModeTag();
    }
    if (changes.affiliateEnabled || changes.affiliateTag || changes.adFrequency) {
      loadAffiliateSettings();
    }
  });

  // On navigation within YouTube SPA (clicking another video), reset state.
  // v0.5.1 (R3): bump currentEpoch BEFORE sending RESET so subsequent
  // sends carry the new epoch. Any cards still in-flight from the prior
  // video (citation, consensus) will arrive stamped with the OLD epoch
  // and get dropped by the CARD listener above.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSentText = "";
      currentEpoch++;
      cardCountSinceAd = 0;
      [...body.querySelectorAll(".fcs-card, .fcs-ghost")].forEach((n) => n.remove());
      body.appendChild(empty);
      setStatus("new video — waiting for captions…");
      safeSend({ type: "RESET" });
      // Re-attach observer since YouTube might've torn down the container
      waitForCaptions();
      // Re-fire the pre-roll dossier for the new video. The DOM has just
      // re-rendered, so requestDossier's retry loop handles the lazy fill-in.
      dossierRequested = false;
      requestDossier();
    }
  }, 1000);
})();

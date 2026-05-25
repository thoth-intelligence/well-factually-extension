// affiliate.js — Amazon Associates link tagging + sponsored ad inventory.
//
// Loaded as a classic content script (declared before content.js in
// manifest content_scripts), so it runs in the same isolated world and
// its definitions are visible via globalThis.__fcsAffiliate. Works in
// the service-worker context too — globalThis is the worker scope there.
//
// Two responsibilities:
//   1. tagAffiliateUrl(url, tag) — pass-through for non-Amazon URLs,
//      append `?tag=<tag>` (preserving any existing query string) for
//      amazon.com / amzn.to. Called from content.js's attachCitation
//      render path so any citation the classifier emits that happens to
//      point at Amazon gets tagged automatically. Non-Amazon citations
//      are untouched.
//   2. pickAd(idx) — rotates through a small in-source inventory of
//      affiliate book recommendations to slot into the sidebar every Nth
//      card. The inventory mirrors the books page on the website, so the
//      extension and the marketing site share a single reading list.
//
// Defaults are tuned so the affiliate path is opt-out, not opt-in:
//   - Tagging ON by default. User can disable per-install via Options
//     ("Enable affiliate link tagging" checkbox).
//   - Default tag = DEFAULT_AFFILIATE_TAG. Users can override in Options
//     ("Affiliate tag" text field) if they have their own Amazon
//     Associates membership and prefer to redirect commissions to it.
//   - Sponsored card every 4 fact-check cards by default. 0 disables.
//
// Disclosure: rewritten links carry `rel="sponsored noopener noreferrer"`
// plus a visible "$" badge so users can see at a glance which citations
// route through an affiliate program. FTC compliance + trust.

(function () {
  "use strict";
  if (globalThis.__fcsAffiliate) return; // idempotent across script reloads

  // Default Amazon Associates tag for the canonical build. This is a public
  // marketing identifier, not a secret — Associates tags are visible on
  // every URL tagged with them. Override per-install via Options if you
  // want commissions to flow to your own Associates account.
  const DEFAULT_AFFILIATE_TAG = "thothintellig-20";

  // Hosts we recognize as Amazon storefronts for tagging purposes.
  // Limited to the US Amazon domain + the canonical short-link host —
  // international Amazon locales (amazon.co.uk, amazon.de, etc.) use a
  // different Associates program per-locale and the US tag would be
  // rejected. Future work: detect locale and pick a regional tag.
  const AMAZON_HOST_PATTERNS = [
    /(^|\.)amazon\.com$/i,
    /^amzn\.to$/i,
  ];

  /**
   * tagAffiliateUrl
   * @param {string} url - any URL
   * @param {string} [tag] - Amazon Associates tag override
   * @returns {{ url: string, isAffiliate: boolean }}
   *   - url: original URL untouched if it's not an Amazon host, or the
   *     tagged URL with `?tag=<tag>` appended (replaces any existing tag).
   *   - isAffiliate: true if the URL was rewritten, false otherwise. The
   *     content script uses this to decide whether to render the badge.
   */
  function tagAffiliateUrl(url, tag) {
    const effectiveTag = (typeof tag === "string" && tag.trim()) || DEFAULT_AFFILIATE_TAG;
    if (typeof url !== "string" || !url) return { url, isAffiliate: false };
    let parsed;
    try { parsed = new URL(url); }
    catch (_e) { return { url, isAffiliate: false }; }
    const matches = AMAZON_HOST_PATTERNS.some((re) => re.test(parsed.hostname));
    if (!matches) return { url, isAffiliate: false };
    parsed.searchParams.set("tag", effectiveTag);
    return { url: parsed.toString(), isAffiliate: true };
  }

  // Sponsored book inventory — kept short and mirroring the
  // /fact-check-this page on the website. Each entry must carry: sponsor
  // (display name), headline (link text), tagline (subhead), url (raw
  // Amazon URL — gets tagged through tagAffiliateUrl at render time),
  // disclosure (FTC line).
  const AD_INVENTORY = [
    {
      sponsor: "Amazon · Affiliate",
      headline: "How to Lie With Statistics — Darrell Huff",
      tagline: "Classic primer on misleading data. The univariate-vs-multivariate trap is exactly what this book teaches you to spot.",
      url: "https://www.amazon.com/dp/0393310728/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "The Death of Expertise — Tom Nichols",
      tagline: "Why people increasingly reject experts. Useful frame for high-confidence/contested claims in any heated interview.",
      url: "https://www.amazon.com/dp/0190865978/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "Calling Bullshit — Carl Bergstrom & Jevin West",
      tagline: "Modern toolkit for spotting data abuse. Companion volume to Huff for the social-media era.",
      url: "https://www.amazon.com/dp/0525509186/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "Thinking, Fast and Slow — Daniel Kahneman",
      tagline: "The cognitive biases primer. Reading this once changes how you watch any debate.",
      url: "https://www.amazon.com/dp/0374533555/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "Factfulness — Hans Rosling",
      tagline: "Long-arc data on world progress. Counterweight to media-amplified pessimism without becoming pollyanna.",
      url: "https://www.amazon.com/dp/1250107814/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "The Demon-Haunted World — Carl Sagan",
      tagline: "Sagan's baloney-detection toolkit. Still the cleanest single statement of the scientific mindset.",
      url: "https://www.amazon.com/dp/0345409469/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "The Black Swan — Nassim Taleb",
      tagline: "Why your model's confidence is overstated whenever the tail matters. Good antidote to crisp Bayesian intuitions.",
      url: "https://www.amazon.com/dp/0865479186/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "Predictably Irrational — Dan Ariely",
      tagline: "Behavioral econ for non-economists. Pairs well with Kahneman for a one-two on systematic decision errors.",
      url: "https://www.amazon.com/dp/006124189X/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    },
    {
      sponsor: "Amazon · Affiliate",
      headline: "Noise — Daniel Kahneman, Olivier Sibony & Cass Sunstein",
      tagline: "Why expert judgments scatter even when the underlying truth doesn't move. Important read for anyone trusting a single source.",
      url: "https://www.amazon.com/dp/0300251270/",
      disclosure: "Affiliate link — we may earn a commission if you buy."
    }
  ];

  /**
   * pickAd — returns the inventory entry to show for the Nth ad slot.
   * Round-robins through AD_INVENTORY so a long session doesn't repeat
   * the same book until inventory is exhausted.
   *
   * @param {number} adIndex - 0-based index of this ad slot (not card count)
   * @param {string} [tag] - Amazon Associates tag for URL rewriting
   * @returns {object|null} { sponsor, headline, tagline, url, disclosure }
   */
  function pickAd(adIndex, tag) {
    if (!AD_INVENTORY.length) return null;
    const base = AD_INVENTORY[adIndex % AD_INVENTORY.length];
    const { url } = tagAffiliateUrl(base.url, tag);
    return Object.assign({}, base, { url });
  }

  globalThis.__fcsAffiliate = {
    DEFAULT_AFFILIATE_TAG,
    tagAffiliateUrl,
    pickAd,
    AD_INVENTORY
  };
})();

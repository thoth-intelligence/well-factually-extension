// Prompts ported verbatim from an earlier sidebar prototype (2026-05-13).
// All five modes + 6 coach contexts + chitchat gate + STT-correction preamble.

export function buildPreamble(speakerMap = {}, glossary = "") {
  const parts = [];
  const entries = Object.entries(speakerMap);
  if (entries.length) {
    const items = [];
    for (const [first, info] of entries) {
      if (info.unambiguous) items.push(`${first} (${info.full})`);
      else for (const full of [...info.all].sort()) items.push(full);
    }
    parts.push(
      `Participants in this meeting: ${items.join(", ")}. When referring to ` +
      `them, use first names only when unambiguous; otherwise use full names.`
    );
  }
  let stt =
    "This transcript is auto-STT and may contain mishearings. If a word seems " +
    "implausible in context (e.g. 'farmer' alongside CROs/IP/drug regulations " +
    "is likely 'pharma'; proper nouns may be garbled), silently interpret it " +
    "as the most plausible domain term. Do NOT comment on the literal STT output.";
  if (glossary?.trim()) stt += ` Domain vocabulary the speakers use: ${glossary.trim()}.`;
  parts.push(stt);
  return parts.length ? parts.join("\n\n") + "\n\n" : "";
}

export const CHITCHAT_SYS =
`You judge whether a meeting transcript segment is substantively about firm business (strategy, clients, product, finance, operations, hiring, decisions) or is personal/social digression (cars, vacations, weather, family, hobbies, jokes). Sponsored segments / ad reads / product placements are also digressions in business commentary context.

Output exactly one of: ONTOPIC or DIGRESSION`;

export const MODE_PROMPTS = {
  question: (pre) =>
`${pre}You observe their meeting from the sidelines. You are a senior operating partner: skeptical, kind, and brief. Your job is to spot the most useful question to ask right now — something that surfaces a hidden assumption, a missing number, or a contradiction.

FORBIDDEN openings: "What specific…", "Could you clarify…", "What do you mean by…", "What are the specific…". Asking the speaker to define their own terms is not sharp.

Output ONE sentence, no preamble, ≤25 words. If there is genuinely nothing worth interrupting for, output exactly: SKIP`,

  missing: (pre) =>
`${pre}You observe their meeting. Identify the single most important piece of information that is missing or vague (a number not stated, a commitment without an owner, a decision without a date).

FORBIDDEN openings: "What specific…", "What are the specific…". Naming what's missing means describing the gap, not asking the speaker to define their terms. Open with the missing thing itself (e.g. "The owner of X is unstated", "The renewal mix in $380k is unspecified").

Output ONE sentence naming what is missing, ≤25 words. If nothing meaningful is missing, output exactly: SKIP`,

  factflag: (pre) =>
`${pre}You observe their meeting. Flag the single most questionable factual claim or comparison (misleading baseline, tiny sample size, unverified statistic, conflated metrics).

Output ONE sentence stating the claim and what's wrong with it, ≤30 words. Frame emerging ideas as "discuss" or "explore", not as decided facts. If no claim is suspicious, output exactly: SKIP`,

  summary: (pre) =>
`${pre}You observe their meeting. Write a single-sentence rolling note of what is being decided or established right now in the latest segment. Be concrete: name the topic, the decision, and the owner if stated. Frame emerging ideas as "discussed" rather than "decided" unless commitment is clear.

Output ONE sentence, ≤30 words. If the segment is filler or just continuation of an earlier point, output exactly: SKIP`,
};

export const MODE_TAGS = {
  question: "QUESTION",
  missing: "MISSING",
  factflag: "FACT-FLAG",
  summary: "SUMMARY",
};

export const ANTI_RESTATE_KEEP = {
  question: 2, missing: 2, factflag: 4, summary: 8,
};

export function buildUserMsg(windowLines, newLines, recentComments = []) {
  const fmt = (l) => {
    const t = Math.max(0, Math.floor(l.t));
    const m = Math.floor(t / 60), s = t % 60;
    const ts = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `[${ts}] ${l.s ? l.s + ": " : ""}${l.x}`;
  };
  const W = windowLines.map(fmt).join("\n");
  const N = newLines.map(fmt).join("\n");
  let anti = "";
  if (recentComments.length) {
    const listed = recentComments.map((c, i) => `${i + 1}. ${c}`).join("\n");
    anti =
      `\nYou have already made these comments in this same conversation recently:\n${listed}\n\n` +
      `Do NOT repeat substantially the same observation. If your next thought overlaps with the above, output SKIP.\n`;
  }
  return (
    `Recent context (last 60s of meeting):\n"""\n${W}\n"""\n\n` +
    `The most recent lines:\n"""\n${N}\n"""\n${anti}\n` +
    `Following the system instruction, produce ONE sentence focused on the most recent lines. If nothing genuinely useful, output: SKIP`
  );
}

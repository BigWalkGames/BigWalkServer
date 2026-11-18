import {
  DataSet,
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from "obscenity";

/**
 * Typed chat (P43) is read by children, so every message is cleaned here on the
 * server before anyone sees it. The client never decides what is allowed.
 *
 * What it does, in order:
 *  1. Drops anything that is not a string, strips control and zero-width characters
 *     (they are used to sneak words past filters), folds full-width letters to normal
 *     ones, squeezes spaces and cuts the text to `maxLength`.
 *  2. Hides personal details and links with asterisks: web addresses, emails and
 *     anything that looks like a phone number.
 *  3. Hides letters spread out to dodge the filter ("f u c k", "f.u.c.k").
 *  4. Replaces swear words with asterisks (the same length as the word). The base list
 *     is the `obscenity` English list, which also copes with look-alike characters
 *     ("sh1t") and stretched letters ("fuuuck") without flagging innocent words
 *     ("Scunthorpe", "assassin").
 *
 * The extra list below is stricter than most games because of the audience: mild
 * swearing and wishing harm on someone are hidden too. Add or remove words in
 * EXTRA_WORDS; nothing else needs to change.
 */

/** Words hidden on top of the base list. Whole words only. */
const EXTRA_WORDS = [
  "damn", "dammit", "goddamn", "hell", "crap", "bastard", "kys",
  // swearing in short form
  "wtf", "stfu", "gtfo", "omfg", "fml",
  // other apps: asking a child to talk somewhere else is hidden too
  "snap", "snapchat", "insta", "instagram", "discord", "tiktok", "kik", "whatsapp", "telegram", "skype",
];
/** Phrases hidden on top of the base list (wishing harm on someone). */
const EXTRA_PHRASES = [
  "kill yourself",
  "kill your self",
  "kill urself",
  "kill ur self",
  "go die",
  "hang yourself",
];

const dataset = new DataSet<{ originalWord: string }>().addAll(englishDataset);
for (const word of [...EXTRA_WORDS, ...EXTRA_PHRASES]) {
  dataset.addPhrase((phrase) => phrase.setMetadata({ originalWord: word }).addPattern(pattern`|${word}|`));
}

const matcher = new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });
const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

/** Invisible characters and controls: removed so they cannot split a bad word. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

const stars = (text: string) => "*".repeat(text.length);

/** Web addresses, emails and phone-number-like digits. */
const PERSONAL_DETAILS: RegExp[] = [
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\S+@\S+\.\S+/g,
  /\b[a-z0-9-]+\.(?:com|net|org|io|gg|co|me|tv|ly|xyz|app|dev|info|biz|us|uk|ru|cn|ca|de)\b\S*/gi,
  /\d(?:[\s().-]*\d){6,}/g, // 7 or more digits, however they are spaced
];

/** A run of single letters or digits spread out with spaces, dots or dashes: "f u c k". */
const SPREAD_OUT = /\b[a-z0-9](?:[\s.\-_*]+[a-z0-9]){2,}\b/gi;

export function censorText(text: string): string {
  let out = text;
  for (const re of PERSONAL_DETAILS) out = out.replace(re, stars);
  out = out.replace(SPREAD_OUT, (run) => (matcher.hasMatch(run.replace(/[\s.\-_*]+/g, "")) ? stars(run) : run));
  return censor.applyTo(out, matcher.getAllMatches(out));
}

/**
 * The text of a chat message ready to send to both players, or null when there is nothing
 * to send (not a string, or empty once cleaned).
 */
export function cleanChatText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .slice(0, maxLength * 4) // a cap before the work below, so a huge message costs nothing
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  if (!text) return null;
  return censorText(text);
}

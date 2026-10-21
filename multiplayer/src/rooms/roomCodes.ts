import { randomInt } from "node:crypto";
import { matchMaker } from "colyseus";

/**
 * Room codes for Custom Game rooms (P26, P27).
 *
 * A code is the room's id: 5 characters from an alphabet with no look-alikes
 * (no 0/O, 1/I/L), so it is easy to read out loud or type. Codes are random, and
 * the lookup is rate limited, so guessing one is not practical.
 */

export const CUSTOM_ROOM = "custom_game";
export const CODE_LENGTH = 5;
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Cleans up what a player typed: trims, upper-cases, and rejects anything that can't be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** A random code that no open Custom Game room is using. */
export async function generateUniqueCode(): Promise<string> {
  const open = new Set((await matchMaker.query({ name: CUSTOM_ROOM })).map((room) => room.roomId));
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomCode();
    if (!open.has(code) && !closedCodes.has(code)) return code;
  }
  throw new Error("could not find a free room code");
}

// ------------------------------------------------------------------ closed codes
// Colyseus answers "not found" both for a code that never existed and for one whose
// room has closed. We remember closed codes for a while so players can be told "expired".

const closedCodes = new Map<string, number>();
const MAX_REMEMBERED = 10_000;

const memoryMs = () => {
  const minutes = Number(process.env.CLOSED_CODE_MEMORY_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
};

function purgeClosedCodes() {
  const cutoff = Date.now() - memoryMs();
  for (const [code, closedAt] of closedCodes) {
    if (closedAt < cutoff) closedCodes.delete(code);
    else break; // entries are in the order they were added, so the rest are newer
  }
}

export function rememberClosedCode(code: string) {
  purgeClosedCodes();
  closedCodes.delete(code);
  closedCodes.set(code, Date.now());
  if (closedCodes.size > MAX_REMEMBERED) {
    closedCodes.delete(closedCodes.keys().next().value as string);
  }
}

export function forgetClosedCodesForTests() {
  closedCodes.clear();
}

// ------------------------------------------------------------------ lookup

export type CodeStatus =
  | "open"      // the room exists and has a free seat
  | "full"      // the room exists but has two players, or its match already started
  | "expired"   // the room existed and has closed
  | "invalid";  // not a code, or no such room

export async function codeStatus(input: unknown): Promise<CodeStatus> {
  const code = normalizeCode(input);
  if (!code) return "invalid";

  const rooms = await matchMaker.query({ roomId: code });
  const room = rooms.find((r) => r.name === CUSTOM_ROOM);
  if (room) return room.locked || room.clients >= room.maxClients ? "full" : "open";

  purgeClosedCodes();
  return closedCodes.has(code) ? "expired" : "invalid";
}

// ------------------------------------------------------------------ rate limit

const lookups = new Map<string, number[]>();

/**
 * Allows a limited number of code lookups per minute so codes can't be guessed quickly.
 * `key` is the caller's IP when the server sits behind a proxy we trust (TRUST_PROXY=true),
 * otherwise one shared bucket, because a header the caller controls can't be trusted.
 */
export function allowLookup(key: string, now = Date.now()): boolean {
  const perMinute = Number(process.env.CODE_LOOKUPS_PER_MINUTE);
  const limit = Number.isFinite(perMinute) && perMinute > 0 ? perMinute : process.env.TRUST_PROXY === "true" ? 20 : 120;
  const recent = (lookups.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) {
    lookups.set(key, recent);
    return false;
  }
  recent.push(now);
  lookups.set(key, recent);
  if (lookups.size > 10_000) lookups.delete(lookups.keys().next().value as string);
  return true;
}

export function resetLookupLimitForTests() {
  lookups.clear();
}

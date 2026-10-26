import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { sharedServer } from "./helpers/server.js";
import { setResultSink, consoleResultSink, type MatchSummary } from "../src/results.js";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  allowLookup,
  codeStatus,
  forgetClosedCodesForTests,
  normalizeCode,
  resetLookupLimitForTests,
} from "../src/rooms/roomCodes.js";

/**
 * Custom Game tests (P26-P29): private room with a code, join by code, ready, leave/close.
 * Run with:  npm test
 */

const EVENTS = ["lobby", "match_found", "countdown", "go", "opponent_progress", "match_result", "opponent_left", "room_closed"];

type Logged = { type: string; data: any };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const count = (log: Logged[], type: string) => log.filter((e) => e.type === type).length;

function listen(room: any) {
  const log: Logged[] = [];
  for (const type of EVENTS) room.onMessage(type, (data: any) => log.push({ type, data }));
  return log;
}

async function waitFor(log: Logged[], type: string, ms = 8000, nth = 1) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = log.filter((entry) => entry.type === type);
    if (found.length >= nth) return found[nth - 1].data;
    await sleep(20);
  }
  throw new Error(`timed out waiting for "${type}"`);
}

describe("Custom Game", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  const saved: MatchSummary[] = [];

  before(async () => {
    process.env.COUNTDOWN_SECONDS = "1";
    process.env.MATCH_DURATION_SECONDS = "2";
    process.env.RESULT_CLOSE_DELAY_MS = "200";
    process.env.WORD_COUNT = "20";
    colyseus = await sharedServer();
    setResultSink({ async save(summary) { saved.push(summary); } });
  });
  after(() => setResultSink(consoleResultSink));
  beforeEach(async () => {
    process.env.CUSTOM_ROOM_IDLE_SECONDS = "600";
    saved.length = 0;
    forgetClosedCodesForTests();
    resetLookupLimitForTests();
    await colyseus.cleanup();
  });

  async function createRoom() {
    const room = await colyseus.sdk.create("custom_game");
    return { room, log: listen(room), code: room.roomId };
  }
  async function joinRoom(code: string) {
    const room = await colyseus.sdk.joinById(code);
    return { room, log: listen(room) };
  }

  it("creates a private room whose id is a short code with no look-alike characters", async () => {
    const { code } = await createRoom();
    assert.strictEqual(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `unexpected character ${ch}`);
    for (const bad of "01OIL") assert.ok(!code.includes(bad));
  });

  it("shows the code and both players in the lobby once the friend joins", async () => {
    const host = await createRoom();
    const first = await waitFor(host.log, "lobby");
    assert.strictEqual(first.code, host.code);
    assert.strictEqual(first.players.length, 1);

    const guest = await joinRoom(host.code);
    const both = await waitFor(guest.log, "lobby");
    assert.strictEqual(both.players.length, 2);
    assert.strictEqual((await waitFor(host.log, "lobby", 8000, 2)).players.length, 2);
  });

  it("keeps Quick Match players out of a private room", async () => {
    const host = await createRoom();
    const quick = await colyseus.sdk.joinOrCreate("quick_match");
    assert.notStrictEqual(quick.roomId, host.code);
    assert.strictEqual(host.room.connection.isOpen, true);
  });

  it("answers open, full, invalid and expired for a code", async () => {
    const host = await createRoom();
    assert.strictEqual(await codeStatus(host.code), "open");
    assert.strictEqual(await codeStatus(host.code.toLowerCase()), "open", "typed in lower case");
    assert.strictEqual(await codeStatus("ZZZZZ"), "invalid", "no such room");
    assert.strictEqual(await codeStatus("12"), "invalid", "not a code");
    assert.strictEqual(await codeStatus(undefined), "invalid");

    await joinRoom(host.code);
    assert.strictEqual(await codeStatus(host.code), "full");

    const lonely = await createRoom();
    await lonely.room.leave();
    await sleep(300);
    assert.strictEqual(await codeStatus(lonely.code), "expired");
  });

  it("serves the status over HTTP", async () => {
    const host = await createRoom();
    const response: any = await colyseus.sdk.http.get("/api/room-code/status", { query: { code: host.code } });
    assert.strictEqual(response.data.status, "open");
    const wrong: any = await colyseus.sdk.http.get("/api/room-code/status", { query: { code: "ZZZZZ" } });
    assert.strictEqual(wrong.data.status, "invalid");
  });

  it("rejects a wrong code and a third player", async () => {
    const host = await createRoom();
    await joinRoom(host.code);
    await assert.rejects(() => colyseus.sdk.joinById("ZZZZZ"));
    await assert.rejects(() => colyseus.sdk.joinById(host.code), "room is full");
  });

  it("limits how fast codes can be looked up", () => {
    process.env.CODE_LOOKUPS_PER_MINUTE = "3";
    try {
      resetLookupLimitForTests();
      assert.ok(allowLookup("a"));
      assert.ok(allowLookup("a"));
      assert.ok(allowLookup("a"));
      assert.ok(!allowLookup("a"), "fourth lookup in a minute is refused");
      assert.ok(allowLookup("b"), "other callers are not affected");
    } finally {
      delete process.env.CODE_LOOKUPS_PER_MINUTE;
    }
  });

  it("cleans up typed codes", () => {
    assert.strictEqual(normalizeCode("  abcde "), "ABCDE");
    assert.strictEqual(normalizeCode("ABCD"), null);
    assert.strictEqual(normalizeCode("ABCD0"), null, "0 is not in the alphabet");
    assert.strictEqual(normalizeCode(12345), null);
  });

  it("does not start until both players are ready, and ready can be undone", async () => {
    const host = await createRoom();
    const guest = await joinRoom(host.code);
    await waitFor(guest.log, "lobby");

    host.room.send("ready", { ready: true });
    await sleep(300);
    assert.strictEqual(count(host.log, "match_found"), 0, "one ready player is not enough");

    host.room.send("ready", { ready: false });
    guest.room.send("ready", { ready: true });
    await sleep(300);
    assert.strictEqual(count(host.log, "match_found"), 0, "un-readied player does not count");
  });

  it("races both players on the same words once both are ready, and saves the result with the room code", async () => {
    const host = await createRoom();
    const guest = await joinRoom(host.code);
    await waitFor(guest.log, "lobby");

    host.room.send("ready", { ready: true });
    guest.room.send("ready", { ready: true });

    const foundHost = await waitFor(host.log, "match_found");
    const foundGuest = await waitFor(guest.log, "match_found");
    assert.deepStrictEqual(foundHost.words, foundGuest.words, "same word bank");
    assert.strictEqual(foundHost.words.length, 20);
    await waitFor(host.log, "go");
    await waitFor(guest.log, "go");

    host.room.send("progress", { typed: 8, correct: 7 });
    guest.room.send("progress", { typed: 5, correct: 5 });
    assert.deepStrictEqual(await waitFor(guest.log, "opponent_progress"), { typed: 8, correct: 7 });

    const a = await waitFor(host.log, "match_result");
    const b = await waitFor(guest.log, "match_result");
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.winner, host.room.sessionId);

    await sleep(100);
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].mode, "custom");
    assert.strictEqual(saved[0].roomCode, host.code);
    assert.strictEqual(saved[0].winner, host.room.sessionId);
  });

  /** Both players ready -> race running. Settings are read when the room is created. */
  async function startRace(env: Record<string, string> = {}) {
    const old: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) { old[k] = process.env[k]; process.env[k] = v; }
    try {
      const host = await createRoom();
      const guest = await joinRoom(host.code);
      await waitFor(guest.log, "lobby");
      host.room.send("ready", { ready: true });
      guest.room.send("ready", { ready: true });
      const found = await waitFor(host.log, "match_found");
      await waitFor(host.log, "go");
      await waitFor(guest.log, "go");
      return { host, guest, words: found.words as string[] };
    } finally {
      for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }

  it("ends the race as soon as someone finishes the last word, and that player wins", async () => {
    const { host, guest, words } = await startRace({ MATCH_DURATION_SECONDS: "30", MAX_CHARS_PER_SECOND: "100000" });
    const total = words.join(" ").length;
    guest.room.send("progress", { typed: 10, correct: 9 });
    host.room.send("progress", { typed: total, correct: total });

    const result = await waitFor(guest.log, "match_result", 3000);
    assert.deepStrictEqual(result, await waitFor(host.log, "match_result", 3000));
    assert.strictEqual(result.winner, host.room.sessionId);
    assert.strictEqual(result.results[host.room.sessionId].correct, total);
    assert.ok(result.durationSeconds < 5, "reports the time the race really took");
    assert.ok(result.results[host.room.sessionId].wpm > 100, "speed uses the real elapsed time, not the 30 seconds");
    await sleep(100);
    assert.strictEqual(saved.length, 1);
  });

  it("also ends the race when every word is done but some letters were wrong", async () => {
    const { host, guest, words } = await startRace({ MATCH_DURATION_SECONDS: "30", MAX_CHARS_PER_SECOND: "100000" });
    const total = words.join(" ").length;
    const wordResults = "g".repeat(words.length - 1) + "r";
    host.room.send("progress", { typed: total, correct: total - 2, wordResults });
    const result = await waitFor(guest.log, "match_result", 3000);
    assert.strictEqual(result.winner, host.room.sessionId);
  });

  it("goes back to the lobby after the results so the same two players can rematch", async () => {
    const { host, guest } = await startRace();
    host.room.send("progress", { typed: 8, correct: 7 });
    guest.room.send("progress", { typed: 5, correct: 5 });
    await waitFor(host.log, "match_result");
    await sleep(300);
    const lobby = host.log.filter((e) => e.type === "lobby").pop()!.data;
    assert.deepStrictEqual(lobby.players.map((p: any) => p.ready), [false, false]);
    assert.strictEqual(await codeStatus(host.room.roomId), "full", "same code, still two players");

    host.room.send("ready", { ready: true });
    await sleep(300);
    assert.strictEqual(count(host.log, "match_found"), 1, "one ready player does not start the rematch");
    guest.room.send("ready", { ready: true });
    await waitFor(host.log, "match_found", 4000, 2);
    await waitFor(guest.log, "match_found", 4000, 2);
    await waitFor(host.log, "go", 4000, 2);
    host.room.send("progress", { typed: 6, correct: 6 });
    await waitFor(host.log, "match_result", 6000, 2);
    await sleep(100);
    assert.strictEqual(saved.length, 2, "each match saves its own result");
  });

  it("closes the room and tells the other player when someone leaves on the results screen", async () => {
    const { host, guest } = await startRace();
    await waitFor(host.log, "match_result");
    await sleep(300);
    await guest.room.leave();
    await waitFor(host.log, "opponent_left");
    await sleep(500);
    assert.strictEqual(await codeStatus(host.room.roomId), "expired");
  });

  it("closes the room and tells the other player when someone leaves the lobby", async () => {
    const host = await createRoom();
    const guest = await joinRoom(host.code);
    await waitFor(guest.log, "lobby");

    await guest.room.leave();
    await waitFor(host.log, "opponent_left");
    await sleep(500); // room closes after the short close delay
    assert.strictEqual(await codeStatus(host.code), "expired", "the code stops working");
    await assert.rejects(() => colyseus.sdk.joinById(host.code));
  });

  it("ends the match for the other player when someone drops mid-race", async () => {
    const host = await createRoom();
    const guest = await joinRoom(host.code);
    await waitFor(guest.log, "lobby");
    host.room.send("ready", { ready: true });
    guest.room.send("ready", { ready: true });
    await waitFor(host.log, "go");

    (guest.room.connection as any).transport.ws.terminate?.();
    guest.room.connection.close?.(4000);
    await waitFor(host.log, "opponent_left");
    assert.strictEqual(count(host.log, "match_result"), 0, "no result is recorded for an abandoned match");
    assert.strictEqual(saved.length, 0);
  });

  it("closes a lobby nobody starts", async () => {
    process.env.CUSTOM_ROOM_IDLE_SECONDS = "1";
    const host = await createRoom();
    const closed = await waitFor(host.log, "room_closed", 4000);
    assert.deepStrictEqual(closed, { reason: "idle" });
    await sleep(500);
    assert.strictEqual(await codeStatus(host.code), "expired");
  });
});

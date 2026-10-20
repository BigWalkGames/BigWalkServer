import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";

/**
 * Quick Match tests. They use the same joinOrCreate call the real client uses,
 * so they exercise pairing, not just the room class.
 *
 * Run with:  npm test
 */

const EVENTS = [
  "match_found",
  "countdown",
  "go",
  "opponent_progress",
  "match_result",
  "opponent_left",
  "no_opponent",
];

type Logged = { type: string; data: any };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Joins Quick Match and records every event the server sends. */
async function joinQuickMatch(colyseus: ColyseusTestServer<any>) {
  const room = await colyseus.sdk.joinOrCreate("quick_match");
  const log: Logged[] = [];
  for (const type of EVENTS) {
    room.onMessage(type, (data: any) => log.push({ type, data }));
  }
  return { room, log };
}

async function waitFor(log: Logged[], type: string, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = log.find((entry) => entry.type === type);
    if (found) return found.data;
    await sleep(20);
  }
  throw new Error(`timed out waiting for "${type}"`);
}

const count = (log: Logged[], type: string) => log.filter((e) => e.type === type).length;

describe("Quick Match", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    // Short timings so the tests run fast. The room reads these when it is created.
    process.env.COUNTDOWN_SECONDS = "1";
    process.env.MATCH_DURATION_SECONDS = "2";
    process.env.RESULT_CLOSE_DELAY_MS = "200";
    process.env.WORD_COUNT = "20";
    process.env.QUICK_MATCH_WAIT_SECONDS = "30";
    colyseus = await boot(appConfig);
  });
  after(async () => colyseus.shutdown());
  beforeEach(async () => {
    process.env.QUICK_MATCH_WAIT_SECONDS = "30";
    await colyseus.cleanup();
  });

  it("pairs two players, gives them the same words, and starts them together", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);

    const foundA = await waitFor(a.log, "match_found");
    const foundB = await waitFor(b.log, "match_found");

    assert.strictEqual(a.room.roomId, b.room.roomId, "both players are in the same room");
    assert.deepStrictEqual(foundA.words, foundB.words, "same word bank");
    assert.strictEqual(foundA.words.length, 20);
    assert.deepStrictEqual([...foundA.players].sort(), [a.room.sessionId, b.room.sessionId].sort());
    assert.strictEqual(foundA.durationSeconds, 2);

    await waitFor(a.log, "go");
    await waitFor(b.log, "go");
    assert.strictEqual(count(a.log, "countdown"), 1);
    assert.strictEqual(count(b.log, "countdown"), 1);
  });

  it("relays checked progress to the opponent only, then sends identical results", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "go");
    await waitFor(b.log, "go");

    a.room.send("progress", { typed: 8, correct: 7 });
    b.room.send("progress", { typed: 5, correct: 5 });

    const seenByB = await waitFor(b.log, "opponent_progress");
    assert.deepStrictEqual(seenByB, { typed: 8, correct: 7 });
    const seenByA = await waitFor(a.log, "opponent_progress");
    assert.deepStrictEqual(seenByA, { typed: 5, correct: 5 });
    assert.strictEqual(count(a.log, "opponent_progress"), 1, "a never gets its own progress back");

    const resultA = await waitFor(a.log, "match_result");
    const resultB = await waitFor(b.log, "match_result");
    assert.deepStrictEqual(resultA, resultB, "both players get the same result");

    assert.strictEqual(resultA.winner, a.room.sessionId);
    // 2-second race: wpm = (correct / 5) / (2 / 60)
    assert.deepStrictEqual(resultA.results[a.room.sessionId], { wpm: 42, accuracy: 88, correct: 7, typed: 8 });
    assert.deepStrictEqual(resultA.results[b.room.sessionId], { wpm: 30, accuracy: 100, correct: 5, typed: 5 });
  });

  it("calls it a draw when both players finish level", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "go");
    await waitFor(b.log, "go");

    a.room.send("progress", { typed: 4, correct: 4 });
    b.room.send("progress", { typed: 4, correct: 4 });

    const result = await waitFor(a.log, "match_result");
    assert.strictEqual(result.winner, null);
  });

  it("ignores progress that is impossible or malformed", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "go");
    await waitFor(b.log, "go");

    a.room.send("progress", { typed: 5000, correct: 5000 });   // faster than a human, and past the end of the text
    a.room.send("progress", { typed: 3, correct: 9 });         // more correct than typed
    a.room.send("progress", { typed: -1, correct: -1 });       // negative
    a.room.send("progress", { typed: 1.5, correct: 1 });       // not a whole number
    a.room.send("progress", { typed: "9", correct: "9" });     // wrong type
    a.room.send("progress", "hello");                          // not an object
    a.room.send("progress", { typed: 6, correct: 6 });         // the only valid one
    a.room.send("progress", { typed: 2, correct: 2 });         // counts can't go backwards

    await waitFor(b.log, "opponent_progress");
    await sleep(300);
    const progress = b.log.filter((e) => e.type === "opponent_progress").map((e) => e.data);
    assert.deepStrictEqual(progress, [{ typed: 6, correct: 6 }]);
  });

  it("relays wordResults to the opponent and ignores invalid ones", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "go");
    await waitFor(b.log, "go");

    a.room.send("progress", { typed: 6, correct: 5, wordResults: "gx" });   // bad letter
    a.room.send("progress", { typed: 6, correct: 5, wordResults: 5 });      // wrong type
    a.room.send("progress", { typed: 6, correct: 5, wordResults: "g".repeat(7) }); // more words than typed letters
    a.room.send("progress", { typed: 6, correct: 5, wordResults: "gr" });   // the only valid one

    await waitFor(b.log, "opponent_progress");
    await sleep(300);
    const progress = b.log.filter((e) => e.type === "opponent_progress").map((e) => e.data);
    assert.deepStrictEqual(progress, [{ typed: 6, correct: 5, wordResults: "gr" }]);
  });

  it("tells a lone player when nobody joined, then closes the room", async () => {
    process.env.QUICK_MATCH_WAIT_SECONDS = "1";
    const a = await joinQuickMatch(colyseus);

    const data = await waitFor(a.log, "no_opponent", 4000);
    assert.strictEqual(data.waitedSeconds, 1);
    assert.strictEqual(count(a.log, "match_found"), 0);
  });

  it("ends the match for the other player when someone leaves mid-race", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "go");
    await waitFor(b.log, "go");

    await b.room.leave();

    await waitFor(a.log, "opponent_left", 4000);
    assert.strictEqual(count(a.log, "match_result"), 0, "no result for a match that was abandoned");
  });

  it("ends the match when someone leaves during the countdown", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "match_found");

    await b.room.leave();

    await waitFor(a.log, "opponent_left", 4000);
    await sleep(1500);
    assert.strictEqual(count(a.log, "go"), 0, "the race never starts");
  });

  it("treats a dropped connection like a leave", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    await waitFor(a.log, "go");
    await waitFor(b.log, "go");

    // Close the socket without sending a "leave" message (like losing wifi).
    const ws = (b.room.connection as any).transport.ws;
    if (typeof ws.terminate === "function") ws.terminate();
    else ws.close(3999); // browsers only allow 1000 or 3000-4999

    await waitFor(a.log, "opponent_left", 6000);
  });

  it("puts a third player in a new room instead of the full one", async () => {
    const a = await joinQuickMatch(colyseus);
    const b = await joinQuickMatch(colyseus);
    const c = await joinQuickMatch(colyseus);

    assert.strictEqual(a.room.roomId, b.room.roomId);
    assert.notStrictEqual(c.room.roomId, a.room.roomId);
    await sleep(300);
    assert.strictEqual(count(c.log, "match_found"), 0, "c is still waiting for an opponent");
  });
});

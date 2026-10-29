import assert from "assert";

import { supabaseResultSink } from "../src/supabaseResultSink.js";
import type { MatchSummary } from "../src/results.js";

/**
 * The Supabase sink, with a fake fetch so no Supabase project is involved.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(status = 204, body = "") {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : body, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const summary = (overrides: Partial<MatchSummary> = {}): MatchSummary => ({
  matchId: "11111111-1111-4111-8111-111111111111",
  mode: "quick_match",
  winner: "s1",
  results: {
    s1: { wpm: 62, accuracy: 95, correct: 100, typed: 105, errors: 0 },
    s2: { wpm: 48, accuracy: 88, correct: 80, typed: 91, errors: 2 },
  },
  accounts: { s1: "user-a", s2: "user-b" },
  durationSeconds: 30,
  finishedAt: "2026-10-29T00:00:00.000Z",
  ...overrides,
});

describe("Supabase result sink", () => {
  it("calls save_multiplayer_result with account ids and accuracy as 0-1", async () => {
    const { calls, fetchFn } = fakeFetch();
    await supabaseResultSink("https://example.supabase.co/", "secret", fetchFn).save(summary());

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "https://example.supabase.co/rest/v1/rpc/save_multiplayer_result");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.strictEqual(headers.apikey, "secret");
    assert.strictEqual(headers.Authorization, "Bearer secret");
    assert.deepStrictEqual(JSON.parse(calls[0].init.body as string), {
      p_match_id: "11111111-1111-4111-8111-111111111111",
      p_mode: "quick_match",
      p_room_code: null,
      p_finished_at: "2026-10-29T00:00:00.000Z",
      p_winner: "user-a",
      p_player1: "user-a",
      p_wpm1: 62,
      p_accuracy1: 0.95,
      p_player2: "user-b",
      p_wpm2: 48,
      p_accuracy2: 0.88,
    });
  });

  it("sends a draw as no winner, and the room code for custom games", async () => {
    const { calls, fetchFn } = fakeFetch();
    await supabaseResultSink("https://example.supabase.co", "secret", fetchFn)
      .save(summary({ winner: null, mode: "custom", roomCode: "K7M2Q" }));

    const body = JSON.parse(calls[0].init.body as string);
    assert.strictEqual(body.p_winner, null);
    assert.strictEqual(body.p_mode, "custom");
    assert.strictEqual(body.p_room_code, "K7M2Q");
  });

  it("does not call Supabase when a player has no account id", async () => {
    const { calls, fetchFn } = fakeFetch();
    await supabaseResultSink("https://example.supabase.co", "secret", fetchFn)
      .save(summary({ accounts: { s1: "user-a" } }));
    assert.strictEqual(calls.length, 0);
  });

  it("throws when Supabase rejects the call, so saveResult logs it", async () => {
    const { fetchFn } = fakeFetch(403, '{"message":"permission denied"}');
    await assert.rejects(
      supabaseResultSink("https://example.supabase.co", "secret", fetchFn).save(summary()),
      /save_multiplayer_result failed \(403\)/
    );
  });
});

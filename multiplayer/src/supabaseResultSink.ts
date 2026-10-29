import type { MatchSummary, ResultSink } from "./results.js";

/**
 * Saves finished matches to Supabase for the Match History page.
 *
 * Calls the `save_multiplayer_result` database function, which writes one row per player
 * to `users.multiplayer_results`. Only the service role may call it, so this needs the
 * project's secret key (SUPABASE_SECRET_KEY, or the legacy service_role key). Keep that
 * key on the server only.
 *
 * Accuracy is sent as 0-1 (the database stores it that way); the room reports 0-100.
 */

const TIMEOUT_MS = 10_000;

export function supabaseResultSink(url: string, secretKey: string, fetchFn: typeof fetch = fetch): ResultSink {
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/rpc/save_multiplayer_result`;

  return {
    async save(summary: MatchSummary) {
      const [a, b] = Object.keys(summary.results);
      const accountA = summary.accounts[a];
      const accountB = summary.accounts[b];
      if (!accountA || !accountB) {
        console.warn("match", summary.matchId, "not saved: a player has no account id");
        return;
      }

      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_match_id: summary.matchId,
          p_mode: summary.mode,
          p_room_code: summary.roomCode ?? null,
          p_finished_at: summary.finishedAt,
          p_winner: summary.winner === null ? null : summary.accounts[summary.winner],
          p_player1: accountA,
          p_wpm1: summary.results[a].wpm,
          p_accuracy1: summary.results[a].accuracy / 100,
          p_player2: accountB,
          p_wpm2: summary.results[b].wpm,
          p_accuracy2: summary.results[b].accuracy / 100,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`save_multiplayer_result failed (${response.status}): ${await response.text()}`);
      }
    },
  };
}

/**
 * Where finished matches are reported (P28: "save Custom Game results with the room
 * code as how the match was made").
 *
 * The room only talks to this small interface. The default sink just logs, so the
 * server needs no database access yet. When saving to Supabase is agreed (it needs a
 * server-side key with limited rights), write a sink that implements `ResultSink`
 * and pass it to `setResultSink()` in `app.config.ts`. The rooms do not change.
 */
export interface PlayerResult {
  wpm: number;
  accuracy: number;
  correct: number;
  typed: number;
}

export interface MatchSummary {
  /** How the match was made. */
  mode: "quick_match" | "custom";
  /** The room code, for custom games only. */
  roomCode?: string;
  /** Session id of the winner, or null for a draw. */
  winner: string | null;
  results: Record<string, PlayerResult>;
  durationSeconds: number;
  finishedAt: string;
}

export interface ResultSink {
  save(summary: MatchSummary): Promise<void>;
}

export const consoleResultSink: ResultSink = {
  async save(summary) {
    console.log("match finished", JSON.stringify(summary));
  },
};

let sink: ResultSink = consoleResultSink;

export function setResultSink(next: ResultSink) {
  sink = next;
}

/** Saves a result. A failure is logged and never breaks the match. */
export async function saveResult(summary: MatchSummary) {
  try {
    await sink.save(summary);
  } catch (error) {
    console.error("could not save match result", error);
  }
}

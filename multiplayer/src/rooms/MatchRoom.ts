import { randomUUID } from "node:crypto";
import { Room, Client } from "colyseus";
import { pickWords } from "./words.js";
import { saveResult, type PlayerResult } from "../results.js";
import { authenticate, type AuthUser } from "../auth.js";

/**
 * The race itself, shared by Quick Match and Custom Game rooms.
 *
 *   waiting --> countdown --> racing --> finished
 *
 * A subclass decides WHEN a match starts (Quick Match: as soon as two players are in;
 * Custom Game: when both players are ready) by calling `startMatch()`.
 *
 * Messages the SERVER sends once a match starts (the web client listens for these):
 *   match_found        { players, words, countdownSeconds, durationSeconds }
 *   countdown          { seconds }              3, 2, 1
 *   go                 { durationSeconds }      start typing now
 *   opponent_progress  { typed, correct, wordResults? }  only the OTHER player gets this
 *   match_result       { winner, results }      winner = sessionId, or null for a draw
 *   opponent_left      {}                       opponent left or disconnected
 *
 * Message the CLIENT sends:
 *   progress           { typed, correct }       cumulative counts since "go"
 */

export type Phase = "waiting" | "countdown" | "racing" | "finished";
export type Timer = ReturnType<Room["clock"]["setTimeout"]>;

interface PlayerStats {
  typed: number;   // total keystrokes so far
  correct: number; // correct characters so far
  errors: number;  // letters wrong on the board right now (can go down when the player backspaces)
}

interface ProgressMessage {
  typed: number;
  correct: number;
  /** Optional. One letter per completed word, in order: "g" no mistakes, "r" had a mistake. */
  wordResults?: string;
  /** Optional (older clients do not send it, which counts as 0). Letters currently wrong. */
  errors?: number;
}

/** Read settings from the environment when a room is created (never from clients). */
export function readConfig() {
  const num = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    waitSeconds: num("QUICK_MATCH_WAIT_SECONDS", 30),
    countdownSeconds: Math.floor(num("COUNTDOWN_SECONDS", 3)),
    durationSeconds: num("MATCH_DURATION_SECONDS", 30),
    wordCount: Math.floor(num("WORD_COUNT", 100)),
    // Fastest plausible typing speed. 25 chars/second is about 300 WPM.
    maxCharsPerSecond: num("MAX_CHARS_PER_SECOND", 25),
    // Delay before the room closes after results, so both clients receive them.
    closeDelayMs: num("RESULT_CLOSE_DELAY_MS", 1000),
    // Custom Game: how long a lobby can sit without starting a match before it closes.
    customIdleSeconds: num("CUSTOM_ROOM_IDLE_SECONDS", 600),
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export abstract class MatchRoom extends Room {
  maxClients = 2; // 1v1

  // Spam guard: a client that sends more than this per second is disconnected.
  maxMessagesPerSecond = 30;

  protected config = readConfig();
  protected phase: Phase = "waiting";
  protected players = new Map<string, PlayerStats>();
  /** Supabase user id per session id, taken when the match starts. */
  protected accounts: Record<string, string> = {};
  protected matchId = "";
  protected totalChars = 0;
  protected wordTotal = 0;
  protected startedAt = 0;
  protected countdownTimer?: Timer;
  protected raceTimer?: Timer;

  /** How the match was made, reported with the result. */
  protected abstract readonly mode: "quick_match" | "custom";

  /** The room code for custom games, reported with the result. */
  protected roomCode?: string;

  messages = {
    progress: (client: Client, message: ProgressMessage) => {
      this.handleProgress(client, message);
    },
  };

  /**
   * Checks the player's Supabase token when REQUIRE_AUTH is on (see src/auth.ts).
   * With it off (local development and tests) everyone may join.
   */
  async onAuth(client: Client, options: any) {
    return authenticate(options?.token);
  }

  /** Subclasses call this first thing in their own onCreate. */
  protected readSettings() {
    this.config = readConfig();
  }

  /** Called when someone leaves before the match has started. Default: nothing. */
  protected onLeaveBeforeMatch(client: Client) {}

  // P17: leaving mid-match ends the match for the remaining player.
  onLeave(client: Client, code?: number) {
    console.log(client.sessionId, "left!", code);
    if (this.phase === "countdown" || this.phase === "racing") {
      this.phase = "finished";
      this.countdownTimer?.clear();
      this.raceTimer?.clear();
      this.broadcast("opponent_left", {});
      this.clock.setTimeout(() => this.disconnect(), this.config.closeDelayMs);
    } else if (this.phase === "waiting") {
      this.onLeaveBeforeMatch(client);
    }
  }

  onDispose() {
    console.log(this.mode, "room", this.roomId, "disposing...");
  }

  // ---------------------------------------------------------------- match flow

  /** P19: both players get the same words and the same countdown. */
  protected startMatch() {
    this.lock(); // nobody else can join this match
    this.phase = "countdown";

    const { countdownSeconds, durationSeconds, wordCount } = this.config;
    const words = pickWords(wordCount);
    this.totalChars = words.join(" ").length;
    this.wordTotal = words.length;

    const ids = this.clients.map((c) => c.sessionId);
    for (const id of ids) {
      this.players.set(id, { typed: 0, correct: 0, errors: 0 });
    }
    this.matchId = randomUUID();
    this.accounts = Object.fromEntries(
      this.clients.map((c) => [c.sessionId, (c.auth as AuthUser).id])
    );

    this.broadcast("match_found", {
      players: ids,
      words,
      countdownSeconds,
      durationSeconds,
    });

    let remaining = countdownSeconds;
    this.broadcast("countdown", { seconds: remaining });
    this.countdownTimer = this.clock.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        this.broadcast("countdown", { seconds: remaining });
        return;
      }
      this.countdownTimer?.clear();
      this.beginRace();
    }, 1000);
  }

  private beginRace() {
    this.phase = "racing";
    this.startedAt = Date.now();
    this.broadcast("go", { durationSeconds: this.config.durationSeconds });
    this.raceTimer = this.clock.setTimeout(
      () => this.finishMatch(),
      this.config.durationSeconds * 1000
    );
  }

  /** The server counts the time, so a client can't stretch or shrink the race. */
  protected handleProgress(client: Client, message: ProgressMessage) {
    if (this.phase !== "racing") return;

    const stats = this.players.get(client.sessionId);
    if (!stats) return;

    const typed = message?.typed;
    const correct = message?.correct;
    const errors = message?.errors ?? 0; // missing = older client

    // Basic server-side checks. Anything that fails is ignored, never trusted.
    if (!isCount(typed) || !isCount(correct)) return;
    if (correct > typed) return;                                   // can't be more correct than typed
    if (typed < stats.typed || correct < stats.correct) return;    // counts only go up
    if (correct > this.totalChars) return;                         // can't pass the end of the text
    // errors is checked on its own: unlike typed and correct it can go down (backspace fixes a mistake).
    if (!isCount(errors) || errors > typed || errors > this.totalChars) return;

    const elapsedSeconds = (Date.now() - this.startedAt) / 1000;
    const maxPlausible = Math.floor(elapsedSeconds * this.config.maxCharsPerSecond) + 10;
    if (typed > maxPlausible) return;                              // faster than a human can type

    // wordResults is only for the opponent's progress bar. It is checked, never trusted.
    const wordResults = message.wordResults;
    if (wordResults !== undefined) {
      if (typeof wordResults !== "string" || !/^[gr]*$/.test(wordResults)) return;
      if (wordResults.length > this.wordTotal || wordResults.length > typed) return;
    }

    stats.typed = typed;
    stats.correct = correct;
    stats.errors = errors;

    // Send the checked values to the other player, not the raw message.
    this.broadcast(
      "opponent_progress",
      wordResults === undefined ? { typed, correct } : { typed, correct, wordResults },
      { except: client }
    );

    // Finishing the last word ends the race right away. A player has finished when every
    // character is right, or when the client says every word is done and has typed at least
    // as many keys as the text has characters. The winner is still decided by finishMatch.
    const typedAllWords =
      wordResults !== undefined && wordResults.length === this.wordTotal && typed >= this.totalChars;
    if (correct >= this.totalChars || typedAllWords) this.finishMatch(true);
  }

  /**
   * P21: results are computed here, so both players get the same answer.
   * `early` is true when a player finished the whole text before the time was up. Speeds are
   * then worked out over the time the race really took.
   */
  private finishMatch(early = false) {
    if (this.phase !== "racing") return;
    this.phase = "finished";
    this.raceTimer?.clear();

    const { durationSeconds } = this.config;
    const elapsed = (Date.now() - this.startedAt) / 1000;
    const seconds = early ? Math.min(durationSeconds, Math.max(1, elapsed)) : durationSeconds;
    const minutes = seconds / 60;
    const results: Record<string, PlayerResult> = {};
    for (const [id, stats] of this.players) {
      // Net WPM: gross speed (every keystroke counts, 5 per word) minus the errors left
      // uncorrected, per minute. Never below 0.
      const gross = stats.typed / 5 / minutes;
      results[id] = {
        wpm: Math.max(0, Math.round(gross - stats.errors / minutes)),
        accuracy: stats.typed > 0 ? Math.round((stats.correct / stats.typed) * 100) : 0,
        correct: stats.correct,
        typed: stats.typed,
        errors: stats.errors,
      };
    }

    // Winner: highest Net WPM (the same number the players see). Tie: better accuracy.
    // Still tied: draw (null).
    const [a, b] = [...this.players.keys()];
    let winner: string | null = null;
    if (a !== undefined && b !== undefined) {
      const ra = results[a];
      const rb = results[b];
      if (ra.wpm !== rb.wpm) {
        winner = ra.wpm > rb.wpm ? a : b;
      } else if (ra.accuracy !== rb.accuracy) {
        winner = ra.accuracy > rb.accuracy ? a : b;
      }
    }

    const reported = Math.round(seconds * 10) / 10;
    this.broadcast("match_result", { winner, results, durationSeconds: reported });
    void saveResult({
      matchId: this.matchId,
      mode: this.mode,
      roomCode: this.roomCode,
      winner,
      results,
      accounts: this.accounts,
      durationSeconds: reported,
      finishedAt: new Date().toISOString(),
    });
    this.onMatchFinished();
  }

  /** What happens to the room once the results are out. Quick Match: it closes. */
  protected onMatchFinished() {
    this.clock.setTimeout(() => this.disconnect(), this.config.closeDelayMs);
  }
}

import { Room, Client, CloseCode } from "colyseus";
import { pickWords } from "./words.js";

/**
 * Quick Match: a 1v1 race
 *
 * Flow:   waiting --> countdown --> racing --> finished
 *
 * Messages the SERVER sends (the web client listens for these):
 *   match_found        { players, words, countdownSeconds, durationSeconds }
 *   countdown          { seconds }              3, 2, 1
 *   go                 { durationSeconds }      start typing now
 *   opponent_progress  { typed, correct }       only the OTHER player gets this
 *   match_result       { winner, results }      winner = sessionId, or null for a draw
 *   opponent_left      {}                       opponent left or disconnected
 *   no_opponent        { waitedSeconds }        nobody joined in time
 *
 * Message the CLIENT sends:
 *   progress           { typed, correct }       cumulative counts since "go"
 */

type Phase = "waiting" | "countdown" | "racing" | "finished";
type Timer = ReturnType<Room["clock"]["setTimeout"]>;

interface PlayerStats {
  typed: number;   // total keystrokes so far
  correct: number; // correct characters so far
}

interface ProgressMessage {
  typed: number;
  correct: number;
}

/** Read settings from the environment when a room is created (never from clients). */
function readConfig() {
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
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export class QuickMatchRoom extends Room {
  maxClients = 2; // 1v1: a third player gets their own new room

  // Spam guard: a client that sends more than this per second is disconnected.
  maxMessagesPerSecond = 30;

  private config = readConfig();
  private phase: Phase = "waiting";
  private players = new Map<string, PlayerStats>();
  private totalChars = 0;
  private startedAt = 0;
  private waitTimer?: Timer;
  private countdownTimer?: Timer;
  private raceTimer?: Timer;

  messages = {
    progress: (client: Client, message: ProgressMessage) => {
      this.handleProgress(client, message);
    },
  };

  onCreate(options: any) {
    this.config = readConfig();
    console.log("quick match room", this.roomId, "created");

    // P15: if nobody joins in time, tell the player and close the room.
    this.waitTimer = this.clock.setTimeout(() => {
      if (this.phase !== "waiting") return;
      this.phase = "finished";
      this.broadcast("no_opponent", { waitedSeconds: this.config.waitSeconds });
      this.disconnect();
    }, this.config.waitSeconds * 1000);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!", `(${this.clients.length}/2)`);
    if (this.phase === "waiting" && this.clients.length === 2) {
      this.startMatch();
    }
  }

  // P17: leaving mid-match ends the match for the remaining player.
  onLeave(client: Client, code?: number) {
    console.log(client.sessionId, "left!", code);
    if (this.phase === "countdown" || this.phase === "racing") {
      this.phase = "finished";
      this.countdownTimer?.clear();
      this.raceTimer?.clear();
      this.broadcast("opponent_left", {});
      this.clock.setTimeout(() => this.disconnect(), this.config.closeDelayMs);
    }
  }

  onDispose() {
    console.log("quick match room", this.roomId, "disposing...");
  }

  // ---------------------------------------------------------------- match flow

  /** P19: both players get the same words and the same countdown. */
  private startMatch() {
    this.waitTimer?.clear();
    this.lock(); // nobody else can join this match
    this.phase = "countdown";

    const { countdownSeconds, durationSeconds, wordCount } = this.config;
    const words = pickWords(wordCount);
    this.totalChars = words.join(" ").length;

    const ids = this.clients.map((c) => c.sessionId);
    for (const id of ids) {
      this.players.set(id, { typed: 0, correct: 0 });
    }

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
  private handleProgress(client: Client, message: ProgressMessage) {
    if (this.phase !== "racing") return;

    const stats = this.players.get(client.sessionId);
    if (!stats) return;

    const typed = message?.typed;
    const correct = message?.correct;

    // Basic server-side checks. Anything that fails is ignored, never trusted.
    if (!isCount(typed) || !isCount(correct)) return;
    if (correct > typed) return;                                   // can't be more correct than typed
    if (typed < stats.typed || correct < stats.correct) return;    // counts only go up
    if (correct > this.totalChars) return;                         // can't pass the end of the text

    const elapsedSeconds = (Date.now() - this.startedAt) / 1000;
    const maxPlausible = Math.floor(elapsedSeconds * this.config.maxCharsPerSecond) + 10;
    if (typed > maxPlausible) return;                              // faster than a human can type

    stats.typed = typed;
    stats.correct = correct;

    // Send the checked numbers to the other player, not the raw message.
    this.broadcast("opponent_progress", { typed, correct }, { except: client });
  }

  /** P21: results are computed here, so both players get the same answer. */
  private finishMatch() {
    if (this.phase !== "racing") return;
    this.phase = "finished";

    const minutes = this.config.durationSeconds / 60;
    const results: Record<string, { wpm: number; accuracy: number; correct: number; typed: number }> = {};
    for (const [id, stats] of this.players) {
      results[id] = {
        wpm: Math.round(stats.correct / 5 / minutes),
        accuracy: stats.typed > 0 ? Math.round((stats.correct / stats.typed) * 100) : 0,
        correct: stats.correct,
        typed: stats.typed,
      };
    }

    // Winner: most correct characters. Tie: better accuracy. Still tied: draw (null).
    const [a, b] = [...this.players.keys()];
    let winner: string | null = null;
    if (a !== undefined && b !== undefined) {
      const ra = results[a];
      const rb = results[b];
      if (ra.correct !== rb.correct) {
        winner = ra.correct > rb.correct ? a : b;
      } else if (ra.accuracy !== rb.accuracy) {
        winner = ra.accuracy > rb.accuracy ? a : b;
      }
    }

    this.broadcast("match_result", { winner, results });
    this.clock.setTimeout(() => this.disconnect(), this.config.closeDelayMs);
  }
}

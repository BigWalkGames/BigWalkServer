import { Client } from "colyseus";
import { MatchRoom, type Timer } from "./MatchRoom.js";

/**
 * Quick Match: a 1v1 race against whoever joins next.
 *
 * Covers P15 (pairing + wait timeout), P17 (opponent leaves), P19 (shared words and a
 * synced start) and P21 (final results decided on the server). The race itself lives in
 * MatchRoom, which Custom Game rooms share.
 *
 * Extra message the SERVER sends:
 *   no_opponent        { waitedSeconds }        nobody joined in time
 */
export class QuickMatchRoom extends MatchRoom {
  protected readonly mode = "quick_match" as const;
  private waitTimer?: Timer;

  onCreate(options: any) {
    this.readSettings();
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
      this.waitTimer?.clear();
      this.startMatch();
    }
  }
}

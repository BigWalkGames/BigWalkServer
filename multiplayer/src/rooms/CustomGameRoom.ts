import { Client } from "colyseus";
import { MatchRoom, type Timer } from "./MatchRoom.js";
import { generateUniqueCode, rememberClosedCode } from "./roomCodes.js";

/**
 * Custom Game: a private room two friends join with a room code (P26-P29).
 *
 * The creator makes the room (`client.create("custom_game")`) and reads the code from
 * `room.roomId`. The friend joins with it (`client.joinById(code)`). The room is private,
 * so it never shows up in a list and Quick Match never puts anyone in it. Both players
 * press Ready, then the same race as Quick Match runs (shared words, synced countdown,
 * results decided on the server).
 *
 * Messages the SERVER sends (on top of the race messages in MatchRoom):
 *   lobby         { code, players: [{ id, ready }] }   whenever someone joins, leaves or changes ready
 *   room_closed   { reason }                           "idle": nobody started a match in time
 *   opponent_left {}                                   the other player left the lobby or the match
 *
 * Message the CLIENT sends:
 *   ready         { ready: boolean }                   defaults to true; false un-readies
 */
export class CustomGameRoom extends MatchRoom {
  protected readonly mode = "custom" as const;
  private readyIds = new Set<string>();
  private idleTimer?: Timer;

  messages = {
    progress: (client: Client, message: any) => this.handleProgress(client, message),
    ready: (client: Client, message: any) => this.handleReady(client, message),
  };

  async onCreate(options: any) {
    this.readSettings();
    const code = await generateUniqueCode();
    this.roomId = code;     // the room id IS the code
    this.roomCode = code;
    await this.setPrivate(true);
    console.log("custom game room", code, "created");

    // A lobby nobody starts a match in does not stay open forever.
    this.idleTimer = this.clock.setTimeout(() => {
      if (this.phase !== "waiting") return;
      this.phase = "finished";
      this.broadcast("room_closed", { reason: "idle" });
      this.clock.setTimeout(() => this.disconnect(), this.config.closeDelayMs);
    }, this.config.customIdleSeconds * 1000);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined room", this.roomCode, `(${this.clients.length}/2)`);
    this.broadcastLobby();
  }

  /** P29: if someone leaves the lobby, the room closes and the other player is told. */
  protected onLeaveBeforeMatch(client: Client) {
    this.readyIds.delete(client.sessionId);
    if (this.clients.length === 0) return; // empty rooms close by themselves
    this.phase = "finished";
    this.idleTimer?.clear();
    this.broadcast("opponent_left", {});
    this.clock.setTimeout(() => this.disconnect(), this.config.closeDelayMs);
  }

  onDispose() {
    super.onDispose();
    if (this.roomCode) rememberClosedCode(this.roomCode); // so the code now reads "expired"
  }

  // ------------------------------------------------------------------ lobby

  /** P28: when both players are ready the match starts. */
  private handleReady(client: Client, message: any) {
    if (this.phase !== "waiting") return;
    const ready = typeof message?.ready === "boolean" ? message.ready : true;
    if (ready) this.readyIds.add(client.sessionId);
    else this.readyIds.delete(client.sessionId);
    this.broadcastLobby();

    if (this.clients.length === 2 && this.clients.every((c) => this.readyIds.has(c.sessionId))) {
      this.idleTimer?.clear();
      this.startMatch();
    }
  }

  private broadcastLobby() {
    this.broadcast("lobby", {
      code: this.roomCode,
      players: this.clients.map((c) => ({ id: c.sessionId, ready: this.readyIds.has(c.sessionId) })),
    });
  }
}

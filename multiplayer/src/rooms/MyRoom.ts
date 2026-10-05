import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState } from "./schema/MyRoomState.js";

export class MyRoom extends Room<{ state: MyRoomState }> {
  maxClients = 2; // 1v1: a third player gets their own new room
  state = new MyRoomState();

    messages = {
    ping: (client: Client, message: { sentAt: number }) => {
      console.log(client.sessionId, "sent a ping");
      // send a pong to everyone in the room, including the sender
      this.broadcast("pong", { from: client.sessionId, sentAt: message.sentAt });
    },

    typed: (client: Client, message: { text: string }) => {
      console.log(client.sessionId, "typed:", message.text);
      // send to the other player only, not back to the sender
      this.broadcast("typed", { from: client.sessionId, text: message.text }, { except: client });
    },
  };

  onCreate(options: any) {
    console.log("room", this.roomId, "created");
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!", `(${this.clients.length}/2)`);
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}
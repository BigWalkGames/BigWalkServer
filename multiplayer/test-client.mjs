import { Client } from "@colyseus/sdk";

const url = process.argv[2] || "http://localhost:2567";
const client = new Client(url);
const room = await client.joinOrCreate("my_room");
console.log("joined as", room.sessionId);

room.onMessage("pong", (msg) => {
  const who = msg.from === room.sessionId ? "me" : "opponent";
  console.log(`pong from ${who}, round trip ${Date.now() - msg.sentAt}ms`);
});

setInterval(() => room.send("ping", { sentAt: Date.now() }), 2000);
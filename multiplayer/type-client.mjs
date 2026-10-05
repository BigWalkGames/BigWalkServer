import { Client } from "@colyseus/sdk";
import readline from "node:readline";

const url = process.argv[2] || "http://localhost:2567";
const client = new Client(url);
const room = await client.joinOrCreate("my_room");
console.log("joined as", room.sessionId, "- type a line and press Enter");

room.onMessage("typed", (msg) => {
  console.log(`opponent: ${msg.text}`);
});

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => room.send("typed", { text: line }));

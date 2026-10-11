// Test client for Quick Match. It "types" for you, so you can try a whole match
// with two terminals and no web client.
//
//   node quick-client.mjs [server-url] [chars-per-second]
//
// Examples:
//   node quick-client.mjs                              (localhost, ~60 WPM)
//   node quick-client.mjs http://localhost:2567 8      (a faster typist)
//
// Run it in two terminals. Use different speeds to see who wins.
// Press Ctrl+C in one of them mid-match to see "opponent left" in the other.
import { Client } from "@colyseus/sdk";

const url = process.argv[2] || "http://localhost:2567";
const charsPerSecond = Number(process.argv[3]) || 5; // 5 chars/sec is about 60 WPM
const mistakeRate = 0.1; // 10% of keystrokes are wrong

const client = new Client(url);
const room = await client.joinOrCreate("quick_match");
const me = room.sessionId;
console.log(`joined as ${me}, waiting for an opponent...`);

// Register every handler right away, in the same step as joining,
// so no message from the server can arrive before it has a listener.
let typingTimer;

room.onMessage("match_found", ({ players, words, countdownSeconds, durationSeconds }) => {
  console.log(`match found! ${words.length} words, ${durationSeconds}s race, starting in ${countdownSeconds}s`);
  console.log(`first words: ${words.slice(0, 8).join(" ")} ...`);
});

room.onMessage("countdown", ({ seconds }) => console.log(`  ${seconds}...`));

room.onMessage("go", ({ durationSeconds }) => {
  console.log("GO!");
  let typed = 0;
  let correct = 0;
  let pending = 0;
  const tickMs = 250;
  typingTimer = setInterval(() => {
    pending += (charsPerSecond * tickMs) / 1000;
    const keys = Math.floor(pending);
    pending -= keys;
    for (let i = 0; i < keys; i++) {
      typed += 1;
      if (Math.random() > mistakeRate) correct += 1;
    }
    room.send("progress", { typed, correct });
  }, tickMs);
});

let lastPrinted = 0;
room.onMessage("opponent_progress", ({ typed, correct }) => {
  if (Date.now() - lastPrinted > 1000) {
    lastPrinted = Date.now();
    console.log(`  opponent: ${correct} correct / ${typed} typed`);
  }
});

room.onMessage("match_result", ({ winner, results }) => {
  clearInterval(typingTimer);
  console.log("\n=== RESULT ===");
  for (const [id, r] of Object.entries(results)) {
    console.log(`${id === me ? "you     " : "opponent"}  ${r.wpm} WPM  ${r.accuracy}% accuracy`);
  }
  console.log(winner === null ? "It's a draw." : winner === me ? "You win!" : "Opponent wins.");
});

room.onMessage("opponent_left", () => {
  clearInterval(typingTimer);
  console.log("\nYour opponent left. (The web client would go back to the Main Menu here.)");
});

room.onMessage("no_opponent", ({ waitedSeconds }) => {
  console.log(`\nNo opponent found after ${waitedSeconds}s. (The web client would go back to the Main Menu here.)`);
});

room.onLeave((code) => {
  clearInterval(typingTimer);
  console.log(`left the room (code ${code})`);
  process.exit(0);
});

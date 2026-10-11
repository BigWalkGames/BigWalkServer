# Quick Match (server side)

Covers Trello P15 (pairing and wait timeout), P17 (opponent leaves), P19 (shared words and synced start) and P21 (results decided on the server). Room name: `quick_match`. 1v1, `maxClients = 2`.

## Flow

`waiting` -> `countdown` -> `racing` -> `finished`

1. Player joins with `joinOrCreate("quick_match")`. First player waits; second player fills the room and the match starts.
2. If nobody joins in time, the server sends `no_opponent` and closes the room.
3. Server sends `match_found`, then `countdown` (3, 2, 1), then `go`.
4. During the race each client sends `progress`; the server checks it and relays it to the other player only.
5. When the timer ends the server computes WPM and accuracy and sends `match_result` to both. Room closes about 1 second later.
6. If a player leaves or drops during countdown or race, the other gets `opponent_left` and the room closes. No result is produced.

## Events the server sends

| Event | Data | Notes |
|---|---|---|
| `match_found` | `{ players, words, countdownSeconds, durationSeconds }` | `words` is identical for both players |
| `countdown` | `{ seconds }` | 3, 2, 1 |
| `go` | `{ durationSeconds }` | start typing now |
| `opponent_progress` | `{ typed, correct }` | only the opponent receives it |
| `match_result` | `{ winner, results }` | `winner` is a sessionId, or `null` for a draw. `results[sessionId] = { wpm, accuracy, correct, typed }` |
| `opponent_left` | `{}` | client should return to Main Menu with a message |
| `no_opponent` | `{ waitedSeconds }` | client should return to Main Menu with a message |

## Event the client sends

`progress` with `{ typed, correct }`: cumulative counts since `go` (not per-keystroke). Send at most about 10 per second. More than 30 per second gets the client disconnected.

## Web client snippet

```js
import { Client } from "@colyseus/sdk";

const client = new Client("ws://localhost:2567"); // wss://... once deployed
const room = await client.joinOrCreate("quick_match");

// Register ALL handlers right here, straight after joining.
room.onMessage("match_found", ({ words, countdownSeconds, durationSeconds }) => { /* show words */ });
room.onMessage("countdown", ({ seconds }) => { /* show 3, 2, 1 */ });
room.onMessage("go", ({ durationSeconds }) => { /* enable input, start timer UI */ });
room.onMessage("opponent_progress", ({ typed, correct }) => { /* move opponent marker */ });
room.onMessage("match_result", ({ winner, results }) => {
  const youWon = winner === room.sessionId; // winner === null means draw
  const mine = results[room.sessionId];
  // show results screen
});
room.onMessage("opponent_left", () => { /* back to Main Menu + message */ });
room.onMessage("no_opponent", () => { /* back to Main Menu + message */ });

// while racing:
room.send("progress", { typed, correct });

// to cancel while waiting, or leave:
room.leave();
```

Play Again: call `joinOrCreate("quick_match")` again (the old room is already closed).

## Winner rule

Most correct characters wins. Tie: higher accuracy. Still tied: draw (`winner: null`).
WPM = `correct / 5 / (durationSeconds / 60)`. Accuracy = `correct / typed`, as a whole percent.

## Settings (environment variables, read by the server only)

| Variable | Default |
|---|---|
| `QUICK_MATCH_WAIT_SECONDS` | 30 |
| `COUNTDOWN_SECONDS` | 3 |
| `MATCH_DURATION_SECONDS` | 30 |
| `WORD_COUNT` | 100 |
| `MAX_CHARS_PER_SECOND` | 25 (about 300 WPM, plausibility limit) |
| `RESULT_CLOSE_DELAY_MS` | 1000 |

## What the server checks on `progress`

Ignored (not trusted) if: not whole non-negative numbers, `correct > typed`, counts go backwards, `correct` is past the end of the text, or `typed` is faster than `MAX_CHARS_PER_SECOND` allows by the server's own clock.

## Known limitations

- Counts are reported by the client, so this is a plausibility check, not full anti-cheat. Per-keystroke timing checks are ticket P35.
- `words.ts` is a placeholder list. Swap it for the word source Solo (P5) uses.
- A real wifi loss is noticed only after Colyseus's heartbeat times out (a few seconds). Tested with a closed socket, not a real wifi drop.
- Not tested across two physical computers yet (network issue, separate from this code).
- P43 emotes (post-MVP) are not built. Relay would be one more message handler that broadcasts to the other player.

## Tests

`npm test` runs 9 tests: pairing, same words, synced start, progress relay, identical results, draw, bad progress ignored, wait timeout, leave during race, leave during countdown, dropped connection, third player gets a new room.

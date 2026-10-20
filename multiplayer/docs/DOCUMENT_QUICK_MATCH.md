# Quick Match: Server Reference

Everything about the Quick Match room (1v1 typing race) in one place, for anyone on the team who needs to connect to it, change it, or test it.

Covers Trello P15 (queue, wait timeout), P17 (opponent leaves), P19 (shared words, synced start), P21 (results). Emotes (P43) and Supabase login checks are not built yet (see "Not built yet").

## 1. Where things are

| Path (inside `multiplayer/`) | What it is |
|---|---|
| `src/rooms/QuickMatchRoom.ts` | The room. All match logic lives here. |
| `src/rooms/words.ts` | The word bank and `pickWords()`. |
| `src/app.config.ts` | Registers the room under the name `quick_match`. |
| `test/QuickMatchRoom.test.ts` | Automated tests (`npm test`). |
| `test-players/QUICK_quick-client.mjs` | A bot that plays a match by itself. See `test-players/DOCUMENT_TEST_PLAYERS.md`. |
| `docs/DOCUMENT_QUICK_MATCH.md` | This file. |

Room name to join: `quick_match`.

## 2. How a match runs

`waiting` -> `countdown` -> `racing` -> `finished`

1. A player calls `joinOrCreate("quick_match")`. The first player waits. The second player fills the room (`maxClients = 2`) and the match starts. A third player automatically gets a new room.
2. If nobody joins within the wait time, the server sends `no_opponent` and closes the room.
3. The server sends `match_found` (same words for both), then `countdown` 3, 2, 1, then `go`.
4. While racing, each client sends `progress`. The server checks it and passes it to the other player only.
5. When the timer ends the server works out WPM, accuracy and the winner, and sends `match_result` to both. The room closes about 1 second later.
6. If a player leaves or drops during countdown or race, the other gets `opponent_left` and the room closes. No result is produced.

The server is the referee: it chooses the words, runs the clock, validates the numbers and decides the winner. The browser only reports what the player typed.

## 3. The contract with the web client

### Messages the server sends

| Event | Data | When | What the client should do |
|---|---|---|---|
| `match_found` | `{ players, words, countdownSeconds, durationSeconds }` | Room is full | Show the words. `words` is identical for both players. `players` is both session ids. |
| `countdown` | `{ seconds }` | 3, 2, 1 | Show the number. |
| `go` | `{ durationSeconds }` | Race starts | Enable typing, start the timer display. |
| `opponent_progress` | `{ typed, correct, wordResults? }` | While racing, only to the opponent | Update the opponent's progress display. `wordResults` has one letter per completed word, in order: `g` no mistakes, `r` had a mistake. It is optional and only used for the opponent's progress bar. The server accepts only `g` and `r`, at most one per word and never more than `typed`. |
| `match_result` | `{ winner, results }` | Race over | `winner` is a session id, or `null` for a draw. `results[sessionId] = { wpm, accuracy, correct, typed }`. |
| `opponent_left` | `{}` | Opponent left mid-match | Go back to the Main Menu with a message. |
| `no_opponent` | `{ waitedSeconds }` | Nobody joined in time | Go back to the Main Menu with a message. |

### Message the client sends

`progress` with `{ typed, correct, wordResults? }` (see `opponent_progress` above for `wordResults`)
- `typed`: total key presses since `go` (backspace does not undo).
- `correct`: how many of those were correct.
- Both are cumulative totals, not per keystroke.
- Send at most about 10 per second. More than 30 per second gets the client disconnected.

### Connecting from the web client

```js
import { Client } from "@colyseus/sdk";

const client = new Client("ws://localhost:2567"); // wss://... once deployed
const room = await client.joinOrCreate("quick_match");

// Register ALL handlers right here, straight after joining,
// so no message can arrive before it has a listener.
room.onMessage("match_found", ({ words, countdownSeconds, durationSeconds }) => {});
room.onMessage("countdown", ({ seconds }) => {});
room.onMessage("go", ({ durationSeconds }) => {});
room.onMessage("opponent_progress", ({ typed, correct }) => {});
room.onMessage("match_result", ({ winner, results }) => {
  const youWon = winner === room.sessionId; // null = draw
  const mine = results[room.sessionId];
});
room.onMessage("opponent_left", () => {});
room.onMessage("no_opponent", () => {});

room.send("progress", { typed, correct }); // while racing
room.leave();                              // cancel while waiting, or quit
```

Play Again: call `joinOrCreate("quick_match")` again. The old room is already closed.

## 4. Scoring

- WPM = `round(correct / 5 / (durationSeconds / 60))`
- Accuracy = `round(correct / typed * 100)`, or 0 if nothing was typed
- Winner: more `correct` wins. Tie: higher accuracy wins. Still tied: draw, `winner` is `null`.

## 5. Function reference

### `src/rooms/QuickMatchRoom.ts`

| Function | Called by | What it does |
|---|---|---|
| `readConfig()` | `onCreate`, field init | Reads the settings in section 6 from environment variables. Bad or missing values fall back to defaults. Never reads anything from clients. |
| `isCount(value)` | `handleProgress` | True only for whole numbers that are 0 or more. Used to reject junk input. |
| `onCreate(options)` | Colyseus | Re-reads config and starts the wait timer. When it fires with nobody matched: sends `no_opponent`, closes the room (P15). |
| `onJoin(client, options)` | Colyseus | When the second player joins, calls `startMatch()`. |
| `onLeave(client, code)` | Colyseus | If it happens during countdown or race: stops the timers, sends `opponent_left`, closes the room shortly after (P17). Leaving while still waiting just frees the room. |
| `onDispose()` | Colyseus | Logging only. |
| `startMatch()` | `onJoin` | Stops the wait timer, locks the room, picks the shared words, sets both players' counts to 0, sends `match_found`, and runs the 3-2-1 countdown (P19). |
| `beginRace()` | `startMatch` countdown | Sets phase to racing, records the start time, sends `go`, starts the race timer. |
| `handleProgress(client, message)` | `progress` message handler | Checks the numbers (section 7). If valid, saves them and sends them to the other player. If not, ignores the message. |
| `finishMatch()` | Race timer | Computes WPM, accuracy and winner, sends `match_result` to both, closes the room shortly after (P21). |

Class settings: `maxClients = 2`, `maxMessagesPerSecond = 30`.

### `src/rooms/words.ts`

| Function | What it does |
|---|---|
| `pickWords(count)` | Returns `count` random words from the word bank, never the same word twice in a row. The room calls it once per match and sends the same array to both players. |

The list in this file is a placeholder. When the shared word bank (P9) is decided, replace `WORD_BANK` with it. `pickWords` is the only thing the room uses, so nothing else changes.

### How to replace the word bank

The list in `words.ts` is a placeholder. To use the team's real list (P9):

1. Open `src/rooms/words.ts`.
2. Replace the strings inside the `WORD_BANK` array with the real words. Keep them as lowercase strings separated by commas. Do not change the `pickWords` function or its name.
3. Keep at least a few dozen words. `pickWords` avoids repeating the same word twice in a row, and an array with only one word would loop forever.
4. Run `npm test`. All 9 tests should still pass, because none of them depend on specific words.
5. Run the server and play one match with `test-players/QUICK_quick-client.mjs` to see the new words arrive.
6. Commit `src/rooms/words.ts` and push.

To change how many words are sent per match, set `WORD_COUNT` (section 6). It does not need a code change.

## 6. Settings (environment variables, server only)

Read when a room is created. Set them before `npm start`, for example `QUICK_MATCH_WAIT_SECONDS=10 npm start`.

| Variable | Default | Meaning |
|---|---|---|
| `QUICK_MATCH_WAIT_SECONDS` | 30 | How long a lone player waits before `no_opponent` |
| `COUNTDOWN_SECONDS` | 3 | Countdown length |
| `MATCH_DURATION_SECONDS` | 30 | Race length |
| `WORD_COUNT` | 100 | Words sent per match |
| `MAX_CHARS_PER_SECOND` | 25 | Plausibility limit (about 300 WPM) |
| `RESULT_CLOSE_DELAY_MS` | 1000 | Pause before closing so both clients get the result |

## 7. What the server checks on `progress`

A message is ignored (not trusted, no error) if any of these is true:
- it is not whole non-negative numbers
- `correct` is greater than `typed`
- the counts go backwards
- `correct` is past the end of the text
- `typed` is more than `MAX_CHARS_PER_SECOND` allows for the time since `go`, by the server's own clock

This is a plausibility check, not full anti-cheat. Per-keystroke timing checks are ticket P35.

## 8. Adding something new (example: emotes, P43)

1. Add a handler to `messages` in `QuickMatchRoom`, for example `emote`.
2. In it, check the value against a fixed list of allowed emotes.
3. Send it to the other player: `this.broadcast("opponent_emote", { emote }, { except: client })`.
4. Add the new events to the tables in section 3 and add a test.

## 9. Testing

### Automated tests

`npm test` in `multiplayer/` runs 9 tests (file: `test/QuickMatchRoom.test.ts`). They run against real rooms with simulated players.

| # | Test | What it checks | Card |
|---|---|---|---|
| 1 | pairs two players, gives them the same words, and starts them together | Two players are paired, both get the identical word list, and the countdown starts for both at once. | P15, P19 |
| 2 | relays checked progress to the opponent only, then sends identical results | Progress goes to the other player only, not back to the sender. Both players get the same final results. | P19, P21 |
| 3 | calls it a draw when both players finish level | Equal correct characters and equal accuracy gives `winner: null`. | P21 |
| 4 | ignores progress that is impossible or malformed | Junk or cheating messages are ignored: more correct than typed, counts going backwards, typing faster than a human can. | Anti-cheat |
| 5 | tells a lone player when nobody joined, then closes the room | After the wait time a lone player gets `no_opponent` and the room closes. | P16 |
| 6 | ends the match for the other player when someone leaves mid-race | If a player leaves during the race, the other gets `opponent_left`. | P17 |
| 7 | ends the match when someone leaves during the countdown | Same as test 6, but during the 3-2-1. | P17 |
| 8 | treats a dropped connection like a leave | A connection that closes without warning counts as a leave. | P18 |
| 9 | puts a third player in a new room instead of the full one | A room holds two players. A third player gets their own new room. | P15 |

These test the server only. They do not test the browser, a real wifi drop, or two physical computers.

### Manual testing

- `test-players/QUICK_quick-client.mjs`: a bot for manual and demo runs. Step-by-step instructions (server, two bots, different speeds, the other situations) are in `test-players/DOCUMENT_TEST_PLAYERS.md`.
- `/monitor` on the server (for example `http://localhost:2567/monitor`) shows live rooms and players.

## 10. Known limitations / not built yet

- Counts are reported by the client (see section 7).
- A real wifi loss is noticed only after Colyseus's heartbeat times out, a few seconds. Tested with a closed socket, not a real wifi drop.
- Not tested across two physical computers yet.
- Players are not checked against Supabase login yet. Anyone who can reach the server can join.
- Emotes (P43, post-MVP), a rematch with the same opponent, and skill-based pairing are not built. Play Again joins the queue fresh.
- A draw is `winner: null`. The stored `MultiplayerMatch.winner` is a Boolean, so draw handling needs a team decision.

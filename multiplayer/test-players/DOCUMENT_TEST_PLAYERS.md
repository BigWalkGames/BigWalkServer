# test-players: how to run and test Quick Match

Bots for trying Quick Match without a web client. A bot joins the queue like a real player, so the server treats it as one.

All commands run inside the `multiplayer/` folder. Each terminal needs its own tab or window, and each tab must start in `multiplayer/`.

## One-time setup

```
cd multiplayer
npm install
```

## 1. Run a full match with two bots

**Terminal 1: start the server**

```
cd multiplayer
npm start
```

Wait until you see the Colyseus banner and the server is listening on port 2567. Leave this terminal running.

**Terminal 2: first bot** (open a new tab, then)

```
cd multiplayer
node test-players/QUICK_quick-client.mjs
```

It prints `joined as ..., waiting for an opponent...`.

**Terminal 3: second bot** (open another new tab, then)

```
cd multiplayer
node test-players/QUICK_quick-client.mjs
```

Both bots now print `match found!`, the 3-2-1 countdown, `GO!`, then the opponent's progress. After 30 seconds each prints the result: WPM, accuracy and who won. Both bots then exit.

To watch the room live, open `http://localhost:2567/monitor` in a browser while the match runs.

## 2. Make the bots type at different speeds

The bot takes two optional arguments:

```
node test-players/QUICK_quick-client.mjs [server-url] [chars-per-second]
```

Give each bot a different second argument. The first argument must be the server URL, even on localhost:

```
# Terminal 2: slower typist
node test-players/QUICK_quick-client.mjs http://localhost:2567 4

# Terminal 3: faster typist
node test-players/QUICK_quick-client.mjs http://localhost:2567 8
```

| chars-per-second | Roughly | Notes |
|---|---|---|
| 4 | 48 WPM typed | slow |
| 5 (default) | 60 WPM typed | |
| 8 | 96 WPM typed | fast |
| 12 | 144 WPM typed | very fast |

"WPM typed" is the speed before mistakes. The bot gets 10% of its keys wrong, so the WPM in the final result is about 10% lower. The faster bot should usually win. If both bots use the same speed, the result is close, and the random mistakes decide who wins. A tie in correct characters and accuracy is a draw.

The server rejects anything above about 25 chars per second (300 WPM), so values above 25 will be ignored by the server's checks.

## 3. Test the other situations

| What to check | How |
|---|---|
| No opponent (P16) | Start the server and run only one bot. After 30 seconds it prints `No opponent found`. To make it faster, start the server with `QUICK_MATCH_WAIT_SECONDS=10 npm start`. |
| Opponent leaves (P17) | Run two bots. Press Ctrl+C in one of them mid-match. The other prints `Your opponent left`. |
| Connection lost (P18) | Run two bots. Stop the server with Ctrl+C in Terminal 1 mid-match. Both bots print `left the room`. |
| Third player | Run three bots. The third waits in its own room instead of joining the full one. |

For quicker runs, set the server's settings before `npm start`, for example:

```
QUICK_MATCH_WAIT_SECONDS=10 MATCH_DURATION_SECONDS=15 npm start
```

All settings are listed in `docs/DOCUMENT_QUICK_MATCH.md`. Restart the server after changing them.

## 4. Play a bot against a web client

Once the client screens are connected to the room (not part of this repo yet), run the server and one bot as above, then open the web game in a browser. Press W for Multiplayer and Q for Quick Match. You and the bot are paired. To play two browsers against each other, open two browser windows at the same address and do the same in each.

Until the client is connected, use two bots.

## 5. Run the automated tests

```
cd multiplayer
npm test
```

You should see 9 passing tests and no errors. The tests start their own temporary server, so you do not need `npm start` first. What each test checks is listed in `docs/DOCUMENT_QUICK_MATCH.md`, section 9.

## 6. Run the bot against a deployed server

```
node test-players/QUICK_quick-client.mjs https://your-server-address 5
```

Use `https://` (the SDK switches to secure websockets) or `http://` for a local server.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| `ECONNREFUSED` or nothing happens | The server isn't running. Start it with `npm start` in another terminal. |
| `Cannot find package '@colyseus/sdk'` | Run `npm install` in `multiplayer/`. |
| The bot says `No opponent found` straight away | You started the server with a very small `QUICK_MATCH_WAIT_SECONDS`, or the second bot started too late. |
| `Address already in use` on `npm start` | An old server is still running. Stop it with Ctrl+C in its terminal and try again. |

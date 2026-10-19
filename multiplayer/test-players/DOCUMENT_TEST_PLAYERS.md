# test-players

Bots for trying Quick Match without a web client. They join the queue like a real player, so the server treats them as one.

## QUICK_quick-client.mjs

Plays a whole match by itself: simulates typing at a set speed, with 10% of key presses wrong.

```
cd multiplayer
node test-players/QUICK_quick-client.mjs [server-url] [chars-per-second]
```

| Argument | Default | Meaning |
|---|---|---|
| `server-url` | `http://localhost:2567` | Where the server is. Use `https://...` for a deployed server (the SDK switches to wss). |
| `chars-per-second` | 5 | Typing speed. 5 is about 60 WPM, 8 is about 96 WPM. |

Run it in two terminals with different speeds to see who wins. Press Ctrl+C in one mid-match to see the other get "opponent left". Run it alone and wait to see the wait timeout.

Needs the server running (`npm start`) and `npm install` done. For quicker tests start the server with `QUICK_MATCH_WAIT_SECONDS=10 MATCH_DURATION_SECONDS=15 npm start`.

A bot and a person can also play each other: run one bot and join from the web client.

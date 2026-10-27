# BigWalk Multiplayer Server

The real-time server for BigWalk's 1v1 typing races, built on [Colyseus](https://colyseus.io) 0.18. It matches players, hands both the same words, relays live progress, and decides the winner. The web client (`BigWalkProject`) connects to it over WebSocket.

It is separate from the Fastify API in `../src`: its own `package.json`, its own `node_modules`, its own process on port **2567**.

## Game modes

| Mode | Room | How players get in |
|---|---|---|
| Quick Match | `quick_match` | Matched with a random opponent. A lone player gets `no_opponent` after `QUICK_MATCH_WAIT_SECONDS`. |
| Custom Game | `custom_game` | One player creates a private room and gets a 5-character code. A friend joins with it. Both press Ready, race, and can rematch in the same room. |

Both modes share one race flow (`src/rooms/MatchRoom.ts`): countdown, race, result. The race ends when the time is up, or as soon as a player types the whole text. The winner is whoever has the most correct letters, then the better accuracy. Anything else is a draw. A match abandoned mid-race has no result.

## Requirements

- Node.js 22 or newer
- npm

## Run it locally

From this folder (`server/multiplayer`):

```bash
npm install
npm start
```

You should see the Colyseus banner and `Listening on http://localhost:2567`. The server restarts when you save a file. Stop it with `Ctrl+C`.

To point the web client at it, run the client with `pnpm dev`. It uses `ws://localhost:2567` unless `VITE_MULTIPLAYER_URL` is set in the client's `.env`.

### Try it with two browser windows

1. Start the server (`npm start`) and the client (`pnpm dev`).
2. In window 1: Multiplayer, Custom Game, Create Room. Copy the code.
3. In window 2: Multiplayer, Custom Game, Join Room. Press `V` (or click Paste), then Enter.
4. Press `R` in both windows to ready up and start the race.
5. After the results, press `R` in both windows for a rematch, or `Esc` to leave. Leaving closes the room for both players.

### Change settings for a quick test

Settings are read when a room is created, so set them before `npm start`:

```bash
WORD_COUNT=10 MATCH_DURATION_SECONDS=15 npm start
```

With `WORD_COUNT=10` you can finish the whole text and see the race end early.

## Tests

```bash
npm test
```

This boots the real server and connects real clients. It covers Quick Match, Custom Game (codes, lobby, ready, early finish, rematch, leaving) and the sign-in check. All tests should pass.

Command-line bots for manual testing are in `test-players/` (see `test-players/DOCUMENT_TEST_PLAYERS.md`). `test-client.mjs` joins the basic ping room.

## Settings

Environment variables, read by the server only. All are optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 2567 | Port to listen on |
| `QUICK_MATCH_WAIT_SECONDS` | 30 | How long a lone Quick Match player waits for an opponent |
| `COUNTDOWN_SECONDS` | 3 | Countdown before the race |
| `MATCH_DURATION_SECONDS` | 30 | Race length |
| `WORD_COUNT` | 100 | Words per match |
| `MAX_CHARS_PER_SECOND` | 25 | Typing speed the server accepts (anything faster is ignored as impossible) |
| `RESULT_CLOSE_DELAY_MS` | 1000 | Pause after the result so both clients receive it |
| `CUSTOM_ROOM_IDLE_SECONDS` | 600 | A Custom Game lobby with no match started closes after this long |
| `CLOSED_CODE_MEMORY_MINUTES` | 60 | How long a closed room code reports "expired" |
| `CODE_LOOKUPS_PER_MINUTE` | 120 (20 with `TRUST_PROXY=true`) | Room code lookups allowed per minute |
| `TRUST_PROXY` | off | Set `true` only behind a proxy that sets `X-Forwarded-For` |
| `REQUIRE_AUTH` | off | `true` makes players sign in. Needs `SUPABASE_URL`, and `SUPABASE_JWT_SECRET` if your project signs tokens with a shared secret. |
| `MONITOR_USER`, `MONITOR_PASSWORD` | unset | Login for `/monitor` in production. Without both, `/monitor` is off. |

Never commit a `.env` file. It is in `.gitignore`.

## Run it with Docker (the shared server)

```bash
docker compose up -d --build
docker compose logs -f
```

`docker-compose.yml` passes these into the container: `PORT`, `MONITOR_USER`, `MONITOR_PASSWORD`, `QUICK_MATCH_WAIT_SECONDS`, `MATCH_DURATION_SECONDS`, `WORD_COUNT`, `REQUIRE_AUTH`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET` and `TRUST_PROXY`. Put them in `multiplayer/.env`, or use the helper for the three match settings:

```bash
./mp-config.sh -d 20 -t 45 -w 40     # wait, match seconds, word count
```

Any other setting in the table above (for example `CUSTOM_ROOM_IDLE_SECONDS` or `COUNTDOWN_SECONDS`) also needs a line in `docker-compose.yml` under `environment:` before it reaches the container.

In the container `NODE_ENV=production`, so `/monitor` needs `MONITOR_USER` and `MONITOR_PASSWORD`, and the playground at `/` is off. For deploying, updating and testing the server, see `docs/DOCUMENT_DEPLOY.md` and `docs/DOCUMENT_SERVER_START.md`.

## Useful URLs

| URL | What it is |
|---|---|
| `/hi` | Greeting, to check the server is reachable |
| `/api/room-code/status?code=ABCDE` | Whether a room code is `open`, `full`, `invalid` or `expired` |
| `/monitor` | Colyseus monitor: rooms and connections (development, or production with a login) |
| `/` | Colyseus playground (development only) |

## Layout

```
multiplayer/
  src/
    index.ts              starts the server
    app.config.ts         registers the rooms and HTTP routes
    auth.ts               sign-in check (Supabase token)
    results.ts            where finished results are reported (logs only for now)
    rooms/
      MatchRoom.ts        shared race flow: countdown, progress checks, winner
      QuickMatchRoom.ts   random matchmaking
      CustomGameRoom.ts   private room: code, lobby, ready, rematch
      roomCodes.ts        room codes, expired-code memory, lookup rate limit
      words.ts            the word bank
      MyRoom.ts           the basic ping room
  test/                   automated tests (npm test)
  test-players/           command-line bot players
  docs/                   the references below
  Dockerfile, docker-compose.yml, mp-config.sh
```

## More documentation

- `docs/DOCUMENT_QUICK_MATCH.md`: Quick Match messages, scoring, checks on progress
- `docs/DOCUMENT_CUSTOM_GAME.md`: Custom Game rooms, codes, lobby, rematch, sign-in
- `docs/DOCUMENT_SERVER_START.md`: starting and testing the Docker server over SSH
- `docs/DOCUMENT_DEPLOY.md`: deploying with Docker
- `docs/DOCUMENT_CONFIGURATION.md`: every server setting and whether Docker passes it in
- `docs/DOCUMENT_TROUBLESHOOTING.md`: when the server won't start or settings don't apply

## Scripts

- `npm start`: run the server in watch mode
- `npm test`: run the test suite
- `npm run build`: compile to `build/`

## Not built yet

- Saving results to the database (the server reports each finished match to `src/results.ts`, which only logs for now)
- Public `wss://` access for the deployed server

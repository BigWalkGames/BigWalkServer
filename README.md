# BigWalk Server

Backend for BigWalk. This repo holds two separate Node.js apps:

| Folder | What it is | Port | Status |
|---|---|---|---|
| `multiplayer/` | Colyseus multiplayer server: Quick Match (1v1 typing race) and Custom Game (private rooms with a code) | `2567` | In use. Runs in Docker on the homelab. |
| `src/` (repo root) | Fastify API, bootstrapped with Fastify-CLI | `3000` | Template only. Not in use or deployed at the moment. |

At the moment, it is mostly `multiplayer/` functionality. The two apps have their own `package.json` and `node_modules` and do not depend on each other.

## Test locally

Requires Node.js 22 or newer and npm. All commands run from `multiplayer/`.

### Start the server

```bash
npm install
```

```bash
npm start
```

This runs `tsx watch src/index.ts`, which restarts on every file save. You should see the Colyseus banner and `Listening on http://localhost:2567`.

Locally, auth is off and these are open without a password:

| URL | What it is |
|---|---|
| `http://localhost:2567/` | Colyseus playground: join rooms from the browser |
| `http://localhost:2567/monitor` | Live rooms and connections |
| `http://localhost:2567/hi` | Plain-text health check |
| `http://localhost:2567/api/hello` | JSON health check: `{"message":"Hello World"}` |

To try a setting locally, put it in front of the command, for example `QUICK_MATCH_WAIT_SECONDS=10 npm start`. All settings are listed in [DOCUMENT_CONFIGURATION.md](multiplayer/docs/DOCUMENT_CONFIGURATION.md).

### Automated tests

```bash
npm test
```

The tests run real rooms with simulated players (Quick Match, Custom Game, auth). They need no Supabase and no running server.

To check that the production build compiles:

```bash
npm run build
```

### Play a match with bots

With the server running, open two more terminals in `multiplayer/` and run one bot in each. The last number is typing speed in characters per second:

```bash
node test-players/QUICK_quick-client.mjs http://localhost:2567 5
```

```bash
node test-players/QUICK_quick-client.mjs http://localhost:2567 8
```

The two bots are paired and play a full Quick Match. To only check the connection, run `node test-client.mjs`, which joins a basic room and prints a `pong` every 2 seconds.

The bots send no Supabase token, so they only work against a server with `REQUIRE_AUTH=false` (the local default). See [DOCUMENT_TEST_PLAYERS.md](multiplayer/test-players/DOCUMENT_TEST_PLAYERS.md) for what they print.

## Change match settings with `mp-config.sh`

`mp-config.sh` changes the main match settings on the Docker server. Run it on the server, from `~/BigWalkServer/multiplayer`. To set up the server first, see [DOCUMENT_DEPLOY.md](multiplayer/docs/DOCUMENT_DEPLOY.md).

```bash
./mp-config.sh -d 20 -t 45 -w 40
```

### Parameters

| Flag | Variable it sets | Unit | Default | What it controls |
|---|---|---|---|---|
| `-d <seconds>` | `QUICK_MATCH_WAIT_SECONDS` | seconds | 30 | How long a Quick Match player waits for an opponent before getting `no_opponent` and going back to the main menu |
| `-t <seconds>` | `MATCH_DURATION_SECONDS` | seconds | 30 | How long a race lasts. Also used to work out WPM. |
| `-w <count>` | `WORD_COUNT` | words | 100 | How many words are sent to both players per match |

- Every flag is optional, but give at least one. Running the script with none prints the usage line.
- Values must be positive whole numbers. Anything else (`0`, `-5`, `1.5`, `abc`) stops the script before it writes anything.
- `-t` and `-w` apply to Custom Game races too. `-d` only affects Quick Match.

### What it does

1. Writes each given value to `multiplayer/.env`, replacing any earlier value for that variable. Flags you leave out keep their current value. Every other line in `.env` (auth settings, monitor password) is kept.
2. Runs `docker compose up -d`, which recreates the container with the new values. No rebuild is needed.

New values apply to rooms created after the restart. The restart also ends any match in progress.

### Examples

| Goal | Command |
|---|---|
| Short matches for a quick test | `./mp-config.sh -t 15 -w 30` |
| Give players longer to find an opponent | `./mp-config.sh -d 60` |
| Change everything at once | `./mp-config.sh -d 20 -t 45 -w 40` |

### Check or undo

See what the container is using:

```bash
docker compose exec multiplayer printenv QUICK_MATCH_WAIT_SECONDS MATCH_DURATION_SECONDS WORD_COUNT
```

An empty line means that setting is not set and the default is used.

To go back to a default, delete that line from `.env`, then apply it:

```bash
docker compose up -d
```

If you get `Permission denied`, run `chmod +x mp-config.sh` once, or run it as `bash mp-config.sh ...`.

Other settings (countdown length, Custom Game idle time and more) have no flag. See [DOCUMENT_CONFIGURATION.md](multiplayer/docs/DOCUMENT_CONFIGURATION.md).

## More documentation

| File | What it covers |
|---|---|
| [DOCUMENT_DEPLOY.md](multiplayer/docs/DOCUMENT_DEPLOY.md) | Deploying with Docker, updating, checking it works, day-to-day commands |
| [DOCUMENT_CONFIGURATION.md](multiplayer/docs/DOCUMENT_CONFIGURATION.md) | Every setting, its default, and whether Docker passes it to the container |
| [DOCUMENT_TROUBLESHOOTING.md](multiplayer/docs/DOCUMENT_TROUBLESHOOTING.md) | Symptoms and fixes: startup, settings, connecting, git on the server |
| [DOCUMENT_SERVER_START.md](multiplayer/docs/DOCUMENT_SERVER_START.md) | Homelab specifics: Proxmox, connecting to the LXC, testing from a Windows PC |
| [DOCUMENT_PR_SERVER.md](multiplayer/docs/DOCUMENT_PR_SERVER.md) | The PR test server: per-PR deploys, setup, turning it off |
| [DOCUMENT_QUICK_MATCH.md](multiplayer/docs/DOCUMENT_QUICK_MATCH.md) | Quick Match flow, the message contract with the web client, scoring, anti-cheat checks |
| [DOCUMENT_CUSTOM_GAME.md](multiplayer/docs/DOCUMENT_CUSTOM_GAME.md) | Custom Game rooms, room codes, the auth design, saving results |
| [DOCUMENT_TEST_PLAYERS.md](multiplayer/test-players/DOCUMENT_TEST_PLAYERS.md) | Running the test bots |

The Fastify API in `src/` runs from the repo root with `npm run dev` (port 3000). See the [Fastify documentation](https://fastify.dev/docs/latest/).

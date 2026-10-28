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

## Test a pull request with `deploy-pr.sh`

`deploy-pr.sh` deploys one pull request at a time to the test LXC on port `2568`, replacing the PR deployed before it. Production runs on its own LXC on `2567` and is not touched.

| Thing | Value |
|---|---|
| Test LXC | `192.168.4.30` |
| Port | `2568` (HTTP and WebSocket) |
| Public URL | `https://bgmptest.jdizzy.me` (Cloudflare Tunnel to `http://192.168.4.30:2568`) |
| Folder on the LXC | `~/BigWalkServer/multiplayer` |

### First-time setup (once per LXC)

Run these on the LXC as root. Connecting is the same as for production, see [DOCUMENT_SERVER_START.md](multiplayer/docs/DOCUMENT_SERVER_START.md#2-connect).

1. Check the tools. Docker Compose must be 2.24.4 or newer:

```bash
docker compose version && git --version && curl --version
```

Install git or curl if missing:

```bash
apt update && apt install -y git curl
```

2. Install the script. It runs from this copy, not from the clone, because checking out a PR replaces or removes the file in the clone:

```bash
curl -fsSL https://raw.githubusercontent.com/BigWalkGames/BigWalkServer/main/multiplayer/deploy-pr.sh -o /usr/local/bin/deploy-pr.sh && chmod +x /usr/local/bin/deploy-pr.sh
```

Run the same command again to get a newer version of the script.

3. Deploy any PR once. This clones the repo to `~/BigWalkServer`:

```bash
deploy-pr.sh <pr_number>
```

4. Create `.env`. The server is reachable from the internet through the public URL, so turn auth on. `SUPABASE_URL` must be the same project the web app uses, or every join fails with `401`:

```bash
cat > ~/BigWalkServer/multiplayer/.env <<'EOF'
REQUIRE_AUTH=true
SUPABASE_URL=https://<project-ref>.supabase.co
TRUST_PROXY=false
EOF
```

Keep `TRUST_PROXY=false` here. The server reads the first `X-Forwarded-For` address, which a caller can set to anything behind Cloudflare.

5. Deploy again so the container picks up `.env`.

### Deploy a PR

By link or number:

```bash
deploy-pr.sh https://github.com/BigWalkGames/BigWalkServer/pull/12
```

```bash
deploy-pr.sh 12
```

The last line should be `PR #12 is up on port 2568.` Run the same command again to pick up new commits on the PR, or with another PR to switch.

### Check it

On the LXC, from `~/BigWalkServer/multiplayer`. The port column should show `0.0.0.0:2568->2567/tcp` and nothing on `2567`:

```bash
docker compose ps
```

```bash
git log -1 --oneline
```

From your PC (PowerShell):

```powershell
curl.exe https://bgmptest.jdizzy.me/hi
```

Logs, restarts and settings work as in [DOCUMENT_DEPLOY.md](multiplayer/docs/DOCUMENT_DEPLOY.md#5-day-to-day-operations), and `mp-config.sh` works the same way. The test bots send no token, so they get `401` while `REQUIRE_AUTH=true`.

### Vercel previews

Web preview deployments use this server through `VITE_MULTIPLAYER_URL` set to `wss://bgmptest.jdizzy.me` for the Preview environment only (Production keeps the production server). Vite bakes the value in at build time, so redeploy a preview after changing it. Every preview talks to whichever server PR was deployed last.

### What it does

1. Removes dangling Docker images (`docker image prune -f`), the leftovers from earlier rebuilds.
2. Clones the repo to `~/BigWalkServer` if it is not there yet. Set `BIGWALK_DIR` to use another folder.
3. Stops if the clone has local changes, so nothing is thrown away.
4. Fetches the PR's latest commit (forks work too) and checks it out, detached.
5. Writes `multiplayer/docker-compose.override.yml`, which publishes the server on `2568` instead of `2567`. Compose loads it on every command in `multiplayer/`, so `mp-config.sh` keeps the port too. The file is excluded in the clone's `.git/info/exclude`, so it never counts as a local change.
6. Runs `docker compose up -d --build` in `multiplayer/`.
7. Waits up to 30 seconds for `/hi` to answer on `2568`. If it does not, it prints the last 50 log lines and exits with an error.

`multiplayer/.env` is gitignored, so it stays the same across PRs. Without one, defaults apply (`REQUIRE_AUTH=false`).

## More documentation

| File | What it covers |
|---|---|
| [DOCUMENT_DEPLOY.md](multiplayer/docs/DOCUMENT_DEPLOY.md) | Deploying with Docker, updating, checking it works, day-to-day commands |
| [DOCUMENT_CONFIGURATION.md](multiplayer/docs/DOCUMENT_CONFIGURATION.md) | Every setting, its default, and whether Docker passes it to the container |
| [DOCUMENT_TROUBLESHOOTING.md](multiplayer/docs/DOCUMENT_TROUBLESHOOTING.md) | Symptoms and fixes: startup, settings, connecting, git on the server |
| [DOCUMENT_SERVER_START.md](multiplayer/docs/DOCUMENT_SERVER_START.md) | Homelab specifics: Proxmox, connecting to the LXC, testing from a Windows PC |
| [DOCUMENT_QUICK_MATCH.md](multiplayer/docs/DOCUMENT_QUICK_MATCH.md) | Quick Match flow, the message contract with the web client, scoring, anti-cheat checks |
| [DOCUMENT_CUSTOM_GAME.md](multiplayer/docs/DOCUMENT_CUSTOM_GAME.md) | Custom Game rooms, room codes, the auth design, saving results |
| [DOCUMENT_TEST_PLAYERS.md](multiplayer/test-players/DOCUMENT_TEST_PLAYERS.md) | Running the test bots |

The Fastify API in `src/` runs from the repo root with `npm run dev` (port 3000). See the [Fastify documentation](https://fastify.dev/docs/latest/).

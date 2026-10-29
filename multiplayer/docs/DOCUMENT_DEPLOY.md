# Deploy: Running the Server with Docker

How to deploy, update, check and operate the multiplayer server in Docker. Homelab specifics (Proxmox, connecting to the LXC) are in [DOCUMENT_SERVER_START.md](DOCUMENT_SERVER_START.md). Settings are in [DOCUMENT_CONFIGURATION.md](DOCUMENT_CONFIGURATION.md), and fixes for common problems in [DOCUMENT_TROUBLESHOOTING.md](DOCUMENT_TROUBLESHOOTING.md).

## 1. Requirements

Docker with the Compose plugin (`docker compose version`), and git. Node is not needed on the server; the image brings its own.

The `Dockerfile` builds the TypeScript in one stage and runs `node build/index.js` as the unprivileged `node` user with `NODE_ENV=production`.

## 2. First time

1. Clone the `Development` branch:

```bash
git clone -b Development https://github.com/BigWalkGames/BigWalkServer.git ~/BigWalkServer
```

2. Go into the server folder:

```bash
cd ~/BigWalkServer/multiplayer
```

3. Create `.env`. It is gitignored; never commit it. Use your own Supabase project URL, its secret key (Supabase dashboard → Project Settings → API Keys), and a strong monitor password.

```bash
cat > .env <<'EOF'
REQUIRE_AUTH=true
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY='sb_secret_...'
TRUST_PROXY=false
MONITOR_USER=admin
MONITOR_PASSWORD='choose-a-strong-password'
EOF
```

Keep the single quotes around the password. Without them, a `$` in it is read as a variable and silently removed (see [DOCUMENT_TROUBLESHOOTING.md](DOCUMENT_TROUBLESHOOTING.md#2-settings-do-not-apply)).

4. Build and start:

```bash
docker compose up -d --build
```

5. Check it (see [section 4](#4-check-that-it-works)).

The container is named `bigwalk-multiplayer`, listens on port `2567` (HTTP and WebSocket on the same port) and uses `restart: unless-stopped`, so it comes back after a reboot.

## 3. Update to the latest code

```bash
git pull --ff-only && docker compose up -d --build
```

Set fast-forward-only pulls once per server so a stray local commit can never turn a pull into a surprise merge:

```bash
git config --global pull.ff only
```

Do not commit on the server. Make changes on your own machine, push, then pull on the server.

## 4. Check that it works

```bash
docker compose ps
```

```bash
docker compose logs --tail 50 multiplayer
```

```bash
curl http://localhost:2567/api/hello
```

```bash
docker compose exec multiplayer printenv REQUIRE_AUTH SUPABASE_URL
```

Expected: the container is `Up`, the logs show no error, `curl` prints `{"message":"Hello World"}`, and `printenv` prints `true` and your Supabase URL.

From another computer on the network, use the server's IP: `curl http://<server-ip>:2567/hi`. On Windows PowerShell use `curl.exe`, because plain `curl` is an alias for `Invoke-WebRequest`.

In production the playground at `/` is off. `/monitor` is on only when both `MONITOR_USER` and `MONITOR_PASSWORD` are set, and it asks for them (HTTP basic auth).

## 5. Day-to-day operations

All from `multiplayer/`.

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Follow logs (Ctrl+C stops watching, not the server) | `docker compose logs -f` |
| Last 100 log lines | `docker compose logs --tail 100 multiplayer` |
| Apply `.env` changes | `docker compose up -d` |
| Force a fresh container | `docker compose up -d --force-recreate` |
| Rebuild after a code change | `docker compose up -d --build` |
| Stop | `docker compose stop` |
| Start again | `docker compose up -d` |
| Stop and remove the container | `docker compose down` |
| See the settings compose will use | `docker compose config` |
| See the settings the container has | `docker compose exec multiplayer printenv` |

`docker compose restart` does **not** reload `.env`. Use `docker compose up -d` instead.

`docker compose config` and `printenv` print secrets such as `MONITOR_PASSWORD`. Don't paste their output into chats or issues.

Finished matches are saved to match history when `SUPABASE_SECRET_KEY` is set (`src/supabaseResultSink.ts`). A failed save is logged as `could not save match result` and never breaks the match. Without the key, matches are only logged as `match finished {...}`.

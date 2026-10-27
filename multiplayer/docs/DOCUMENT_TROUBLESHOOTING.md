# Troubleshooting

Start with the logs, from `multiplayer/` on the server: `docker compose logs --tail 100 multiplayer`. Deployment steps are in [DOCUMENT_DEPLOY.md](DOCUMENT_DEPLOY.md), settings in [DOCUMENT_CONFIGURATION.md](DOCUMENT_CONFIGURATION.md).

## 1. Server does not start

| Symptom | Cause and fix |
|---|---|
| Container exits right away, logs say `REQUIRE_AUTH=true needs SUPABASE_URL` | Auth is on but the URL is missing. Add `SUPABASE_URL` to `.env`, then `docker compose up -d`. |
| `docker compose up` says port 2567 is already in use | Something else holds the port. Find it with `ss -tlnp \| grep 2567` and stop it. |
| `docker: command not found`, or Docker fails inside a Proxmox LXC | Install Docker with the Compose plugin. In an LXC, enable Options > Features > nesting in Proxmox. |
| Build fails at `npm ci` | `package-lock.json` does not match `package.json`. Run `npm install` on your own machine, commit the updated lock file, push, pull, rebuild. |
| Build fails at `npm run build` | A TypeScript error. Run `npm run build` on your own machine to see it, fix, push. |
| Container did not come back after a reboot | Check that the Docker service starts at boot (`systemctl is-enabled docker`). The container itself uses `restart: unless-stopped`, so it stays down only if you ran `docker compose stop` before the reboot. |

## 2. Settings do not apply

| Symptom | Cause and fix |
|---|---|
| A value in `.env` has no effect | Only variables listed in `docker-compose.yml` reach the container (see [DOCUMENT_CONFIGURATION.md](DOCUMENT_CONFIGURATION.md)). Check with `docker compose exec multiplayer printenv <NAME>`. If it is empty, add the variable to `docker-compose.yml`. |
| `.env` was changed, the container still has the old value | `docker compose restart` does not reload `.env`. Run `docker compose up -d` (or `--force-recreate`). |
| `WARN The "xyz" variable is not set. Defaulting to a blank string.` | A value in `.env` contains `$`, and compose read `$xyz` as a variable and removed it. Put the value in single quotes: `MONITOR_PASSWORD='pa$sword'`. Then `docker compose up -d --force-recreate`. |
| `/monitor` returns 404 in production | `MONITOR_USER` or `MONITOR_PASSWORD` is empty in the container. Check with `printenv`. |
| `/monitor` rejects the right password | Usually the `$` problem above: the password the container has is not the one you typed. Check with `printenv MONITOR_PASSWORD`. |
| `./mp-config.sh: Permission denied` | The executable bit is missing. Run `chmod +x mp-config.sh`, or run it as `bash mp-config.sh ...`. |

## 3. Clients cannot connect or join

| Symptom | Cause and fix |
|---|---|
| `curl http://<server-ip>:2567/hi` times out from another computer | A network problem, not the server: firewall (`ufw` on the server, the Proxmox firewall on the LXC), or the computer is on a different network. Check `curl http://localhost:2567/hi` on the server first. |
| Joins fail with `401 authentication failed` | `REQUIRE_AUTH=true` and the client sent no token, an expired token, or a token from a different Supabase project. The client must pass `{ token: session.access_token }` in `joinOrCreate` / `create` / `joinById`. The server never says why a token failed, on purpose. |
| Quick Match bots get `401` | Expected with auth on. The bots send no token. Test bots against a server with `REQUIRE_AUTH=false`. |
| Every token is rejected, even fresh ones | `SUPABASE_URL` points to the wrong project or has a typo. The token's issuer must be `<SUPABASE_URL>/auth/v1`. Check that `curl <SUPABASE_URL>/auth/v1/.well-known/jwks.json` returns keys from the server. |
| Client error about a mixed-content or insecure WebSocket | A page served over `https://` can only open `wss://`. The server speaks plain `ws://`; put it behind TLS (reverse proxy or tunnel) for a deployed web client. |
| Joining a room code says "not found" | The code is wrong or the room closed. Call `GET /api/room-code/status?code=...` to tell which. After a server restart, old codes read as `invalid`. |
| `rate_limited` from the room-code lookup | Too many lookups in a minute. Wait a minute. Behind a proxy, set `TRUST_PROXY=true` so the limit is per caller. |

## 4. Git on the server

| Symptom | Cause and fix |
|---|---|
| `git pull` says `divergent branches` | The server has a local commit that GitHub does not. See it with `git log --oneline origin/Development..HEAD`. If it is not needed, match GitHub exactly with `git reset --hard origin/Development` (this deletes local commits and edits to tracked files; `.env` is untracked and safe). |
| `checkout` or `pull` fails with `Your local changes would be overwritten` | A tracked file was edited on the server. See the change with `git diff`. A mode-only change (`old mode 100644 / new mode 100755`) is just `chmod`; ignore those with `git config core.fileMode false`. |
| `Password authentication is not supported` on push | GitHub needs a personal access token or SSH key, not your password. Better: don't push from the server. Commit on your own machine instead. |
| `git status` shows stray files named like `100755` or `FETCH_HEAD` | Pasted command output ran in the shell, and its `>` created files. Check they are empty (`ls -la`), then delete them. |

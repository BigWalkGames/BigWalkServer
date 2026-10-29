# PR Test Server

A second copy of the multiplayer server that runs the code of the PR being tested, so testers and Vercel previews can play against it without checking out the branch. The live server ([DOCUMENT_DEPLOY.md](DOCUMENT_DEPLOY.md)) is not touched.

## 1. How it works

On every push to a PR into `Development`, [`.github/workflows/pr-test-server.yml`](../../.github/workflows/pr-test-server.yml) runs on a self-hosted GitHub runner on the homelab. It checks out the PR merged with `Development`, rebuilds the PR container, checks `/api/hello`, and comments the address on the PR.

There is **one** PR server. A push to another PR replaces it. To bring a PR back, push to it again or re-run its **PR Test Server** job.

Vercel previews reach it at `wss://<pr-host>` through a Cloudflare Tunnel.

### Separation from the live server

| | Live server | PR server |
|---|---|---|
| Compose file | `docker-compose.yml` | `docker-compose.pr.yml` |
| Compose project | `multiplayer` | `bigwalk-pr` |
| Container | `bigwalk-multiplayer` | `bigwalk-multiplayer-pr` |
| Image | built by compose | `bigwalk-multiplayer-pr:latest` |
| Port | `2567` | `2568` |
| Settings | `~/BigWalkServer/multiplayer/.env` | `~/bigwalk-pr.env` |
| Code | `~/BigWalkServer` (you pull by hand) | the runner's own work folder |
| Limits | none | 512 MB memory, 1 CPU |

The workflow only runs `docker compose` with `-p bigwalk-pr -f docker-compose.pr.yml`, and only prunes images labelled `bigwalk.pr=true`.

The runner's user is in the `docker` group, which is root-equivalent on that host. A workflow file changed in a PR could therefore reach the live container if both share a host. For a hard guarantee, put the PR server in **its own LXC** (recommended, steps below). Sharing the live server's LXC also works, since nothing collides, but then the separation is by convention, not enforced.

## 2. Setup

### 2.1 LXC

Create a new Docker LXC the same way as the live one ([DOCUMENT_SERVER_START.md](DOCUMENT_SERVER_START.md)): Options > Features > nesting on. Install Docker with the Compose plugin and git. Create a normal user for the runner:

```bash
adduser runner
```

```bash
usermod -aG docker runner
```

### 2.2 Settings file

As `runner`, create `~/bigwalk-pr.env`. Same keys as the live `.env`; use a different monitor password. `TRUST_PROXY=true` because requests arrive through the tunnel.

```bash
cat > ~/bigwalk-pr.env <<'EOF'
REQUIRE_AUTH=true
SUPABASE_URL=https://<project-ref>.supabase.co
TRUST_PROXY=true
MONITOR_USER=admin
MONITOR_PASSWORD='choose-a-strong-password'
EOF
```

```bash
chmod 600 ~/bigwalk-pr.env
```

It uses the same Supabase project as the live server (for sign-in only; results are not saved yet).

### 2.3 GitHub runner

1. GitHub: **BigWalkServer > Settings > Actions > Runners > New self-hosted runner**, Linux x64. Run the download and `config.sh` commands it shows, as `runner`, in `~/actions-runner`. When `config.sh` asks for labels, enter `bigwalk-pr-server`.
2. Install it as a service so it survives reboots:

```bash
cd ~/actions-runner && sudo ./svc.sh install runner && sudo ./svc.sh start
```

3. **Required, because the repo is public:** **Settings > Actions > General > Approval for running fork pull request workflows from contributors**, choose **Require approval for all external contributors**. The workflow skips fork PRs, but a fork can edit the workflow itself, so this setting is what actually stops untrusted code reaching the runner.

### 2.4 Cloudflare Tunnel

1. Cloudflare dashboard: **Zero Trust > Networks > Tunnels > Create a tunnel** (Cloudflared). Name it `bigwalk-pr`.
2. Install the connector on the PR LXC with the command it shows.
3. Add a public hostname, e.g. `mp-pr.<your-domain>`, service **HTTP** `localhost:2568`. WebSockets work without extra settings.

### 2.5 Repo variable and Vercel

1. BigWalkServer: **Settings > Secrets and variables > Actions > Variables**, add `PR_SERVER_HOST` = `mp-pr.<your-domain>`.
2. Vercel project `bigwalk`: **Settings > Environment Variables**, add `VITE_MULTIPLAYER_URL` = `wss://mp-pr.<your-domain>` for **Preview** only. Production keeps its own value. Previews built after this point use it.

### 2.6 Check it

Open or push to a PR into `Development`. The **PR Test Server** job should pass and comment on the PR. Then, from any machine:

```bash
curl https://mp-pr.<your-domain>/api/hello
```

Expected: `{"message":"Hello World"}`.

## 3. Day-to-day

Run these on the PR LXC, from the runner's checkout (`~/actions-runner/_work/BigWalkServer/BigWalkServer/multiplayer`), or use `docker logs` directly.

| Task | Command |
|---|---|
| Status | `docker ps --filter name=bigwalk-multiplayer-pr` |
| Logs | `docker logs --tail 100 -f bigwalk-multiplayer-pr` |
| Which PR is running | the latest **PR Test Server** run under **Actions** |
| Stop it | `docker stop bigwalk-multiplayer-pr` |

## 4. Turning it off (rollback)

Everything here is additive, so removing it returns to the previous setup. Do as many steps as needed:

1. **Pause:** **Actions > PR Test Server > ... > Disable workflow**. Nothing deploys; the last PR keeps running.
2. **Stop the container and its image:**

```bash
docker rm -f bigwalk-multiplayer-pr && docker image rm bigwalk-multiplayer-pr:latest
```

3. **Remove the runner:** `cd ~/actions-runner && sudo ./svc.sh uninstall`, then delete it under **Settings > Actions > Runners**.
4. **Remove the tunnel route** for `mp-pr.<your-domain>` (or the whole `bigwalk-pr` tunnel) in Cloudflare.
5. **Vercel:** delete the Preview `VITE_MULTIPLAYER_URL`, or set it back to its previous value.
6. **Code:** delete `.github/workflows/pr-test-server.yml` and `multiplayer/docker-compose.pr.yml` in a PR.
7. **LXC:** if it was a dedicated LXC, delete it in Proxmox.

None of these steps touch `bigwalk-multiplayer`, `~/BigWalkServer` or its `.env`.

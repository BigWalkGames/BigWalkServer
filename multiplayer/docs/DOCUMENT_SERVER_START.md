# Server Start: Launching and Testing Over SSH

How to start, check, update and test the Colyseus multiplayer server on the homelab. The server runs in Docker inside a Proxmox LXC container.

## 1. Where things are

| Thing | Value |
|---|---|
| Proxmox host | `<proxmox-ip>` (the address you use for the web UI, without `:8006`) |
| Docker LXC | ID from `pct list`, LAN address `192.168.4.65` |
| Repo | `https://github.com/BigWalkGames/BigWalkServer`, branch `Development` |
| Folder on the LXC | `~/BigWalkServer/multiplayer` |
| Container name | `bigwalk-multiplayer` |
| Port | `2567` (HTTP and WebSocket) |

Replace `<proxmox-ip>` and `<ID>` in the commands below.

## 2. Connect

From PowerShell on your PC:

```powershell
ssh root@<proxmox-ip>
```

On the Proxmox host, enter the Docker LXC (no password needed):

```bash
pct list
```

```bash
pct enter <ID>
```

If the LXC has its own user and SSH, you can connect to it directly instead:

```powershell
ssh <user>@192.168.4.65
```

## 3. First-time setup (once)

Check Docker, git and that the port is free:

```bash
docker compose version && git --version && ss -tlnp | grep 2567
```

Install git if it is missing:

```bash
apt update && apt install -y git
```

Clone the repo (public, so no login is needed):

```bash
git clone -b Development https://github.com/BigWalkGames/BigWalkServer.git ~/BigWalkServer
```

## 4. Launch

```bash
cd ~/BigWalkServer/multiplayer
```

```bash
docker compose up -d --build
```

Watch the logs (Ctrl+C stops watching, not the server):

```bash
docker compose logs -f
```

Check that it is running:

```bash
docker compose ps
```

## 5. Update to the latest code

```bash
cd ~/BigWalkServer && git pull && cd multiplayer && docker compose up -d --build
```

## 6. Stop, restart, remove

```bash
docker compose stop
```

```bash
docker compose up -d
```

```bash
docker compose restart
```

```bash
docker compose down
```

`stop` should finish in about 1 second. If it takes about 10 seconds, the process is not receiving the shutdown signal.

## 7. Test from your PC

Run these in PowerShell, from the `server\multiplayer` folder. The URL uses `http://`; the Colyseus SDK upgrades it to WebSocket itself.

```powershell
cd C:\Users\jStizzy\Desktop\Projects\BigWalk\server\multiplayer
```

Check the port is reachable. It should print the `/hi` greeting:

```powershell
curl.exe http://192.168.4.65:2567/hi
```

Join the basic room. Expect `joined as <id>` and a `pong` line every 2 seconds:

```powershell
node test-client.mjs http://192.168.4.65:2567
```

Run a full Quick Match. Open two PowerShell windows and run one command in each. The last number is typing speed in characters per second:

```powershell
node test-players/QUICK_quick-client.mjs http://192.168.4.65:2567 5
```

```powershell
node test-players/QUICK_quick-client.mjs http://192.168.4.65:2567 8
```

See `test-players/DOCUMENT_TEST_PLAYERS.md` for what the bot prints.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| `curl.exe` times out | Network, not Colyseus: Proxmox firewall on the LXC, `ufw` in the LXC, or the PC is not on `192.168.4.x` to `192.168.7.x`. |
| `Cannot find module` running a test | You are in the wrong folder. `cd` to `server\multiplayer` first. |
| `docker compose up` says the port is in use | Run `ss -tlnp \| grep 2567` and stop whatever holds it. |
| Server exits right after start | Run `docker compose logs` and read the last lines. |
| Container did not return after a reboot | Check `docker compose ps`. The compose file uses `restart: unless-stopped`. |
| Docker commands fail inside the LXC | The LXC needs Options > Features > nesting enabled in Proxmox. |

In the container `NODE_ENV=production`, so `/monitor` and the playground at `/` are off on purpose.

## 9. Not covered yet

Public access over TLS (`wss://`), for example through a Cloudflare Tunnel. Until that is set up, the server is only reachable on the LAN.

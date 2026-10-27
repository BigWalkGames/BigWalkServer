# BigWalk Multiplayer (Colyseus connectivity test)

A small, self-contained [Colyseus](https://colyseus.io) server that proves two clients can connect to the same room and exchange messages through the server. This is the networking foundation for Quick Match (1v1), not the game itself.

This folder is **separate from the Fastify server** in `../src`. It has its own `package.json` and its own `node_modules`, and it runs as its own process on port **2567**, so it does not touch or depend on the Fastify app.

## What it does

- Defines one room, `my_room` (`src/rooms/MyRoom.ts`), capped at **2 players** (`maxClients = 2`).
- When a client sends a `ping` message, the server broadcasts a `pong` message to everyone in the room, including the sender.
- `test-client.mjs` joins `my_room`, sends a ping every 2 seconds, and prints each pong with the round-trip time.

It does **not** yet include word banks, race progress, scoring, matchmaking timeouts, or disconnect handling. Those come in later tickets.

## Requirements

- Node.js 22 or newer
- npm

## Run it

From this folder (`server/multiplayer`):

```bash
npm install
npm start
```

You should see the Colyseus banner and `Listening on http://localhost:2567`. Leave this terminal running. The server restarts automatically when you save a file.

## Test it with two clients

Open two more terminal windows. In each one:

```bash
cd server/multiplayer
node test-client.mjs
```

Expected result:

- Each client prints `joined as <id>`.
- Each client then prints `pong from me` and `pong from opponent` about every 2 seconds, with a round-trip time in milliseconds.
- The server terminal logs `(1/2)` when the first client joins and `(2/2)` when the second joins, then one line per ping.

To watch it live, open `http://localhost:2567/monitor`. While both clients are running it should show 2 connections and 1 room.

## Test across two computers

Both computers must be on the same network.

1. On the computer running the server, find its IP address (on a Mac: `ipconfig getifaddr en0`).
2. On the other computer, run the client with that address:

```bash
node test-client.mjs http://<SERVER-IP>:2567
```

## Useful URLs (development only)

| URL | What it is |
|---|---|
| `http://localhost:2567/monitor` | Colyseus monitor: active rooms and connections |
| `http://localhost:2567/` | Colyseus playground: join a room from the browser |

## Layout

```
multiplayer/
  src/
    index.ts            starts the server
    app.config.ts       registers the room (my_room)
    rooms/MyRoom.ts     the ping/pong room
    rooms/schema/       room state definition (unused so far)
  test-client.mjs       command-line test client
  package.json          own dependencies (Colyseus 0.18)
```

## Not yet done

- Quick Match pairing, 30-second wait timeout, and returning to the menu
- Opponent-leave and connection-drop handling
- Shared word bank, live progress sync, and server-side scoring
- Running behind `wss://` on the staging server
- Integration with the web client

# Custom Game (room codes): Server Reference

Covers cards P26 (create a room with a code), P27 (join by code), P28 (lobby starts a Versus match) and P29 (room closes / disconnect). Quick Match is described in `DOCUMENT_QUICK_MATCH.md`; this file only covers what is new.

## 1. What changed in the code

| File | What it is |
|---|---|
| `src/rooms/MatchRoom.ts` | NEW. The race logic that used to live in `QuickMatchRoom` (countdown, progress checks, scoring, leave handling). Quick Match and Custom Game both extend it, so a Custom Game race behaves exactly like a Quick Match race. |
| `src/rooms/QuickMatchRoom.ts` | Now only the pairing part: wait timer, `no_opponent`, start when two players are in. Behaviour is unchanged (the 9 existing tests pass untouched). |
| `src/rooms/CustomGameRoom.ts` | NEW. Private room, lobby, ready, idle close. Room type name: `custom_game`. |
| `src/rooms/roomCodes.ts` | NEW. Code generation, code status (open / full / expired / invalid), rate limit. |
| `src/auth.ts` | NEW. Checks the Supabase session token on join. |
| `src/results.ts` | NEW. Where finished matches are reported (see section 6). |
| `src/app.config.ts` | Registers `custom_game`, adds `GET /api/room-code/status`, checks auth settings at startup. |
| `test/helpers/server.ts` | NEW. One test server shared by all test files (a second `boot()` of the same config in one process fails). |

## 2. How it works (client view)

1. **Create (P26).** `client.create("custom_game", { token })`. The room id IS the code: `room.roomId` (5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, no 0/O/1/I/L). The room is private: it is never listed and Quick Match never puts anyone in it (it is a different room type).
2. **Join (P27).** Optional: `GET /api/room-code/status?code=XXXXX` first, to show the right error. Then `client.joinById(code, { token })`. Codes are case-insensitive on the client (upper-case it before sending).
3. **Lobby.** Everyone in the room gets `lobby { code, players: [{ id, ready }] }` whenever someone joins, leaves or changes ready.
4. **Ready (P28).** Client sends `ready { ready: true }` (`ready: false` undoes it; no body means true). When both players are ready the same flow as Quick Match runs: `match_found`, `countdown`, `go`, `opponent_progress`, `match_result`.
5. **Leave / close (P29).** If one player leaves the lobby or drops mid-match, the other gets `opponent_left` and the room closes a moment later. If nobody starts a match within `CUSTOM_ROOM_IDLE_SECONDS`, everyone gets `room_closed { reason: "idle" }`. A match abandoned mid-race has no result and nothing is saved.
6. **Finishing early.** When a player types the whole text, the server ends the race right away (both modes). The winner rule is the same as Quick Match (highest Net WPM, then accuracy, else draw). `match_result` then carries `durationSeconds`, the time the race really took, and Net WPM is worked out over that time. If nobody finishes, the race ends at the full duration as before.
7. **Rematch (Custom Game only).** After `match_result` the room stays open and goes back to its lobby: the server sends `lobby` with nobody ready and unlocks the room. When both players send `ready` again, a new match starts with new words (`match_found`, `countdown`, `go`, ...), and each match saves its own result. If a player leaves on the results screen, the other gets `opponent_left` and the room closes. The idle timer starts again, so a room nobody rematches in closes after `CUSTOM_ROOM_IDLE_SECONDS`. Quick Match still closes its room after the results.

### Join errors (P27)

| `status` | Meaning | Suggested message |
|---|---|---|
| `open` | Room exists and has a free seat | (join) |
| `full` | Two players already, or the match already started | "That room is full." |
| `expired` | The room existed and has closed | "That room has closed." |
| `invalid` | Not a code, or no such room | "That code isn't right." |
| `rate_limited` | Too many lookups | "Slow down and try again in a minute." |

`joinById` itself fails with Colyseus's "not found" for both wrong and closed codes, which is why the status check exists. "Expired" is remembered in server memory for `CLOSED_CODE_MEMORY_MINUTES` (default 60); after a server restart an old code reads as `invalid`.

### Disconnect messages (P29, client side)

| What the client sees | Message |
|---|---|
| `opponent_left` | "Your friend left. The room is closed." |
| `room_closed` (`idle`) | "The room closed because nobody started a match." |
| Connection drops / `onLeave` with no event first | "Connection lost." (reuse the P18 handling) |

## 3. Authentication (token check)

Off by default so local development and tests need no Supabase. Turn it on for any server reachable from the internet.

| Variable | Meaning |
|---|---|
| `REQUIRE_AUTH=true` | Every join (Quick Match and Custom Game) must send `{ token: <Supabase access token> }`. |
| `SUPABASE_URL` | Your project URL. Required when `REQUIRE_AUTH=true`; the server refuses to start without it. |
| `SUPABASE_JWT_SECRET` | Only for legacy projects that still sign with a shared secret (HS256). |

The server checks the signature, issuer, audience and expiry with Supabase's public keys. It needs no database access and no secret key. A failed check always answers `401 authentication failed` with no reason. Client change needed: pass `{ token: session.access_token }` in the join/create options (use the guest session's token for guests).

## 4. Settings

| Variable | Default | Meaning |
|---|---|---|
| `CUSTOM_ROOM_IDLE_SECONDS` | 600 | Lobby with no match started closes after this long. |
| `CLOSED_CODE_MEMORY_MINUTES` | 60 | How long a closed code reads as `expired`. |
| `CODE_LOOKUPS_PER_MINUTE` | 120 (20 per caller with `TRUST_PROXY=true`) | Code lookups allowed per minute. |
| `TRUST_PROXY` | off | Set `true` only when the server sits behind a proxy that sets `X-Forwarded-For`; lookups are then limited per caller. |

The Quick Match settings (`COUNTDOWN_SECONDS`, `MATCH_DURATION_SECONDS`, `WORD_COUNT`, `RESULT_CLOSE_DELAY_MS`, ...) apply to Custom Game races too.

## 5. Security notes

- Codes are random (about 28 million possibilities), the room is private, and lookups are rate limited, so guessing a live code is impractical. A code is only a way in; with `REQUIRE_AUTH=true` the player must also be signed in.
- Do not log full tokens. The server never does.
- `/monitor` in production is only mounted with `MONITOR_USER` and `MONITOR_PASSWORD` set (basic auth). Use a strong password and never commit it.

## 6. Saving results (not connected to a database yet)

Both modes report finished matches to a "result sink" (`src/results.ts`). The default just logs. Custom Game results carry `mode: "custom"` and `roomCode`. To store them, write a sink that inserts into Supabase using a restricted server-side key, and pass it to `setResultSink()`; the rooms do not change. That needs database access and an agreed table, so ask Justin D / the owner first.

## 7. Tests

`npm test` runs everything (37 tests): `test/QuickMatchRoom.test.ts` (pairing, progress checks, Net WPM and errors, leaving), `test/CustomGameRoom.test.ts` (code format, lobby, Quick Match separation, status answers, HTTP endpoint, wrong/full code, rate limit, ready, shared words and results, result saved with room code, finishing the text ends the race, rematch, leaving on the results screen, leave closes room, drop mid-race, idle close) and `test/auth.test.ts` (valid, forged, expired, wrong issuer/audience, missing, over-long tokens; room joins with and without a token).

## 8. Not built yet

- Client screens and sending the token (Matthew / Justin P).
- Saving results to the database (section 6).

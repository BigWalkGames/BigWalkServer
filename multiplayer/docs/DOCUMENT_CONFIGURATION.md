# Configuration: Server Settings

All settings are environment variables, read on the server only, never from clients. Locally, put them in front of the command (`QUICK_MATCH_WAIT_SECONDS=10 npm start`). In Docker, put them in `multiplayer/.env`, or use `./mp-config.sh` for the three main match settings (see the [README](../../README.md#change-match-settings-with-mp-configsh)).

**In Docker, only the variables listed in `docker-compose.yml` reach the container.** Those are the ones marked "Yes" below. A line in `.env` for any other variable does nothing until it is added to the `environment:` list in `docker-compose.yml`.

## 1. Security

| Variable | Default | In compose | Meaning |
|---|---|---|---|
| `REQUIRE_AUTH` | `false` | Yes | `true`: every Quick Match and Custom Game join must send `{ token: <Supabase access token> }`. Turn it on for any server reachable from the internet. |
| `SUPABASE_URL` | (none) | Yes | Supabase project URL. Required when `REQUIRE_AUTH=true`; the server refuses to start without it. Tokens are checked against the project's public keys, so no secret key is needed. |
| `SUPABASE_JWT_SECRET` | (none) | Yes | Only for legacy Supabase projects that sign tokens with a shared secret (HS256). Leave empty otherwise. |
| `SUPABASE_SECRET_KEY` | (none) | Yes | Project secret key (`sb_secret_...`, or the legacy `service_role` key). With `REQUIRE_AUTH=true`, finished Quick Match and Custom Game results are saved to match history (`users.multiplayer_results`). Empty: results are only logged. Never put it in the web app. |
| `TRUST_PROXY` | `false` | Yes | `true` only when a reverse proxy in front of the server sets `X-Forwarded-For`. Room-code lookups are then rate limited per caller instead of all callers sharing one limit. Turning it on without a proxy lets anyone dodge the rate limit. |
| `MONITOR_USER` / `MONITOR_PASSWORD` | (none) | Yes | Login for `/monitor` in production. If either is empty, `/monitor` is off. |

## 2. Match settings

| Variable | Default | In compose | Meaning |
|---|---|---|---|
| `QUICK_MATCH_WAIT_SECONDS` | 30 | Yes | How long a lone Quick Match player waits before `no_opponent` |
| `MATCH_DURATION_SECONDS` | 30 | Yes | Race length |
| `WORD_COUNT` | 100 | Yes | Words sent per match |
| `COUNTDOWN_SECONDS` | 3 | No | Countdown before the race |
| `MAX_CHARS_PER_SECOND` | 25 | No | Plausibility limit on reported typing (about 300 WPM) |
| `RESULT_CLOSE_DELAY_MS` | 1000 | No | Pause before a room closes, so both clients get the result |
| `CUSTOM_ROOM_IDLE_SECONDS` | 600 | No | A Custom Game lobby with no match started closes after this long |
| `CLOSED_CODE_MEMORY_MINUTES` | 60 | No | How long a closed room code reads as `expired` instead of `invalid` |
| `CODE_LOOKUPS_PER_MINUTE` | 120 (20 per caller with `TRUST_PROXY=true`) | No | Rate limit for `GET /api/room-code/status` |

Match settings apply to both Quick Match and Custom Game. Bad or missing values fall back to the default. They are read when a room is created, so a change affects new rooms only.

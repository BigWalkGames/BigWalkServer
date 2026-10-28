#!/usr/bin/env bash
# Deploys a BigWalkServer pull request on this Docker host for testing, on port 2568 (production uses 2567).
# Run it from a copy outside the clone (see README), since checking out a PR replaces this file.
set -euo pipefail

REPO_URL=https://github.com/BigWalkGames/BigWalkServer.git
REPO_DIR=${BIGWALK_DIR:-$HOME/BigWalkServer}
PORT=2568
OVERRIDE=multiplayer/docker-compose.override.yml

usage() {
  echo "Usage: deploy-pr.sh <pr_link | pr_number>" >&2
  exit 1
}

main() {
  [[ $# -eq 1 ]] || usage

  local pr
  if [[ $1 =~ ^[1-9][0-9]*$ ]]; then
    pr=$1
  elif [[ $1 =~ ^https://github\.com/BigWalkGames/BigWalkServer/pull/([1-9][0-9]*)([/?#].*)?$ ]]; then
    pr=${BASH_REMATCH[1]}
  else
    echo "Not a BigWalkServer PR link: '$1'" >&2
    exit 1
  fi

  # The port override uses the !override tag, added in Compose 2.24.4. Older versions would publish both ports.
  local compose_version
  compose_version=$(docker compose version --short)
  compose_version=${compose_version#v}
  if [[ $(printf '%s\n' 2.24.4 "$compose_version" | sort -V | head -1) != 2.24.4 ]]; then
    echo "Docker Compose 2.24.4 or newer is needed, found $compose_version" >&2
    exit 1
  fi

  # Dangling images are the ones earlier rebuilds left behind.
  docker image prune -f

  [[ -d $REPO_DIR/.git ]] || git clone "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
  grep -qxF "/$OVERRIDE" .git/info/exclude || echo "/$OVERRIDE" >> .git/info/exclude

  if [[ -n $(git status --porcelain) ]]; then
    echo "$REPO_DIR has local changes. Discard them first (do not commit on the server):" >&2
    git status --short >&2
    exit 1
  fi

  git fetch origin "pull/$pr/head"
  git -c advice.detachedHead=false checkout --detach FETCH_HEAD
  echo "PR #$pr at $(git log -1 --format='%h %s')"

  [[ -d multiplayer ]] || { echo "PR #$pr has no multiplayer/ folder" >&2; exit 1; }
  # Compose loads this file on every command in multiplayer/, so mp-config.sh keeps the port too.
  cat > "$OVERRIDE" <<EOF
services:
  multiplayer:
    ports: !override
      - "$PORT:2567"
EOF
  cd multiplayer
  [[ -f .env ]] || echo "No multiplayer/.env, so defaults apply (REQUIRE_AUTH=false)."

  docker compose up -d --build

  echo "Waiting for http://localhost:$PORT/hi ..."
  for _ in {1..30}; do
    if curl -fsS "http://localhost:$PORT/hi" > /dev/null 2>&1; then
      echo "PR #$pr is up on port $PORT."
      return
    fi
    sleep 1
  done
  echo "No answer after 30 seconds. Last logs:" >&2
  docker compose logs --tail 50 multiplayer >&2
  exit 1
}

# main runs only after bash has read the whole file.
main "$@"

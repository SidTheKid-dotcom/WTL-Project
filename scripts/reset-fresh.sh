#!/usr/bin/env bash
# Reset Intercom: stop Docker (and named volumes), wipe Chroma + SQLite, start Docker again.
# Local API (uvicorn) is not in Docker—stop it yourself or pass --kill-api to free :8000.
#
# Usage:
#   ./scripts/reset-fresh.sh
#   ./scripts/reset-fresh.sh --kill-api
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KILL_API=false
for arg in "$@"; do
  if [[ "$arg" == "--kill-api" ]]; then
    KILL_API=true
  fi
done

echo "==> Intercom — full local reset (from: $ROOT)"
echo

if $KILL_API; then
  echo "==> Stopping process on port 8000 (uvicorn / API) if any..."
  if command -v lsof &>/dev/null; then
    pids=$(lsof -ti:8000 2>/dev/null || true)
    if [[ -n "${pids}" ]]; then
      echo "    Killing PIDs: ${pids}"
      kill ${pids} 2>/dev/null || true
      sleep 0.5
      pids2=$(lsof -ti:8000 2>/dev/null || true)
      if [[ -n "${pids2}" ]]; then
        kill -9 ${pids2} 2>/dev/null || true
      fi
    else
      echo "    (nothing on :8000)"
    fi
  else
    echo "    (lsof not found; skip --kill-api)"
  fi
  echo
else
  echo "    Note: if uvicorn is running, stop it (Ctrl+C) or re-run with --kill-api"
  echo
fi

dc_down() {
  if docker compose version &>/dev/null; then
    docker compose down -v "$@"
  else
    docker-compose down -v "$@"
  fi
}

dc_up() {
  if docker compose version &>/dev/null; then
    docker compose up -d "$@"
  else
    docker-compose up -d "$@"
  fi
}

echo "==> Stopping Docker Compose services and removing project volumes (e.g. Chroma in Docker)..."
if command -v docker &>/dev/null && [[ -f "$ROOT/docker-compose.yml" ]]; then
  (cd "$ROOT" && dc_down) || true
  echo "    Docker Compose down complete."
else
  echo "    (docker or docker-compose.yml not available; skip)"
fi
echo

echo "==> Deleting local app database files..."
# Embedded Chroma (used by the FastAPI app) and SQLite
rm -rf "${ROOT}/backend/chroma_data" "${ROOT}/backend/data"
echo "    Removed: backend/chroma_data, backend/data"
echo

echo "==> Starting Docker Compose (fresh empty volumes)..."
if command -v docker &>/dev/null && [[ -f "$ROOT/docker-compose.yml" ]]; then
  (cd "$ROOT" && dc_up)
  echo "    docker compose up -d complete."
else
  echo "    (skipped — no docker)"
fi
echo

echo "==> Done."
echo "    Start the API (from repo root, with your venv active if you use one):"
echo "      cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000"
echo "    Reload the Chrome extension after backend changes if needed."
echo

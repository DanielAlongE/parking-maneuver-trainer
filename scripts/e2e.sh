#!/usr/bin/env bash
# End-to-end test of the whole workflow: invite, claim, submit, server replay,
# review, points and payout, driven in a real browser against real services.
#
#   DATABASE_URL=postgresql://... REDIS_URL=redis://... bash scripts/e2e.sh
#
# DATABASE_URL must point at a throwaway database: its public schema is dropped.
# Needs the Playwright Chromium browser: pnpm --filter @mt/web exec playwright install chromium
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${DATABASE_URL:?set DATABASE_URL to a throwaway database}"
: "${REDIS_URL:?set REDIS_URL}"
API_PORT="${API_PORT:-8077}"
WEB_PORT="${WEB_PORT:-5177}"
LOGS="${E2E_LOGS:-$ROOT/.e2e-logs}"
mkdir -p "$LOGS"
export PUBLIC_URL="http://localhost:$WEB_PORT"

pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 120); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 0.5
  done
  echo "timed out waiting for $1" >&2
  return 1
}

cd "$ROOT/apps/api"
uv run python - <<'EOF'
import os, psycopg
with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
    c.execute("DROP SCHEMA public CASCADE")
    c.execute("CREATE SCHEMA public")
EOF
uv run python -m mt_api.cli migrate
INVITE="$(uv run python -m mt_api.cli create-admin --email admin@e2e.test --name "Ada Admin" | tail -n 1)"
uv run uvicorn mt_api.main:app --app-dir src --port "$API_PORT" >"$LOGS/api.log" 2>&1 &
pids+=($!)

cd "$ROOT"
SWEEP_INTERVAL_MS=5000 pnpm --filter @mt/replay-worker start >"$LOGS/worker.log" 2>&1 &
pids+=($!)

cd "$ROOT/apps/web"
pnpm exec vite build >"$LOGS/build.log" 2>&1
API_URL="http://localhost:$API_PORT" pnpm exec vite preview --port "$WEB_PORT" --strictPort >"$LOGS/web.log" 2>&1 &
pids+=($!)

wait_for "http://localhost:$API_PORT/api/health"
wait_for "http://localhost:$WEB_PORT/api/health"

E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_ADMIN_INVITE="$INVITE" \
  pnpm exec playwright test -c playwright.workflow.config.ts "$@"

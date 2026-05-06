#!/usr/bin/env bash
set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SITE_DIR/.env.web}"
API_BIN="$SITE_DIR/.runtime/neuravpn-web-api"
API_LOG="${API_LOG:-/tmp/neuravpn-web-api.log}"
SITE_LOG="${SITE_LOG:-/tmp/neuravpn-site.log}"
SITE_PORT="${SITE_PORT:-8085}"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

mkdir -p "$SITE_DIR/.runtime"
cd "$SITE_DIR"

go build -o "$API_BIN" ./cmd/web

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${SITE_PID:-}" ] && kill "$SITE_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

"$API_BIN" >>"$API_LOG" 2>&1 &
API_PID=$!

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$SITE_PORT" --bind 0.0.0.0 >>"$SITE_LOG" 2>&1 &
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$SITE_PORT" --bind 0.0.0.0 >>"$SITE_LOG" 2>&1 &
else
  echo "python3 is required for static site server"
  exit 1
fi
SITE_PID=$!

echo "site: http://${WEB_HOST:-127.0.0.1}:$SITE_PORT/cabinet/"
echo "api:  http://${WEB_HOST:-127.0.0.1}:${WEB_PORT:-8090}/healthz"
echo "logs:"
echo "  tail -f $API_LOG"
echo "  tail -f $SITE_LOG"

wait -n "$API_PID" "$SITE_PID"

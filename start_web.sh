#!/usr/bin/env bash
set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SITE_DIR/.env.web}"
API_BIN="$SITE_DIR/.runtime/neuravpn-web-api"
# Logs live on disk (rotated by deploy/logrotate-neuravpn-site), not in the /tmp tmpfs.
LOG_DIR="${LOG_DIR:-/var/log/neuravpn-site}"
API_LOG="${API_LOG:-$LOG_DIR/web-api.log}"
SITE_LOG="${SITE_LOG:-$LOG_DIR/site.log}"
SITE_PORT="${SITE_PORT:-8085}"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

mkdir -p "$SITE_DIR/.runtime" "$(dirname "$API_LOG")" "$(dirname "$SITE_LOG")"
cd "$SITE_DIR"

# Build on disk, not in /tmp: /tmp is a small tmpfs, and a build killed by a
# restart leaves its go-build* work dir behind. Clear leftovers before every build.
GO_TMP="$SITE_DIR/.runtime/gotmp"
rm -rf "$GO_TMP"
mkdir -p "$GO_TMP"
export GOTMPDIR="$GO_TMP"

# A failed build keeps the last good binary running instead of taking the site down.
if go build -o "$API_BIN.new" ./cmd/web; then
  mv -f "$API_BIN.new" "$API_BIN"
elif [ -x "$API_BIN" ]; then
  echo "go build failed; starting the previous $API_BIN" >&2
  rm -f "$API_BIN.new"
else
  echo "go build failed and no previous binary exists" >&2
  exit 1
fi
rm -rf "$GO_TMP"

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${SITE_PID:-}" ] && kill "$SITE_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

"$API_BIN" >>"$API_LOG" 2>&1 &
API_PID=$!

if command -v python3 >/dev/null 2>&1; then
  python3 "$SITE_DIR/deploy/serve_static.py" --port "$SITE_PORT" >>"$SITE_LOG" 2>&1 &
elif command -v python >/dev/null 2>&1; then
  python "$SITE_DIR/deploy/serve_static.py" --port "$SITE_PORT" >>"$SITE_LOG" 2>&1 &
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

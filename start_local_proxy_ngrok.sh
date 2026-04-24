#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3001}"
HOST="${HOST:-0.0.0.0}"
NGROK_BIN="${NGROK_BIN:-/home/davivieira/suporte_internoIA/tools/ngrok/ngrok}"
NGROK_CONFIG="${NGROK_CONFIG:-/home/davivieira/suporte_internoIA/tools/ngrok/ngrok.yml}"

if [[ -z "${PIPEDRIVE_API_TOKEN:-}" ]]; then
  echo "Missing env: PIPEDRIVE_API_TOKEN" >&2
  exit 1
fi

if [[ -z "${PIPEDRIVE_PROXY_API_TOKEN:-}" ]]; then
  echo "Missing env: PIPEDRIVE_PROXY_API_TOKEN" >&2
  exit 1
fi

if [[ ! -x "$NGROK_BIN" ]]; then
  echo "ngrok binary not found: $NGROK_BIN" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

PORT="$PORT" HOST="$HOST" node "$ROOT_DIR/server.js" &
SERVER_PID="$!"

echo "Local proxy PID: $SERVER_PID"
echo "Waiting for local server on port $PORT..."

for _ in {1..30}; do
  if curl -sS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -sS "http://127.0.0.1:${PORT}/health" >/dev/null
echo "Local proxy is ready."
echo "Starting ngrok..."
echo "Inspect API: http://127.0.0.1:4040/api/tunnels"

exec "$NGROK_BIN" http --config "$NGROK_CONFIG" "$PORT"

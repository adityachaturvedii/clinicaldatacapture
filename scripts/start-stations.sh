#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/frontend"
PID_DIR="$ROOT_DIR/.run"
BACKEND_LOG="$PID_DIR/backend.log"
FRONTEND_LOG="$PID_DIR/frontend.log"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

mkdir -p "$PID_DIR"

PORT_IN_USE() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

find_free_frontend_port() {
  local port=5173
  while PORT_IN_USE "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

get_host_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="localhost"
  fi
  echo "$ip"
}

if [[ -f "$BACKEND_PID_FILE" ]]; then
  old_pid="$(cat "$BACKEND_PID_FILE")"
  if kill -0 "$old_pid" >/dev/null 2>&1; then
    kill "$old_pid" >/dev/null 2>&1 || true
  fi
fi

if [[ -f "$FRONTEND_PID_FILE" ]]; then
  old_pid="$(cat "$FRONTEND_PID_FILE")"
  if kill -0 "$old_pid" >/dev/null 2>&1; then
    kill "$old_pid" >/dev/null 2>&1 || true
  fi
fi

if PORT_IN_USE 5001; then
  if curl -sS http://localhost:5001/api/health >/dev/null 2>&1; then
    echo "Backend already running on port 5001. Reusing existing process."
    REUSE_BACKEND=true
  else
    echo "Backend port 5001 is in use by another process. Stop it first."
    exit 1
  fi
else
  REUSE_BACKEND=false
fi

FRONTEND_PORT="$(find_free_frontend_port)"
HOST_IP="$(get_host_ip)"

if [[ "$REUSE_BACKEND" == false ]]; then
  cd "$BACKEND_DIR"
  nohup npm run dev > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

  sleep 2
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo "Backend failed to start. Check $BACKEND_LOG"
    exit 1
  fi
fi

cd "$FRONTEND_DIR"
nohup env VITE_API_BASE_URL="http://$HOST_IP:5001" npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

sleep 2
if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
  echo "Frontend failed to start. Check $FRONTEND_LOG"
  exit 1
fi

echo "Backend:  http://$HOST_IP:5001"
echo "Frontend: http://$HOST_IP:$FRONTEND_PORT"
echo
echo "Station URLs:"
echo "1) http://$HOST_IP:$FRONTEND_PORT/?station=1"
echo "2) http://$HOST_IP:$FRONTEND_PORT/?station=2"
echo "3) http://$HOST_IP:$FRONTEND_PORT/?station=3"
echo "4) http://$HOST_IP:$FRONTEND_PORT/?station=4"
echo "5) http://$HOST_IP:$FRONTEND_PORT/?station=5"
echo "6) http://$HOST_IP:$FRONTEND_PORT/?station=6"
echo
echo "Logs:"
if [[ "$REUSE_BACKEND" == false ]]; then
  echo "- $BACKEND_LOG"
fi
echo "- $FRONTEND_LOG"

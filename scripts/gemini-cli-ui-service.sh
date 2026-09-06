#!/usr/bin/env bash
set -u

APP_DIR="/root/codes/Gemini-CLI-UI"
BIN_FILE="$APP_DIR/bin/gemini-cli-ui"
PID_FILE="/run/gemini-cli-ui.pid"
LOG_FILE="/var/log/gemini-cli-ui.log"
PORT="${PORT:-4009}"

export PATH="/usr/lib/android-sdk/platform-tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME="/root"
export USER="root"
export PORT="$PORT"

get_pid() {
  if [ -f "$PID_FILE" ]; then
    local p
    p="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      echo "$p"
      return 0
    fi
  fi
  # Fallback check by process name
  local running_pids
  running_pids="$(pgrep -f "$BIN_FILE" 2>/dev/null || true)"
  if [ -n "$running_pids" ]; then
    echo "$running_pids" | head -n 1
    return 0
  fi
  return 1
}

is_port_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -tlpn 2>/dev/null | grep -q ":$PORT "
    return $?
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tlpn 2>/dev/null | grep -q ":$PORT "
    return $?
  fi
  return 1
}

start() {
  local pid
  if pid="$(get_pid)"; then
    echo "Gemini-CLI-UI is already running (PID: $pid)"
    return 0
  fi

  if [ ! -x "$BIN_FILE" ]; then
    echo "Error: Binary not found or not executable at $BIN_FILE" >&2
    exit 1
  fi

  echo "Starting Gemini-CLI-UI on port $PORT..."
  cd "$APP_DIR" || exit 1

  # Run fully detached using setsid with redirected stdio
  setsid nohup "$BIN_FILE" </dev/null >>"$LOG_FILE" 2>&1 &
  local new_pid="$!"
  echo "$new_pid" > "$PID_FILE"

  # Wait and verify
  local tries=0
  local started=0
  while [ "$tries" -lt 15 ]; do
    sleep 0.5
    if is_port_listening; then
      started=1
      break
    fi
    if ! kill -0 "$new_pid" 2>/dev/null; then
      break
    fi
    tries=$((tries + 1))
  done

  if [ "$started" -eq 1 ]; then
    echo "Gemini-CLI-UI started successfully (PID: $new_pid, Port: $PORT)"
  else
    if kill -0 "$new_pid" 2>/dev/null; then
      echo "Gemini-CLI-UI started (PID: $new_pid), waiting for port $PORT..."
    else
      echo "Failed to start Gemini-CLI-UI. Check log: $LOG_FILE" >&2
      tail -n 20 "$LOG_FILE" >&2
      rm -f "$PID_FILE"
      return 1
    fi
  fi
}

stop() {
  local pid
  if ! pid="$(get_pid)"; then
    echo "Gemini-CLI-UI is not running"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "Stopping Gemini-CLI-UI (PID: $pid)..."
  kill "$pid" 2>/dev/null || true

  # Wait for graceful shutdown
  local tries=0
  while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 10 ]; do
    sleep 0.5
    tries=$((tries + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "Force stopping (SIGKILL)..."
    kill -9 "$pid" 2>/dev/null || true
    pkill -9 -f "$BIN_FILE" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "Gemini-CLI-UI stopped"
}

status() {
  local pid
  if pid="$(get_pid)"; then
    echo "● Gemini-CLI-UI is running (PID: $pid)"
    if is_port_listening; then
      echo "  Port $PORT: listening"
    else
      echo "  Port $PORT: not listening yet"
    fi
    echo "  Log file: $LOG_FILE"
  else
    echo "○ Gemini-CLI-UI is stopped"
    return 1
  fi
}

logs() {
  if [ -f "$LOG_FILE" ]; then
    tail -n 50 "$LOG_FILE"
  else
    echo "Log file $LOG_FILE does not exist yet."
  fi
}

case "${1:-status}" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    sleep 1
    start
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac

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

get_port_pid() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$PORT" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
      | head -n 1
    return 0
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
    return 0
  fi

  return 1
}

is_our_process() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1

  local cmdline
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  case "$cmdline" in
    *"$BIN_FILE"*|*"/caxa/applications/gemini-cli-ui/"*"/server/index.js"*)
      return 0
      ;;
  esac
  return 1
}

get_pid() {
  if [ -f "$PID_FILE" ]; then
    local p
    p="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null && is_our_process "$p"; then
      echo "$p"
      return 0
    fi
  fi

  # caxa launches an extracted Node child and the launcher exits. Track the
  # real process that owns our dedicated HTTP port instead of the launcher.
  local port_pid
  port_pid="$(get_port_pid 2>/dev/null || true)"
  if [ -n "$port_pid" ] && kill -0 "$port_pid" 2>/dev/null && is_our_process "$port_pid"; then
    echo "$port_pid" > "$PID_FILE"
    echo "$port_pid"
    return 0
  fi

  # Fallback check by process name
  local running_pids
  running_pids="$(pgrep -f "$BIN_FILE|/caxa/applications/gemini-cli-ui/.*/server/index.js" 2>/dev/null || true)"
  if [ -n "$running_pids" ]; then
    while IFS= read -r p; do
      if [ -n "$p" ] && is_our_process "$p"; then
        echo "$p" > "$PID_FILE"
        echo "$p"
        return 0
      fi
    done <<< "$running_pids"
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
  local launcher_pid="$!"

  # Wait and verify
  local tries=0
  local actual_pid=""
  while [ "$tries" -lt 15 ]; do
    sleep 0.5
    if is_port_listening; then
      actual_pid="$(get_port_pid 2>/dev/null || true)"
      if [ -n "$actual_pid" ] && is_our_process "$actual_pid"; then
        break
      fi
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null && [ -z "$(get_port_pid 2>/dev/null || true)" ]; then
      break
    fi
    tries=$((tries + 1))
  done

  if [ -n "$actual_pid" ] && kill -0 "$actual_pid" 2>/dev/null && is_our_process "$actual_pid"; then
    echo "$actual_pid" > "$PID_FILE"
    echo "Gemini-CLI-UI started successfully (PID: $actual_pid, Port: $PORT)"
  else
    if kill -0 "$launcher_pid" 2>/dev/null; then
      echo "Gemini-CLI-UI launcher is still running (PID: $launcher_pid), but port $PORT is not ready" >&2
    else
      echo "Failed to start Gemini-CLI-UI. Check log: $LOG_FILE" >&2
      tail -n 20 "$LOG_FILE" >&2
    fi
    rm -f "$PID_FILE"
    return 1
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
    pkill -9 -f '/caxa/applications/gemini-cli-ui/.*/server/index.js' 2>/dev/null || true
  fi

  # A caxa launcher may already have exited while its extracted Node child is
  # still alive. Do not claim success until our dedicated port is released.
  local port_pid
  port_pid="$(get_port_pid 2>/dev/null || true)"
  if [ -n "$port_pid" ] && is_our_process "$port_pid"; then
    kill "$port_pid" 2>/dev/null || true
    sleep 0.5
    if kill -0 "$port_pid" 2>/dev/null; then
      kill -9 "$port_pid" 2>/dev/null || true
    fi
  fi

  rm -f "$PID_FILE"
  if is_port_listening; then
    echo "Failed to stop Gemini-CLI-UI: port $PORT is still listening" >&2
    return 1
  fi
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

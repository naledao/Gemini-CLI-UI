#!/system/bin/sh

CHROOT_DIR="/data/local/linux"
SERVICE_CMD="/usr/local/bin/gemini-cli-ui-service"
ANDROID_LOG="/data/local/tmp/gemini-cli-ui-service.d.log"

/system/bin/mkdir -p /data/local/tmp

{
  echo "gemini-cli-ui service.d invoked"

  tries=0
  while [ "$tries" -lt 120 ]; do
    if [ -x "$CHROOT_DIR/bin/bash" ] && [ -x "$CHROOT_DIR$SERVICE_CMD" ]; then
      break
    fi
    tries=$((tries + 1))
    /system/bin/sleep 5
  done

  if [ ! -x "$CHROOT_DIR/bin/bash" ] || [ ! -x "$CHROOT_DIR$SERVICE_CMD" ]; then
    echo "runtime not ready: bash or service script missing"
    exit 1
  fi

  echo "starting gemini-cli-ui tries=$tries"
  exec /system/bin/chroot "$CHROOT_DIR" /usr/bin/env 
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" 
    /bin/bash "$SERVICE_CMD" start
} >>"$ANDROID_LOG" 2>&1 </dev/null &

exit 0

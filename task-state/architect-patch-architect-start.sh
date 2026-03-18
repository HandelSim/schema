#!/bin/bash
# Architect startup script — prefers kingdom-session-manager, falls back to legacy nats-bridge.
set -e

WORKSPACE=/workspace
LOG=$WORKSPACE/nats-bridge.log

echo "[start.sh] Architect starting up..."

# Ensure packages are installed
cd $WORKSPACE
if [ ! -d node_modules/nats ]; then
  echo "[start.sh] Installing packages..."
  npm install --production 2>&1 | tail -5
fi

SESSION_MGR="$WORKSPACE/node_modules/kingdom-session-manager/session-manager.js"
LEGACY_BRIDGE="$WORKSPACE/nats-bridge.js"

# Build NATS URL with credentials (session-manager uses raw nats, not kingdom-raven)
_SM_NATS_URL="nats://${NATS_USER}:${NATS_PASSWORD}@${VM1_IP}:4222"

start_process() {
  if [ -f "$SESSION_MGR" ]; then
    echo "[start.sh] Starting session manager (primary)..."
    AGENT_ROLE=architect NATS_URL="${_SM_NATS_URL}" node "$SESSION_MGR" >> $LOG 2>&1 &
    ACTIVE_PID=$!
    echo "[start.sh] Session manager PID: $ACTIVE_PID"
  elif [ -f "$LEGACY_BRIDGE" ]; then
    echo "[start.sh] Session manager not found — starting legacy NATS bridge (fallback)..."
    node "$LEGACY_BRIDGE" >> $LOG 2>&1 &
    ACTIVE_PID=$!
    echo "[start.sh] Legacy bridge PID: $ACTIVE_PID"
  else
    echo "[start.sh] ERROR: neither session manager nor nats-bridge found" >&2
    exit 1
  fi
}

start_process

# Watchdog loop — restart if the process dies
while true; do
  sleep 30
  if ! kill -0 $ACTIVE_PID 2>/dev/null; then
    echo "[start.sh] Process died, restarting..."
    start_process
  fi
done

#!/usr/bin/env bash
#
# Entrypoint for the headless Jean Docker image.
#
# Runs two processes:
#   1) Jean's HTTP/WS server (the main UI) on ${JEAN_HOST}:${JEAN_PORT}.
#   2) openvscode-server (web VS Code) on ${CODE_HOST}:${CODE_PORT},
#      mounted at ${CODE_BASE_PATH} so the front door (Caddy etc.) can
#      proxy `/code*` to it while leaving `/*` for Jean.
#
# Jean is a Tauri app; even in `--headless` mode the Rust process still
# initializes WebKitGTK/GTK at startup, which requires an X display. We
# start Xvfb so GTK is happy, then run jean.
#
# Environment variables (all optional; defaults in the Dockerfile):
#   DISPLAY_NUM      Xvfb display number (default 99). Each container instance
#                    sharing /tmp/.X11-unix MUST pick a unique number.
#   JEAN_HOST        Address jean binds to (default 0.0.0.0).
#   JEAN_PORT        Port jean listens on (default 3456).
#   JEAN_ARGS        Extra args appended to the jean invocation.
#   CODE_HOST        Address openvscode-server binds to (default 127.0.0.1).
#   CODE_PORT        Port openvscode-server listens on (default 3457).
#   CODE_BASE_PATH   HTTP path prefix for the editor (default /code).
#                    Must match what the reverse proxy uses.
#   CODE_DISABLE     If "1", skip launching the web editor.
#
# Security note: both services are started with auth disabled. Put a
# reverse proxy with authentication in front before exposing them.

set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-99}"
JEAN_HOST="${JEAN_HOST:-0.0.0.0}"
JEAN_PORT="${JEAN_PORT:-3456}"
JEAN_ARGS="${JEAN_ARGS:-}"
CODE_HOST="${CODE_HOST:-127.0.0.1}"
CODE_PORT="${CODE_PORT:-3457}"
CODE_BASE_PATH="${CODE_BASE_PATH:-/code}"
CODE_DISABLE="${CODE_DISABLE:-0}"

# Clean up stale Xvfb lock files from previous (crashed) runs.
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true

# Start the virtual framebuffer.
Xvfb ":${DISPLAY_NUM}" -screen 0 1024x768x24 -nolisten tcp &
XVFB_PID=$!

export DISPLAY=":${DISPLAY_NUM}"

# Give Xvfb a moment to start.
sleep 1

CODE_PID=""

# Start openvscode-server in the background.
if [ "${CODE_DISABLE}" != "1" ] && [ -x /opt/openvscode-server/bin/openvscode-server ]; then
    echo "[entrypoint] Starting openvscode-server on ${CODE_HOST}:${CODE_PORT}${CODE_BASE_PATH}"
    /opt/openvscode-server/bin/openvscode-server \
        --host "${CODE_HOST}" \
        --port "${CODE_PORT}" \
        --server-base-path "${CODE_BASE_PATH}" \
        --without-connection-token \
        --accept-server-license-terms \
        --disable-workspace-trust \
        > /var/log/openvscode-server.log 2>&1 &
    CODE_PID=$!
else
    echo "[entrypoint] openvscode-server disabled or missing; skipping launch"
fi

# Ensure background processes are cleaned up when the container stops.
cleanup() {
    if [ -n "${CODE_PID}" ] && kill -0 "${CODE_PID}" 2>/dev/null; then
        kill "${CODE_PID}" 2>/dev/null || true
    fi
    if kill -0 "${XVFB_PID}" 2>/dev/null; then
        kill "${XVFB_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Run jean in the foreground. When jean exits, the container exits, and
# the trap above tears down Xvfb + openvscode-server.
# shellcheck disable=SC2086
exec jean \
    --headless \
    --no-token \
    --host "${JEAN_HOST}" \
    --port "${JEAN_PORT}" \
    ${JEAN_ARGS}

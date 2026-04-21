#!/usr/bin/env bash
#
# Entrypoint for the headless Jean Docker image.
#
# Jean is a Tauri app; even in `--headless` mode the Rust process still
# initializes WebKitGTK/GTK at startup, which requires an X display. We
# start Xvfb (virtual framebuffer) so GTK is happy, then exec `jean`.
#
# Environment variables (all optional):
#   DISPLAY_NUM  Xvfb display number (default 99). Each container instance
#                that shares a volume for /tmp/.X11-unix MUST pick a unique
#                number to avoid lock-file conflicts.
#   JEAN_HOST    Address jean binds to (default 0.0.0.0).
#   JEAN_PORT    Port jean listens on (default 3456).
#   JEAN_ARGS    Extra args appended to the jean invocation (e.g. "--token foo").
#
# By default, jean is started with `--no-token` so the server is reachable
# without additional auth; put it behind a reverse proxy with basic-auth
# (or similar) before exposing it.

set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-99}"
JEAN_HOST="${JEAN_HOST:-0.0.0.0}"
JEAN_PORT="${JEAN_PORT:-3456}"
JEAN_ARGS="${JEAN_ARGS:-}"

# Clean up stale Xvfb lock files from previous (crashed) runs.
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true

# Start the virtual framebuffer.
Xvfb ":${DISPLAY_NUM}" -screen 0 1024x768x24 -nolisten tcp &
XVFB_PID=$!

export DISPLAY=":${DISPLAY_NUM}"

# Give Xvfb a moment to start.
sleep 1

# Ensure Xvfb is cleaned up when the container stops.
cleanup() {
    if kill -0 "${XVFB_PID}" 2>/dev/null; then
        kill "${XVFB_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# shellcheck disable=SC2086
exec jean \
    --headless \
    --no-token \
    --host "${JEAN_HOST}" \
    --port "${JEAN_PORT}" \
    ${JEAN_ARGS}

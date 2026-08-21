#!/bin/bash
# Launcher script for MDCentralMonitor

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

PORT="${PORT:-3000}"
export PORT

echo "Starting MDCentralMonitor on port $PORT..."
node server.js "$@"

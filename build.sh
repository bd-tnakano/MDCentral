#!/bin/bash
# Build / setup script for MDCentralMonitor

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "=== Setting up MDCentralMonitor ==="
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "=== MDCentralMonitor Setup Complete ==="
echo "Run using ./run.sh or npm start"

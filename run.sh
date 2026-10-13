#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
port="${1:-8765}"
printf '打开中文版：http://127.0.0.1:%s\n按 Ctrl+C 停止。\n' "$port"
exec python3 -m http.server "$port" --bind 127.0.0.1 --directory webapp

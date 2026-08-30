#!/usr/bin/env bash
# Sobe API (:3800) e web (:5180) juntos. Ctrl+C derruba os dois.
set -e
cd "$(dirname "$0")/.."
pnpm --filter @dre/api dev &
API_PID=$!
pnpm --filter @dre/web dev &
WEB_PID=$!
trap "kill $API_PID $WEB_PID 2>/dev/null" EXIT INT TERM
wait

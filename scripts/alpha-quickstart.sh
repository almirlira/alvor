#!/usr/bin/env bash
set -euo pipefail

if [ ! -f private/alpha-invites.env ]; then
  node scripts/make-alpha-invites.mjs 5
fi

set -a
source private/alpha-invites.env
set +a

export API_PORT="${API_PORT:-3800}"
export API_HOST="${API_HOST:-127.0.0.1}"
export LLM_PROVIDER="${LLM_PROVIDER:-mock}"
export VITE_ALPHA_INVITE_AUTH=on

pnpm --filter @dre/api dev &
api_pid=$!
pnpm --filter @dre/web dev --host 127.0.0.1 &
web_pid=$!

cleanup() {
  kill "$api_pid" "$web_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "ALVOR alpha local: http://127.0.0.1:5180"
echo "Convites: private/convites-alpha.md"
echo "Para expor sem custo em outro terminal:"
echo "cloudflared tunnel --url http://127.0.0.1:5180"

wait

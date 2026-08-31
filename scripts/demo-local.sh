#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pk="${PRIVATE_KEY:?set PRIVATE_KEY in the environment}"
rpc="${ARC_RPC:-http://127.0.0.1:8545}"

if ! curl -sf -X POST "$rpc" -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
  echo "start anvil first: anvil --port 8545"
  exit 1
fi

mkdir -p deployments
echo "deploying local ARQL stack"
forge script scripts/DeployLocal.s.sol:DeployLocal --broadcast --rpc-url "$rpc" --private-key "$pk" -vv

echo "iris on :7465"
IRIS_PORT=7465 node services/iris/server.mjs &
iris_pid=$!
sleep 0.4
echo "relayer"
PRIVATE_KEY="$pk" ARC_RPC="$rpc" IRIS_URL=http://127.0.0.1:7465 node services/relayer/index.mjs &
relayer_pid=$!
echo "desk on :7470"
WEB_PORT=7470 node scripts/web-server.mjs &
web_pid=$!
echo "pids iris=$iris_pid relayer=$relayer_pid web=$web_pid"
echo "open http://127.0.0.1:7470"
wait

#!/bin/sh
# Banana launcher for Linux / macOS. Works from a USB stick: it prefers a Node.js
# shipped in runtime/node-<os>-<arch>/ and falls back to the system Node.js.
cd "$(dirname "$0")" || exit 1

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) arch=$(uname -m) ;;
esac

NODE=""
for candidate in "runtime/node-$os-$arch/bin/node" "runtime/node-$os-$arch/node"; do
  if [ -x "$candidate" ]; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then NODE=$(command -v node || true); fi
if [ -z "$NODE" ]; then
  echo "Node.js 20.11+ was not found. Install it from https://nodejs.org or copy a Node.js build to runtime/node-$os-$arch/." >&2
  exit 1
fi
exec "$NODE" scripts/launch.mjs "$@"

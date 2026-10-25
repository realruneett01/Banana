#!/bin/sh
# Installs Banana as a systemd service from a portable bundle or a built checkout.
#   sudo sh deploy/install-systemd.sh [source-dir]     (default: the directory above this script)
set -eu

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
SRC=${1:-$(cd "$(dirname "$0")/.." && pwd)}
DEST=/opt/banana

[ -f "$SRC/backend/src/server.js" ] || { echo "$SRC is not a Banana directory." >&2; exit 1; }
[ -f "$SRC/frontend/dist/index.html" ] || { echo "UI not built: run 'npm run make-portable' first and use that folder." >&2; exit 1; }
[ -d "$SRC/node_modules/express" ] || { echo "Dependencies missing: use the folder produced by 'npm run make-portable'." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 20.11+ is required." >&2; exit 1; }

id banana >/dev/null 2>&1 || useradd --system --home-dir "$DEST" --shell /usr/sbin/nologin banana
mkdir -p "$DEST" /etc/banana /var/tmp/banana
cp -a "$SRC"/. "$DEST"/
chown -R root:root "$DEST"
chown banana:banana /var/tmp/banana
[ -f /etc/banana/banana.env ] || printf '# GEMINI_API_KEY=\n# KICAD_CLI_PATH=/usr/bin/kicad-cli\n' > /etc/banana/banana.env
chmod 640 /etc/banana/banana.env
chgrp banana /etc/banana/banana.env
install -m 644 "$DEST/deploy/banana.service" /etc/systemd/system/banana.service
systemctl daemon-reload
systemctl enable --now banana.service
echo "Installed. Check: systemctl status banana   |   curl http://127.0.0.1:5000/api/health-check"

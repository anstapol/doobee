#!/usr/bin/env bash
set -euo pipefail

# Quick deploy: copy source, install deps, restart
# Usage: scp the repo to /tmp/doobee, then run:
#   sudo bash /tmp/doobee/deploy/deploy.sh

DOOBEE_USER="doobee"
DOOBEE_DIR="/home/$DOOBEE_USER/doobee"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$SCRIPT_DIR" != "$DOOBEE_DIR" ]; then
  cp -a "$SCRIPT_DIR/." "$DOOBEE_DIR/"
  chown -R "$DOOBEE_USER:$DOOBEE_USER" "$DOOBEE_DIR"
fi

sudo -u "$DOOBEE_USER" bash -c "cd $DOOBEE_DIR && export PATH=\"\$HOME/.bun/bin:\$PATH\" && bun install"
systemctl restart doobee
echo "Deployed. Status:"
systemctl status doobee --no-pager

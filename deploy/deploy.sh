#!/usr/bin/env bash
set -euo pipefail

# Quick deploy: pull latest, install deps, restart
# Run as root: sudo bash deploy.sh

DOOBEE_USER="doobee"
DOOBEE_DIR="/home/$DOOBEE_USER/doobee"

sudo -u "$DOOBEE_USER" git -C "$DOOBEE_DIR" pull
sudo -u "$DOOBEE_USER" bash -c "cd $DOOBEE_DIR && export PATH=\"\$HOME/.bun/bin:\$PATH\" && bun install"
systemctl restart doobee
echo "Deployed. Tailing logs (ctrl-c to stop):"
journalctl -u doobee -f --no-pager

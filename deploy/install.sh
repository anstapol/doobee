#!/usr/bin/env bash
set -euo pipefail

# Doobee install script for Ubuntu VPS
# Usage: clone/copy the repo to the VPS, then run:
#   sudo bash deploy/install.sh

DOOBEE_USER="doobee"
DOOBEE_HOME="/home/$DOOBEE_USER"
DOOBEE_DIR="$DOOBEE_HOME/doobee"
REPOS_DIR="$DOOBEE_HOME/repos"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/install.sh"
  exit 1
fi

echo "==> Creating user: $DOOBEE_USER"
if ! id "$DOOBEE_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DOOBEE_USER"
fi
mkdir -p "$REPOS_DIR"
chown "$DOOBEE_USER:$DOOBEE_USER" "$REPOS_DIR"

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq git curl unzip

echo "==> Installing Docker"
if command -v docker &>/dev/null; then
  echo "    Already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$DOOBEE_USER"

echo "==> Installing Bun"
sudo -u "$DOOBEE_USER" bash -c 'curl -fsSL https://bun.sh/install | bash'

echo "==> Installing Claude Code CLI"
if sudo -u "$DOOBEE_USER" bash -c 'export PATH="$HOME/.bun/bin:$PATH" && command -v claude' &>/dev/null; then
  echo "    Already installed, upgrading"
  sudo -u "$DOOBEE_USER" bash -c 'export PATH="$HOME/.bun/bin:$PATH" && bun update -g @anthropic-ai/claude-code'
else
  sudo -u "$DOOBEE_USER" bash -c 'export PATH="$HOME/.bun/bin:$PATH" && bun install -g @anthropic-ai/claude-code'
fi

echo "==> Copying source to $DOOBEE_DIR"
if [ "$SCRIPT_DIR" != "$DOOBEE_DIR" ]; then
  mkdir -p "$DOOBEE_DIR"
  cp -a "$SCRIPT_DIR/." "$DOOBEE_DIR/"
  chown -R "$DOOBEE_USER:$DOOBEE_USER" "$DOOBEE_DIR"
else
  echo "    Already at $DOOBEE_DIR, skipping"
fi

echo "==> Installing dependencies"
sudo -u "$DOOBEE_USER" bash -c "cd $DOOBEE_DIR && export PATH=\"\$HOME/.bun/bin:\$PATH\" && bun install"

echo "==> Setting up .env"
if [ ! -f "$DOOBEE_DIR/.env" ]; then
  cat > "$DOOBEE_DIR/.env" <<'ENVEOF'
APP_ID=
PRIVATE_KEY_PATH=/home/doobee/doobee/private-key.pem
WEBHOOK_SECRET=
REPOS_DIR=/home/doobee/repos
PORT=3000
BOT_NAME=doobeebot[bot]
ENVEOF
  chown "$DOOBEE_USER:$DOOBEE_USER" "$DOOBEE_DIR/.env"
  chmod 600 "$DOOBEE_DIR/.env"
  echo "    Created $DOOBEE_DIR/.env — fill in APP_ID and WEBHOOK_SECRET"
else
  echo "    .env already exists, skipping"
fi

echo "==> Installing systemd service"
cp "$DOOBEE_DIR/deploy/doobee.service" /etc/systemd/system/doobee.service
systemctl daemon-reload
systemctl enable doobee

echo ""
echo "========================================="
echo "  Install complete. Next steps:"
echo "========================================="
echo ""
echo "  1. Copy your GitHub App private key:"
echo "     scp private-key.pem root@your-vps:$DOOBEE_DIR/private-key.pem"
echo "     chown $DOOBEE_USER:$DOOBEE_USER $DOOBEE_DIR/private-key.pem"
echo "     chmod 600 $DOOBEE_DIR/private-key.pem"
echo ""
echo "  2. Edit .env with your values:"
echo "     nano $DOOBEE_DIR/.env"
echo ""
echo "  3. Authenticate Claude CLI:"
echo "     sudo -u $DOOBEE_USER bash -c 'export PATH=\"\$HOME/.bun/bin:\$PATH\" && claude login'"
echo ""
echo "  4. Start Doobee:"
echo "     systemctl start doobee"
echo "     journalctl -u doobee -f"
echo ""
echo "  5. Set up reverse proxy (Caddy recommended):"
echo "     apt-get install -y caddy"
echo "     Edit /etc/caddy/Caddyfile:"
echo ""
echo "     your-domain.com {"
echo "       reverse_proxy localhost:3000"
echo "     }"
echo ""
echo "     systemctl restart caddy"
echo ""

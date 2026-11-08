#!/usr/bin/env bash
# JEDBET Pi-ügynök telepítése. A Pi-n futtatandó, az admin felhasználóval:
#   bash install.sh
# Leállítja a régi szolgáltatásokat (beton_monitor, jedbet, concrete, cloudflared),
# és helyettük egyetlen „jedbet-agent” szolgáltatást indít.
set -euo pipefail

DIR=/home/admin
ENV_FILE="$DIR/jedbet-agent.env"
cd "$(dirname "$0")"

install -m 755 jedbet_agent.py "$DIR/jedbet_agent.py"

if [ ! -f "$ENV_FILE" ]; then
  TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  umask 077
  cat > "$ENV_FILE" <<EOF
API_URL=https://jedbet.xyz
DEVICE_TOKEN=$TOKEN
PRINTER_PORT=/dev/ttyACM0
NIIMCTL=$DIR/niimprint_1/niimctl.py
EOF
  NEW_TOKEN=1
fi
chmod 600 "$ENV_FILE"

sudo tee /etc/systemd/system/jedbet-agent.service >/dev/null <<'EOF'
[Unit]
Description=JEDBET Pi-ügynök (szenzorok + címkenyomtatás)
After=network-online.target
Wants=network-online.target

[Service]
User=admin
Group=dialout
WorkingDirectory=/home/admin
ExecStart=/usr/bin/python3 /home/admin/jedbet_agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

for s in beton_monitor jedbet concrete cloudflared; do
  sudo systemctl disable --now "$s.service" 2>/dev/null || true
done
sudo systemctl daemon-reload
sudo systemctl enable jedbet-agent.service
sudo systemctl restart jedbet-agent.service

echo
echo "Kész. Napló: journalctl -u jedbet-agent -f"
if [ "${NEW_TOKEN:-}" = 1 ]; then
  echo
  echo "Ezt a tokent kell beírni a Cloudflare-ben DEVICE_TOKEN titokként:"
  echo
  grep '^DEVICE_TOKEN=' "$ENV_FILE" | cut -d= -f2-
  echo
fi

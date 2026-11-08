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
install -m 755 niimbot_b1.py "$DIR/niimbot_b1.py"
PRINTER_MAC=${PRINTER_MAC:-05:23:0A:A5:90:6C}

if [ ! -f "$ENV_FILE" ]; then
  TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  umask 077
  cat > "$ENV_FILE" <<EOF
API_URL=https://jedbet.xyz
DEVICE_TOKEN=$TOKEN
PRINTER_PORT=/dev/rfcomm0
NIIMCTL=$DIR/niimbot_b1.py
EOF
  NEW_TOKEN=1
fi
# Meglévő beállításnál is a Bluetooth-os nyomtatóprogramra váltunk.
sed -i "s|^NIIMCTL=.*|NIIMCTL=$DIR/niimbot_b1.py|; s|^PRINTER_PORT=/dev/ttyACM0$|PRINTER_PORT=/dev/rfcomm0|" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Niimbot B1 Bluetooth-on: /dev/rfcomm0 indításkor
bluetoothctl trust "$PRINTER_MAC" >/dev/null 2>&1 || true
sudo tee /etc/systemd/system/niimbot-rfcomm.service >/dev/null <<EOF
[Unit]
Description=Niimbot B1 Bluetooth soros port (/dev/rfcomm0)
After=bluetooth.service
Requires=bluetooth.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/rfcomm bind 0 $PRINTER_MAC 1
ExecStop=/usr/bin/rfcomm release 0

[Install]
WantedBy=multi-user.target
EOF

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
sudo systemctl enable --now niimbot-rfcomm.service
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

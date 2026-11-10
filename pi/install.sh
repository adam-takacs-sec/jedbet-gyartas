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
install -m 644 label_render.py "$DIR/label_render.py"
# Betűtípus a címkéhez (ha nincs fent)
[ -f /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf ] || sudo apt-get install -y fonts-dejavu-core
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

# --- Hálózatfigyelő: ha elmegy a wifi, magától újracsatlakozik (lásd netwatch.sh)
sudo install -m 755 netwatch.sh /usr/local/bin/jedbet-netwatch
sudo tee /etc/systemd/system/jedbet-netwatch.service >/dev/null <<'UNIT'
[Unit]
Description=JEDBET hálózatfigyelő
[Service]
Type=oneshot
ExecStart=/usr/local/bin/jedbet-netwatch
UNIT
sudo tee /etc/systemd/system/jedbet-netwatch.timer >/dev/null <<'UNIT'
[Unit]
Description=JEDBET hálózatfigyelő, percenként
[Timer]
OnBootSec=2min
OnActiveSec=1min
OnUnitActiveSec=1min
AccuracySec=10s
[Install]
WantedBy=timers.target
UNIT

# --- Wifi energiatakarékos mód ki (Pi Zero 2-n emiatt szokott leesni a wifi)
if [ -d /etc/NetworkManager/conf.d ]; then
  sudo tee /etc/NetworkManager/conf.d/jedbet-wifi-powersave.conf >/dev/null <<'UNIT'
[connection]
wifi.powersave = 2
UNIT
fi
sudo iw dev wlan0 set power_save off 2>/dev/null || true

# --- Hardveres watchdog: ha a Pi teljesen lefagy, magától újraindul
sudo mkdir -p /etc/systemd/system.conf.d
sudo tee /etc/systemd/system.conf.d/jedbet-watchdog.conf >/dev/null <<'UNIT'
[Manager]
RuntimeWatchdogSec=15
RebootWatchdogSec=2min
UNIT
sudo systemctl daemon-reexec

# --- A napló maradjon meg újraindítás után is (hibakereséshez)
sudo mkdir -p /var/log/journal
sudo systemctl restart systemd-journald

for s in beton_monitor jedbet concrete cloudflared; do
  sudo systemctl disable --now "$s.service" 2>/dev/null || true
done
sudo systemctl daemon-reload
sudo systemctl enable --now niimbot-rfcomm.service
sudo systemctl enable jedbet-agent.service
sudo systemctl enable --now jedbet-netwatch.timer
sudo systemctl restart jedbet-agent.service

echo
echo "Kész. Napló: journalctl -u jedbet-agent -f   |   Hálózatfigyelő: journalctl -t jedbet-netwatch"
if [ "${NEW_TOKEN:-}" = 1 ]; then
  echo
  echo "Ezt a tokent kell beírni a Cloudflare-ben DEVICE_TOKEN titokként:"
  echo
  grep '^DEVICE_TOKEN=' "$ENV_FILE" | cut -d= -f2-
  echo
fi

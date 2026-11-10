#!/usr/bin/env bash
# JEDBET hálózatfigyelő. Percenként fut (jedbet-netwatch.timer).
# Ha nincs net, egyre erősebb lépésekkel próbálja visszahozni:
#   1–2. hiba: wifi újracsatlakoztatása
#   5. hiba: hálózatkezelő újraindítása
#   15. hiba (~15 perc net nélkül): a Pi újraindítása, de csak egyszer,
#        amíg a net vissza nem jön (ha a router van lekapcsolva, ne induljon újra 15 percenként)
# A mérések közben sem vesznek el, mert az ügynök az SD-kártyára puffereli őket.
set -u

STATE=/run/jedbet-netwatch.fails
REBOOTED=/var/lib/jedbet-netwatch.rebooted   # megmarad újraindítás után is
IFACE=${IFACE:-wlan0}
log() { logger -t jedbet-netwatch "$*"; }

online() {
  # Akkor van net, ha a jedbet.xyz elérhető (bármilyen HTTP-válasz jó), vagy legalább az 1.1.1.1 pingelhető.
  # Az átjárót szándékosan nem pingeljük: sok router nem válaszol pingre, az hamis riasztás lenne.
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null --max-time 10 https://jedbet.xyz/ && return 0
  else
    python3 -c 'import urllib.request as u; u.urlopen("https://jedbet.xyz/", timeout=10)' >/dev/null 2>&1 && return 0
  fi
  ping -c1 -W3 1.1.1.1 >/dev/null 2>&1
}

fails=$(cat "$STATE" 2>/dev/null || echo 0)

if online; then
  [ "$fails" -gt 0 ] && log "hálózat rendben ($fails sikertelen ellenőrzés után)"
  echo 0 > "$STATE"
  rm -f "$REBOOTED"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$STATE"
log "nincs hálózat ($fails. ellenőrzés)"

reconnect_wifi() {
  if command -v nmcli >/dev/null 2>&1; then
    nmcli radio wifi off; sleep 3; nmcli radio wifi on
  else
    ip link set "$IFACE" down; sleep 3; ip link set "$IFACE" up
    command -v wpa_cli >/dev/null 2>&1 && wpa_cli -i "$IFACE" reconfigure >/dev/null 2>&1
  fi
  iw dev "$IFACE" set power_save off 2>/dev/null || true
}

case "$fails" in
  1|2)  log "wifi újracsatlakoztatása"; reconnect_wifi ;;
  5)    log "hálózatkezelő újraindítása"
        systemctl restart NetworkManager 2>/dev/null || systemctl restart dhcpcd 2>/dev/null || true
        reconnect_wifi ;;
  15)   if [ -e "$REBOOTED" ]; then
          log "15 perce nincs hálózat, de emiatt már újraindultunk egyszer, csak a wifit próbálom"; reconnect_wifi
        else
          log "15 perce nincs hálózat, újraindítás"; touch "$REBOOTED"; sync; systemctl reboot
        fi ;;
  *)    [ $((fails % 3)) -eq 0 ] && reconnect_wifi ;;
esac

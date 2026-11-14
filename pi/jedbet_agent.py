#!/usr/bin/env python3
"""JEDBET Pi-ügynök.

Két dolgot csinál, mást semmit:
  1. 5 percenként leolvassa a DS18B20 szenzorokat, és felküldi a mérést a
     gyártási oldalnak. Ha nincs net, a mérés egy helyi SQLite-pufferben vár,
     és visszatöltődik, amint újra van kapcsolat.
  2. Pár másodpercenként megnézi, van-e nyomtatandó címke, és ha van,
     kinyomtatja a niimbot_b1.py-jal.
  3. 10 másodpercenként jelenti a fűtő Shelly állapotát, és beállítja az
     oldalon kért állapotot. Bekapcsoláskor a Shelly 2 perces visszaszámlálót
     kap, amit minden kör megújít: ha a Pi vagy a net kiesik, a fűtő magától
     lekapcsol.

Csak kifelé kapcsolódik (HTTPS), nem nyit portot. Csak a Python standard
könyvtárát használja.

Beállítás: /home/admin/jedbet-agent.env
  API_URL=https://jedbet.xyz
  DEVICE_TOKEN=...
  PRINTER_PORT=/dev/rfcomm0        (opcionális; USB-n /dev/ttyACM0)
  NIIMCTL=/home/admin/niimbot_b1.py   (opcionális)
  SHELLY_HEATER=192.168.1.201       (opcionális; üresen hagyva nincs fűtésvezérlés)
"""
import base64
import glob
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HOME = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.environ.get("JEDBET_ENV", os.path.join(HOME, "jedbet-agent.env"))
BUFFER_DB = os.path.join(HOME, "jedbet-buffer.sqlite")
SAMPLE_SEC = 300
PRINT_POLL_SEC = 4
HEATER_POLL_SEC = 10
HEATER_SAFETY_SEC = 120   # ennyi idő után kapcsol le a fűtő, ha nem jön megújítás
W1_GLOB = os.environ.get("JEDBET_W1_GLOB", "/sys/bus/w1/devices/28-*")
SAMPLE_SEC = int(os.environ.get("JEDBET_SAMPLE_SEC", SAMPLE_SEC))


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def load_env():
    cfg = {}
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip()
    except FileNotFoundError:
        sys.exit(f"Hiányzik a beállítófájl: {ENV_FILE}")
    for k in ("API_URL", "DEVICE_TOKEN"):
        if not cfg.get(k):
            sys.exit(f"Hiányzik a(z) {k} a {ENV_FILE} fájlból")
    cfg["API_URL"] = cfg["API_URL"].rstrip("/")
    cfg.setdefault("PRINTER_PORT", "/dev/rfcomm0")
    cfg.setdefault("NIIMCTL", os.path.join(HOME, "niimbot_b1.py"))
    cfg.setdefault("SHELLY_HEATER", "192.168.1.201")
    return cfg


CFG = load_env()


def request(method, path, payload=None, timeout=15):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        CFG["API_URL"] + path, data=data, method=method,
        headers={"Authorization": "Bearer " + CFG["DEVICE_TOKEN"],
                 "Content-Type": "application/json",
                 "User-Agent": "jedbet-pi-agent/1"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = res.read()
        return res.status, (json.loads(body) if body else None)


# --------------------------------------------------------------------------
# Szenzorok
# --------------------------------------------------------------------------
def read_sensor(path):
    """Egy DS18B20 leolvasása; CRC-hiba vagy 85 °C-os (bekapcsolási) érték esetén None."""
    for _ in range(3):
        try:
            with open(os.path.join(path, "w1_slave")) as f:
                lines = f.read().splitlines()
            if len(lines) >= 2 and lines[0].strip().endswith("YES") and "t=" in lines[1]:
                t = int(lines[1].split("t=")[1]) / 1000.0
                if t != 85.0 and -55 < t < 125:
                    return t
        except OSError:
            pass
        time.sleep(1)
    return None


def buffer_conn():
    con = sqlite3.connect(BUFFER_DB, timeout=10)
    con.execute("CREATE TABLE IF NOT EXISTS pending (sensor_id TEXT, ts TEXT, temp REAL, PRIMARY KEY (sensor_id, ts))")
    return con


def system_status():
    st = {"sensors_on_bus": len(glob.glob(W1_GLOB))}
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            st["cpu_c"] = round(int(f.read()) / 1000, 1)
        with open("/proc/uptime") as f:
            st["uptime_h"] = round(float(f.read().split()[0]) / 3600, 1)
    except OSError:
        pass
    return st


def sensor_loop():
    con = buffer_conn()
    while True:
        started = time.time()
        ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        rows = []
        paths = sorted(glob.glob(W1_GLOB))
        if not paths:
            log("NINCS szenzor az 1-Wire buszon (kábel / felhúzó ellenállás / GND?)")
        for path in paths:
            t = read_sensor(path)
            sid = os.path.basename(path)
            if t is None:
                log("szenzor hiba:", sid)
                continue
            rows.append((sid, ts, t))
        if rows:
            con.executemany("INSERT OR IGNORE INTO pending VALUES (?,?,?)", rows)
            con.commit()
        flush(con)
        time.sleep(max(5, SAMPLE_SEC - (time.time() - started)))


def flush(con):
    """A puffer felküldése, legrégebbivel kezdve, legfeljebb 500-asával."""
    while True:
        batch = con.execute("SELECT sensor_id, ts, temp FROM pending ORDER BY ts LIMIT 500").fetchall()
        payload = {"readings": [{"sensor_id": s, "ts": t, "temp": v} for s, t, v in batch],
                   "status": system_status()}
        try:
            request("POST", "/device/readings", payload)
        except (urllib.error.URLError, OSError, ValueError) as e:
            n = con.execute("SELECT COUNT(*) FROM pending").fetchone()[0]
            log(f"felküldés sikertelen ({e}); pufferben: {n}")
            return
        if batch:
            con.executemany("DELETE FROM pending WHERE sensor_id = ? AND ts = ?", [(s, t) for s, t, _ in batch])
            con.commit()
        if len(batch) < 500:
            return


# --------------------------------------------------------------------------
# Nyomtatás
# --------------------------------------------------------------------------
def print_loop():
    while True:
        try:
            status, job = request("GET", "/device/print-jobs/next", timeout=20)
            if status == 200 and job:
                handle_print(job)
                continue
        except (urllib.error.URLError, OSError, ValueError) as e:
            log("nyomtatási sor nem elérhető:", e)
            time.sleep(30)
        time.sleep(PRINT_POLL_SEC)


def handle_print(job):
    ok, err = False, ""
    fd, path = tempfile.mkstemp(suffix=".png")
    try:
        if job.get("spec"):
            # A címkét itt rajzoljuk ki, a nyomtató felbontásán, élsimítás nélkül.
            import label_render
            os.close(fd)
            label_render.render(job["spec"]).save(path)
        else:
            with os.fdopen(fd, "wb") as f:
                f.write(base64.b64decode(job["png_base64"]))
        res = subprocess.run(["python3", CFG["NIIMCTL"], "-p", CFG["PRINTER_PORT"], "-i", path],
                             cwd=os.path.dirname(CFG["NIIMCTL"]), capture_output=True, text=True, timeout=90)
        ok = res.returncode == 0
        err = "" if ok else (res.stderr or res.stdout)[-400:]
    except Exception as e:  # noqa: BLE001 – a hibát visszaküldjük az oldalnak
        err = str(e)[-400:]
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    log(f"címke #{job['id']}:", "kész" if ok else "HIBA " + err)
    try:
        request("POST", f"/device/print-jobs/{job['id']}", {"ok": ok, "error": err})
    except (urllib.error.URLError, OSError) as e:
        log("visszajelzés sikertelen:", e)


# --------------------------------------------------------------------------
# Fűtés (Shelly Plug, helyi hálózaton)
# --------------------------------------------------------------------------
def shelly(method, **params):
    q = urllib.parse.urlencode({k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items()})
    url = f"http://{CFG['SHELLY_HEATER']}/rpc/{method}?{q}"
    with urllib.request.urlopen(url, timeout=5) as res:
        return json.loads(res.read() or b"null")


def heater_loop():
    last_err = None
    while True:
        try:
            st = shelly("Switch.GetStatus", id=0)
            actual = {"on": bool(st.get("output")), "apower": st.get("apower"),
                      "error": ",".join(st.get("errors") or [])}
        except (urllib.error.URLError, OSError, ValueError) as e:
            actual = {"on": None, "apower": None, "error": f"Shelly nem elérhető: {e}"}
        try:
            _, resp = request("POST", "/device/heater", actual, timeout=10)
            want = bool(resp and resp.get("on"))
            if want:
                shelly("Switch.Set", id=0, on=True, toggle_after=HEATER_SAFETY_SEC)
            elif actual.get("on"):
                shelly("Switch.Set", id=0, on=False)
            if want != actual.get("on"):
                log("fűtés:", "BE" if want else "KI")
            last_err = None
        except (urllib.error.URLError, OSError, ValueError) as e:
            # Nem újítjuk meg a visszaszámlálót: a fűtő HEATER_SAFETY_SEC múlva magától lekapcsol.
            if str(e) != last_err:
                log("fűtés: hiba:", e)
            last_err = str(e)
        time.sleep(HEATER_POLL_SEC)


if __name__ == "__main__":
    log("JEDBET ügynök indul →", CFG["API_URL"])
    threading.Thread(target=print_loop, daemon=True).start()
    if CFG["SHELLY_HEATER"]:
        threading.Thread(target=heater_loop, daemon=True).start()
    sensor_loop()

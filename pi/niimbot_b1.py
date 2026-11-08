#!/usr/bin/env python3
"""Niimbot B1 nyomtatás soros porton (USB: /dev/ttyACM0, Bluetooth: /dev/rfcomm0).

A protokoll ugyanaz, mint a niimctl.py-ban (ami USB-n működött), két különbséggel:
  * a sorokat kis szünettel küldi, mert Bluetoothon a nyomtató különben
    elveszíti őket (csak a kép eleje jön ki);
  * a nyomtatás végén nem száll el a B1 rövidebb állapotválaszán, és mindig
    elküldi a „nyomtatás vége” parancsot.

Használat: niimbot_b1.py -p /dev/rfcomm0 -i cimke.png [-d 3] [-v]
Kilépési kód 0, ha a nyomtató visszaigazolta a nyomtatást.
"""
import argparse
import struct
import sys
import time

import serial
from PIL import Image

VERBOSE = False


def log(*a):
    if VERBOSE:
        print(*a, file=sys.stderr, flush=True)


def packet(cmd, payload=b""):
    body = bytes([cmd, len(payload)]) + payload
    cks = 0
    for b in body:
        cks ^= b
    return b"\x55\x55" + body + bytes([cks]) + b"\xaa\xaa"


def recv(port, timeout=1.0):
    """Egy válaszcsomag (cmd, payload), vagy None időtúllépésnél."""
    port.timeout = timeout
    deadline = time.time() + timeout
    buf = b""
    while time.time() < deadline:
        c = port.read(1)
        if not c:
            continue
        buf += c
        start = buf.find(b"\x55\x55")
        if start < 0:
            buf = buf[-1:]
            continue
        buf = buf[start:]
        if len(buf) >= 4:
            ln = buf[3]
            if len(buf) >= 4 + ln + 3:
                cmd, payload = buf[2], buf[4:4 + ln]
                cks = cmd ^ ln
                for x in payload:
                    cks ^= x
                if cks == buf[4 + ln] and buf[5 + ln:7 + ln] == b"\xaa\xaa":
                    log("<-", hex(cmd), payload.hex())
                    return cmd, payload
                buf = buf[2:]  # hibás csomag, keressük a következőt
    return None


def send(port, cmd, payload=b"", wait=True, timeout=1.0):
    log("->", hex(cmd), payload.hex()[:40])
    port.write(packet(cmd, payload))
    port.flush()
    return recv(port, timeout) if wait else None


def load_rows(path):
    im = Image.open(path)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        bg = Image.new("RGBA", im.size, "white")
        bg.alpha_composite(im.convert("RGBA"))
        im = bg
    im = im.convert("L")
    width, height = im.size
    if width > 384:
        raise SystemExit(f"A kép legfeljebb 384 pixel széles lehet (most {width})")
    px = im.load()
    rows = []
    for y in range(height):
        # A niimctl.py-val egyezően 50 bájtos sorokat küldünk (az első 48 bájt a 384 pont).
        row = bytearray(50)
        for x in range(width):
            if px[x, y] < 128:
                row[x // 8] |= 1 << (7 - (x % 8))
        rows.append(bytes(row))
    return rows, 384, height


def print_image(port_name, path, density=3, row_delay=0.012):
    rows, width, height = load_rows(path)
    with serial.Serial(port_name, timeout=1, write_timeout=10) as s:
        s.reset_input_buffer()
        send(s, 0x21, bytes([density]))         # fekete sűrűség 1–5
        send(s, 0x23, b"\x01")                  # címketípus: résszel elválasztott
        send(s, 0x01, struct.pack(">HIB", 1, 0, 0))  # nyomtatás kezdete (B1, 7 bájtos)
        send(s, 0x03, b"\x01")                  # oldal kezdete
        send(s, 0x13, struct.pack(">HHH", height, width, 1))  # oldalméret

        blank_start, blank_n = None, 0
        for i, row in enumerate(rows):
            if not any(row):
                if blank_start is None:
                    blank_start = i
                blank_n += 1
                if blank_n == 255:
                    send(s, 0x84, struct.pack(">HB", blank_start, blank_n), wait=False)
                    blank_start, blank_n = None, 0
                    time.sleep(row_delay)
                continue
            if blank_n:
                send(s, 0x84, struct.pack(">HB", blank_start, blank_n), wait=False)
                blank_start, blank_n = None, 0
                time.sleep(row_delay)
            black = sum(bin(b).count("1") for b in row)
            send(s, 0x85, struct.pack(">HHH", i, black, 1) + row, wait=False)
            time.sleep(row_delay)
        if blank_n:
            send(s, 0x84, struct.pack(">HB", blank_start, blank_n), wait=False)
            time.sleep(row_delay)

        # A sorok után a nyomtató küld pár csomagot; ezeket kiolvassuk, aztán oldal vége.
        for _ in range(4):
            if recv(s, 0.5) is None:
                break
        send(s, 0xE3, b"\x01", timeout=2)       # oldal vége

        # Állapot lekérdezése, amíg a nyomtató jelzi, hogy az 1. oldal kész (max. ~20 s).
        done = False
        for _ in range(60):
            r = send(s, 0xA3, b"", timeout=1)
            if r and len(r[1]) >= 2 and struct.unpack(">H", r[1][:2])[0] >= 1:
                done = True
                break
            time.sleep(0.3)
        send(s, 0xF3, b"\x01", timeout=2)       # nyomtatás vége
        return done


def main():
    global VERBOSE
    ap = argparse.ArgumentParser(description="Niimbot B1 címkenyomtatás")
    ap.add_argument("-p", "--port", required=True)
    ap.add_argument("-i", "--image", required=True)
    ap.add_argument("-d", "--density", type=int, default=3, choices=range(1, 6))
    ap.add_argument("--row-delay", type=float, default=0.012, help="szünet sorok között (s)")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    VERBOSE = a.verbose
    ok = print_image(a.port, a.image, a.density, a.row_delay)
    if not ok:
        print("A nyomtató nem igazolta vissza a nyomtatást", file=sys.stderr)
        sys.exit(2)
    print("ok")


if __name__ == "__main__":
    main()

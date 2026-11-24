# JEDBET gyártási rendszer (jedbet.xyz)

Cloudflare Worker + D1. A böngészős felület Cloudflare Access mögött van; a Raspberry Pi
csak kifelé kapcsolódik, tokennel.

```
böngésző ──(Access)──> jedbet.xyz  Worker ── D1 (jedbet-gyartas-db)
                                     ▲
Pi (jedbet_agent.py) ── HTTPS ───────┘  /device/readings, /device/print-jobs
```

## Mit hol csinál

| | |
|---|---|
| `src/worker.js` | API: keverés, öntés, készlet, munkák, szenzoradat, nyomtatási sor, érlelés |
| `src/napi.js` | Napi lap: tervezett és plusz feladatok, öntés indítása/lezárása (→ kötés), napzárás, munkások, munkanapló, kifizetések |
| `src/maturity.js` | Nurse–Saul (T₀ = −10 °C) és egyenértékű kor (Freiesleben Hansen, 20 °C) |
| `public/` | A felület. A címkét a böngésző rajzolja (384×240, 1 bites PNG, QR-ral) |
| `src/box.js` | Kötődoboz automatika: fázisok és termosztát (tiszta függvények) |
| `pi/jedbet_agent.py` | Percenként szenzorok → felhő (helyi pufferrel); nyomtatási sor → `niimctl.py`; dugaljak (Shelly) |
| `pi/install.sh` | A Pi-n: telepíti az ügynököt, leállítja a régi szolgáltatásokat, tokent generál |

## Napi lap

- Nézetek: Nap / Hét / Hónap. A nap fejléce mutatja az állapotot (Terv → Folyamatban → Lezárva), a terv teljesítését és egy idővonalat (nap, munkások, öntések). Hét nézetben a feladat áthúzható másik napra.
- Reggel: tervezett feladatok (öntés mintával és darabbal, kiforgatás, mosás, telepítés projekthez, egyéb).
- Öntés: *Öntés indítása* rögzíti a kezdést; *Öntés lezárása* az öntött darabot és a befejezést, és innen indul a kötés (vagy egy nyitott kötéshez adható).
- Kiforgatáskor a kötésnél a raklapok darabszáma; a kötés kártyája mutatja az öntött és a kiforgatott darabot.
- Munkások: érkezés/távozás (HH:MM), szünet; bér órabér, napidíj vagy darabbér szerint, a rögzítéskori díjjal. Kézzel felülírható.
- Napzárás: a nem lezárt tervek „nem készült el” állapotba kerülnek; a nem/részben kész feladatok maradéka átkerülhet a következő napra.
- Egyenleg munkásonként: megdolgozott bér − (bér + előleg + kölcsön) + visszafizetés.

## Érlelés

- Minden mérés eltárolódik; egy *érlelés* egy kezdési időpont és a hozzá rendelt szenzorok.
- A kiforgatási döntést a **legkevésbé érett próbatest** adja; a levegő-szenzor csak tájékoztat.
- 20 percnél hosszabb adatkiesést nem töltünk ki: ott az érettség nem nő (óvatos hiba), és a felület jelzi.
- A küszöb alapból 48 óra egyenértékű kor; laboros kalibrációig becslés.
- Szenzoronként kalibrációs eltolás állítható (jeges vizes próba).

## Kötődoboz automatika

- Egy kötés vezérelheti a dobozt (új kötésnél jelölőnégyzet, vagy a kötés „Automatika ezen a kötésen” gombja). Állapota a `meta` táblában: `box_control`, beállításai: `box_settings`.
- Fázisok a kötés kezdetétől: **várakozás** (alapból 3 óra, csak fagyvédelem 10 °C-ig) → **felfűtés** (12 °C/óra, a felfűtés indulásától és a leghidegebb pont akkori hőmérsékletétől) → **tartás** (32 °C), amíg a döntő próbatest el nem éri a küszöböt → **hűtés** (1 óra, ventilátor) → **kész**.
- A döntés a Pi 10 mp-es dugalj-jelentésénél születik (`/device/plugs`), a doboz levegő-szenzorai alapján (a Nubila-állomás nem számít). Ha a kötésben nincs próbatest, a küszöböt a leghidegebb levegő-szenzor érettsége adja.
- A leghidegebb levegő-szenzorra szabályoz; ha a legmelegebb eléri a 40 °C-ot, a fűtő szünetel, 45 °C-nál a ventilátor is BE. 3 percnél régebbi mérésnél a fűtő KI; a Shelly a Pi kiesésekor 2 perc múlva magától lekapcsol.
- Kézi kapcsolás vagy a kötés lezárása leállítja az automatikát.
- Ehhez a Pi percenként mér (`SAMPLE_SEC=60`).

## Beállítás

Worker → Settings → Variables and Secrets:

- `ACCESS_TEAM_DOMAIN` (szöveg): pl. `jedbet.cloudflareaccess.com`
- `ACCESS_AUD` (szöveg): az Access-alkalmazás „Application Audience (AUD) Tag”-je
- `DEVICE_TOKEN` (titok): amit a `pi/install.sh` kiír
- `NUBILA_EMAIL`, `NUBILA_PASSWORD` (titok): a Nubila-fiók belépési adatai. A Worker ezzel kér tokent (`POST /api/v1/login`), a D1 `meta` táblában tartja, és lejáratkor magától újra belép.
- `NUBILA_TOKEN` (titok, opcionális): kézzel szerzett token, ha nincs belépési adat megadva (kb. 90 napig él; a fejléc 10 nappal előtte szól)
- `NUBILA_DEVICE_SN`: az állomás sorozatszáma (a `wrangler.jsonc`-ben)

A Nubila-állomást (a Nubila „Hyperlocal Weather API for Prediction Market” leírása szerint) a `GET https://api.nubila.ai/api/v1/weather/device/{SN}?limit=1` végpontról olvassuk (Bearer token), 10 percenként cronnal mentve „Nubila állomás” levegő-szenzorként.

Cloudflare Access: egy self-hosted alkalmazás a `jedbet.xyz`-re (engedélyezett e-mail-címekkel),
és egy második a `jedbet.xyz/device/*` útvonalra **Bypass** szabállyal, hogy a Pi elérje.
A Worker a Pi-t a tokennel, a böngészőt az Access JWT-vel ellenőrzi; hiányzó beállításnál mindent elutasít.

## Fejlesztés

```bash
npm install
printf 'DEV_NO_AUTH=1\nDEVICE_TOKEN=valami-legalabb-24-karakter-hosszu\n' > .dev.vars
npm run db:local && npm run dev
```

Séma-változás: új fájl a `migrations/` alá. Az éles D1-ben nincs `d1_migrations` napló (a sémát kézzel vittük fel), ezért az új migrációt közvetlenül kell lefuttatni rajta (`wrangler d1 execute jedbet-gyartas-db --remote --file migrations/000X_….sql`), nem `migrations apply`-jal.

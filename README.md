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
| `src/maturity.js` | Nurse–Saul (T₀ = −10 °C) és egyenértékű kor (Freiesleben Hansen, 20 °C) |
| `public/` | A felület. A címkét a böngésző rajzolja (384×240, 1 bites PNG, QR-ral) |
| `pi/jedbet_agent.py` | 5 percenként szenzorok → felhő (helyi pufferrel); nyomtatási sor → `niimctl.py` |
| `pi/install.sh` | A Pi-n: telepíti az ügynököt, leállítja a régi szolgáltatásokat, tokent generál |

## Érlelés

- Minden mérés eltárolódik; egy *érlelés* egy kezdési időpont és a hozzá rendelt szenzorok.
- A kiforgatási döntést a **legkevésbé érett próbatest** adja; a levegő-szenzor csak tájékoztat.
- 20 percnél hosszabb adatkiesést nem töltünk ki: ott az érettség nem nő (óvatos hiba), és a felület jelzi.
- A küszöb alapból 48 óra egyenértékű kor; laboros kalibrációig becslés.
- Szenzoronként kalibrációs eltolás állítható (jeges vizes próba).

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

Séma-változás: új fájl a `migrations/` alá, majd `npx wrangler d1 migrations apply jedbet-gyartas-db --remote`.

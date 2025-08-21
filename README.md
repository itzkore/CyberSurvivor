# Leaderboards (Upstash Redis, no backend)

Integrované online žebříčky přímo ve hře (bez vlastního backendu) využívající Upstash Redis REST. **Pozor:** token je v klientu, proto *není 100% bezpečné* – používej **allow‑list příkazů** a **rate‑limit** v Upstash.

## Nastavení

1. V Upstash vytvoř Redis DB.
2. V **Tokens / Access Tokens** vytvoř **nový token** s povolenými příkazy:
	- `ZADD`, `ZSCORE`, `ZREVRANGE`, `HSET`, `HGET`, `EXPIRE`
3. Zapni **Rate Limit** (např. 30–60 req/min/IP).
4. Zkopíruj `UPSTASH_REDIS_REST_URL` a token.
5. Zvol způsob injektování konfigurace (priorita zleva – první platné vyhrává):

	 - Build-time env (`.env` nebo `.env.local` – necommituj)

		 ```bash
		 VITE_UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
		 VITE_UPSTASH_REDIS_REST_TOKEN=xxxx
		 ```

	 - Meta tagy v `index.html` (jen pokud chceš hardcode – veřejné!)

		 ```html
		 <meta name="upstash-url" content="https://xxxxx.upstash.io">
		 <meta name="upstash-token" content="xxxxx">
		 ```

	 - LocalStorage (rychlé dev vložení): otevři konzoli a spusť:

		 ```js
		 localStorage.setItem('lb_upstash_url','https://xxxxx.upstash.io');
		 localStorage.setItem('lb_upstash_token','xxxxx');
		 location.reload();
		 ```

	 - Dev overlay (`?lbconfig=1` nebo localhost) – vyplní a uloží do LocalStorage.
6. `npm i` → `npm run dev`

### Kontrola

- `window.__UPSTASH__` existuje v konzoli.
- F9 nebo `?lbdebug=1` zobrazí overlay bez chyb.

## Princip

- Primární metrika = přežitý čas (sekundy). Vyšší = lepší.
- Pomocné statistiky ukládány jako JSON (kills, level, maxDps, timeSec) v `HSET name:<pid>`.
- Jméno + meta se zapisují vždy, čas se zapisuje `ZADD GT` (pouze pokud je vyšší než dříve).
- TOP 10 se načítá v hlavním menu každých 5 s (pokud je konfigurace přítomná).
- Denní / týdenní boardy jsou připravené (TTL přes `EXPIRE`), UI přepínač zatím chybí.

## Bezpečnostní poznámky

- Token je veřejný. Omez příkazy a nastav rate-limit v Upstash.
- Ukládáme jen pseudonym (max 16 znaků) a score.
- Pokud potřebuješ vyšší bezpečnost (HMAC, anti-cheat, audit), přejdi na **backend**.

## Deploy

Před produkcí nastav env proměnné v hostingu (např. Vercel / Render). Nepublikuj `.env` / `.env.local`.

### Build Integration Checklist (Single Index Version)

- [x] `src/index.html` (jediný zdroj) obsahuje meta tagy `google-client-id`, `upstash-url`, `upstash-token` (mohou být prázdné – fallback)
- [x] `lb-config.ts` se načítá před `main.ts` (runtime injektování)
- [x] `.gitignore` ignoruje `.env`, `.env.local`, `.env.*.local`
- [x] `.env.example` doplněn (Upstash, Google, performance)
// Electron support removed – related build steps no longer relevant.
- [x] CSP v `src/index.html` povoluje `https://*.upstash.io` v `connect-src`
- [x] Leaderboard kód chrání před chybějící konfigurací (`isLeaderboardConfigured`)
- [x] Debug overlay: F9 / `?lbdebug=1`
- [x] Rate-limit řešen přes Upstash (nutno nastavit v UI)

Poznámka: Historicky existoval duplikovaný root `index.html` pro Electron vs. dev server. Konsolidováno do jednoho (`src/index.html`) aby se předešlo driftu a přehlédnutým změnám.

### Rotace tokenu

1. V Upstash vytvoř nový token se stejnými povolenými příkazy.
2. Nasad nový token jako env (nebo meta / localStorage).
3. Otestuj.
4. Deaktivuj starý token.

## Akceptační kritéria (self-check)

- Při chybějících env proměnných se místo chyb jen zobrazí "Leaderboard not configured" a neprobíhají volání na `undefined` URL.
- `submitScore` zapisuje pouze lepší (delší) čas (`ZADD GT`) a ukládá meta JSON.
- `fetchTop` vrací objekty: `{ rank, playerId, name, timeSec, kills?, level?, maxDps? }`.
- Připravené režimy `daily:auto` / `weekly:auto` generují klíč + TTL (`EXPIRE`).
- Při `429` je pouze konzolové varování, aplikace pokračuje.

## Poznámky k Upstash

- Pokud chceš minimalizovat počet požadavků, další krok je batchování `HGET` (TODO).
- CORS: Upstash REST obvykle funguje přímo z prohlížeče.
- Token rotuj, pokud unikne.
- Chyby sleduj v konzoli, logy jsou stručné.

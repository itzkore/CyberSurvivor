# Leaderboard Deployment & CSP Guidance

This project’s frontend auto-probes for a backend at runtime (same-origin `/api/leaderboard/health`, then `https://api.<apex>` and `https://<apex>`). In a locked-down production Content Security Policy (CSP), those probe requests may be blocked unless explicitly whitelisted in the `connect-src` directive.

## 1. Recommended Topology

Option A (Preferred): Reverse proxy on the SAME origin.


```text
https://www.example.com           -> static site (Vite build)
https://www.example.com/api/...   -> proxy -> Node backend (port 3000)
```
Advantages: No extra origins, CSP stays tight (`connect-src 'self'`), cookies (if later added) stay same-site.

Option B: Dedicated subdomain.


```text
https://api.example.com           -> Node backend
```
Must add `https://api.example.com` to `connect-src` (and possibly `default-src` if strict) in CSP.

## 2. Nginx Reverse Proxy Snippet (Option A)
```nginx
location /api/leaderboard/ {
  proxy_pass http://127.0.0.1:3000/api/leaderboard/; # ensures path suffix preserved
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_http_version 1.1;
}
# Optional: generic /verify and /profile endpoints
location /verify { proxy_pass http://127.0.0.1:3000/verify; }
location /profile { proxy_pass http://127.0.0.1:3000/profile; }
```

## 3. CSP Adjustments
If you stay with a separate API origin (`api.example.com`), update header, e.g.:
```text
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:;
```
(Adapt other directives you already use.)

## 4. Hard Configure Backend Base (Avoid Probing)
Pick ONE method:
1. Build-time env: add to `.env.production`:

  ```bash
  VITE_BACKEND_API_BASE=https://api.example.com
  ```

2. Meta tag in `index.html` head:

  ```html
  <meta name="backend-api-base" content="https://api.example.com">
  ```

3. Runtime global before bundle loads:

  ```html
  <script>window.__BACKEND_API_BASE = 'https://api.example.com';</script>
  ```

4. Query param (debug/manual): `?apiBase=https://api.example.com`

## 5. Prevent Console Spam When Backend Missing
If you intentionally deploy without backend, set a localStorage override to blank and the service will fallback to local-only scores:
```js
localStorage.removeItem('backend.apiBase');
```
(The updated service now suppresses repeated attempts after CSP blocks.)

## 6. Health Check
Ensure backend serves:
```
GET /api/leaderboard/health -> { ok: true, backend: "redis|memory|mysql", season, ts }
```
If this 404s via the proxy, re-check location block path endings.

## 7. Minimum Ports / Process
```bash
NODE_ENV=production PORT=3000 node backend/server.js
```
If using systemd:
```ini
[Service]
ExecStart=/usr/bin/node /var/www/app/backend/server.js
WorkingDirectory=/var/www/app
Restart=always
Environment=PORT=3000
```

## 8. Troubleshooting Matrix
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| 404 /api/leaderboard/health (same origin) | Proxy not configured or path mismatch | Add proxy location block or correct path |
| CSP Refused to connect api.example.com | Origin not in `connect-src` | Add origin to CSP header |
| Repeated CSP console spam | Probing multiple blocked hosts | Hard-config base OR update CSP OR use reverse proxy |
| Rank always null | Score never submitted (HMAC mismatch?) | Ensure either set LB_HMAC_SECRET consistently or unset it |

## 9. Environment Variables (Server)
- `LB_ALLOWED_MODES`, `LB_ALLOWED_CHARS` (whitelist)
- `LB_HMAC_SECRET` (set for production signing)
- `LB_HMAC_SOFT=1` (soft fail during rollout)
- `LB_ANTICHEAT_SOFT=1` (optional soft mode)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`

## 10. Rollout Checklist
1. Stand up backend (memory or Redis) locally, confirm health.
2. Put reverse proxy rule in place (or DNS for api subdomain).
3. Adjust CSP `connect-src`.
4. Add meta tag or build env to fix base.
5. Smoke test: open site, confirm no 404/CSP errors; top endpoint returns empty list or entries.
6. Enable HMAC once clients updated.

---
Generated automatically to accompany leaderboard deployment.

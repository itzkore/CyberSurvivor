# Google Sign-In (Profile + Optional Remote Leaderboard)

Project supports Google Sign-In for nickname/profile. Remote leaderboards are optional:

- No-backend mode using Upstash Redis REST (client-side; allow-listed commands). See root `README.md` for setup under “Leaderboards (Upstash Redis, no backend)”.
- Minimal backend mode (sample Express server) for token verification and profile storage.

Local high scores (`HighScoreService`) are kept as a fallback for offline or when remote config is missing.

## Components

Front-end:

1. `AuthService.ts` – wraps Google Identity Services (one-tap + fallback modal), nickname, token expiry refresh, backend verification.
2. `RemoteLeaderboardService.ts` – optional integration; for Upstash mode refer to `src/lb-config.ts` and root README.
3. `HighScoreService.ts` – local storage fallback for offline / no-backend mode.
4. Updated UI (`MainMenu.ts`, `GameOverOverlay.ts`) shows profile, nickname modal, and high scores.

Backend (sample):
`backend/server.js` – Minimal Express server exposing only `/verify` and `/profile` (optional when using Upstash no-backend mode).

## Environment Variables

Create a `.env` (or pass via shell) for the front-end (Vite):

```env
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID
VITE_BACKEND_API_BASE=http://localhost:8787
```

Backend env:

```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID
PORT=8787
```

## Running (Dev)

Terminal 1 (backend):

```bash
npm run backend
```

Terminal 2 (frontend):

```bash
npm run dev
```

Navigate to `http://localhost:5173`.

## Score Submission Flow (backend mode)

1. Game over records score locally via `HighScoreService.record()`.
2. Service verifies token freshness via `AuthService.ensureValidToken()`.
3. Backend verifies ID token signature & audience; updates in-memory board.
4. Client refreshes top scores (remote first, local fallback).

## Nickname Handling

- Auto-generated locally on first sign-in if none.
- User can edit via nickname modal; update propagates to backend `/profile` (if configured).
- Backend currently uses a simple pattern `Player-xxxxx` for scoreboard entries; customize to store canonical nickname across sessions.

## Security Notes

- Current backend keeps data in-memory only (ephemeral).
- Scores are *not* secured against tampering. A production system should:
  - Recompute scores server-side or store raw game events for validation.
  - Apply rate limiting & anomaly detection.
  - Use server authoritative logic for final score acceptance.
- ID token verification occurs per privileged write endpoint. Consider caching Google certs (library already handles this).

## Extending

| Goal | Change |
| ---- | ------ |
| Remote leaderboard | Re-introduce APIs and backend storage (feature removed). |
| Anti-cheat | Obfuscate client, add server recompute, telemetry checks. |
| Session API | Issue own session JWT after /verify to avoid sending Google token every call. |

## Minimal Backend Hardening TODO

- Input validation (mode, characterId, numeric limits)
- Nickname uniqueness & reservation
- CORS whitelist instead of `origin: true`
- Logging & monitoring

## License

Sample backend code is provided under the project’s existing license. Adjust as needed.

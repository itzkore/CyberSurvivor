# Google Sign-In (Remote Leaderboard Removed)

Project supports Google Sign-In for nickname/profile only. Remote leaderboard endpoints and related service were removed; the game now uses purely local high scores (`HighScoreService`).

## Components

Front-end:

1. `AuthService.ts` – wraps Google Identity Services (one-tap + fallback modal), nickname, token expiry refresh, backend verification.
2. `RemoteLeaderboardService.ts` – (removed/stub) previously handled remote leaderboard.
3. `HighScoreService.ts` – local storage fallback for offline / no-backend mode.
4. Updated UI (`MainMenu.ts`, `GameOverOverlay.ts`) shows profile, nickname modal, and high scores.

Backend (sample):
`backend/server.js` – Minimal Express server exposing only `/verify` and `/profile`.

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

## Score Submission Flow

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

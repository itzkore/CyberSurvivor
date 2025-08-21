# CyberSurvivor Backend (Stripped)

All leaderboard functionality (submit/top/around/rank/migrate) has been removed by design choice. The backend now only provides minimal profile endpoints for Google-authenticated users:

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | /verify | Verifies Google ID token and returns (userId, nickname, profileComplete). |
| POST | /profile | Sets nickname (sanitized) for authenticated user. |
| GET  | /health | Simple health probe (returns msg indicating leaderboard removal). |

Remote leaderboard integration code in the frontend has been replaced by purely local high score tracking (`HighScoreService`). The previous `RemoteLeaderboardService` now exists only as a stub to avoid breaking imports.

## Environment Variables

Legacy leaderboard-related variables (`UPSTASH_*`, `LB_*`, `DUAL_WRITE_MYSQL`, `MIGRATION_SECRET`) are no longer used. You can remove them from deployment configuration.

## Running

```bash
npm install
node server.js
```

## Future Re-Enablement

If a remote leaderboard is desired again, reintroduce a new service rather than resurrecting the deleted routes to keep the codebase lean. Consider a separate microservice repository for clearer ownership.

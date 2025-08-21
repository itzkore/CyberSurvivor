// Leaderboard removed: stub to satisfy legacy imports if any remain temporarily.
export const RemoteLeaderboardService = {
  submit: () => {},
  getTop: () => [],
  getAround: () => ({ rank: null, entries: [] }),
  getRank: () => null,
  isAvailable: () => false,
  getLastError: () => 'removed'
};

export type LeaderEntry = { rank: number; playerId: string; name: string; timeSec: number; kills?: number; level?: number; maxDps?: number };
export function sanitizeName(name: string): string;
// input may be: 'global', 'daily:auto', 'weekly:auto', 'monthly:auto', or explicit 'daily:YYYY-MM-DD', 'weekly:YYYY-Www', 'monthly:YYYY-MM'
export function resolveBoard(input: string): { board: string; ttlSeconds?: number };
export function submitScore(opts:{ board?: string; playerId: string; name: string; timeSec: number; kills: number; level: number; maxDps: number; ttlSeconds?: number }): Promise<void>;
export function submitScoreAllPeriods(opts:{ playerId: string; name: string; timeSec: number; kills: number; level: number; maxDps: number }): Promise<void>;
export function fetchTop(board?: string, limit?: number, offset?: number): Promise<LeaderEntry[]>;

/**
 * Tiny event bus for decoupled gameplay diagnostics and hooks.
 * Keeps using window.dispatchEvent for existing flows; this augments with a TS-friendly API.
 */
export type EventMap = {
  enemyHit: { enemyId: string; amount: number; isCritical?: boolean; weapon?: number; x: number; y: number };
  enemyDead: { id: string; elite?: boolean; kind?: string; x: number; y: number; time: number };
  eliteSpawned: { kind: string; x: number; y: number; time: number };
};

type Handler<T> = (payload: T) => void;

class EventBus {
  private listeners = new Map<string, Set<Function>>();

  on<K extends keyof EventMap>(type: K, fn: Handler<EventMap[K]>): void {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn as any);
  }

  off<K extends keyof EventMap>(type: K, fn: Handler<EventMap[K]>): void {
    const key = String(type);
    this.listeners.get(key)?.delete(fn as any);
  }

  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    const key = String(type);
    const set = this.listeners.get(key);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try { (fn as Handler<EventMap[K]>)(payload); } catch {}
    }
  }
}

export const eventBus = new EventBus();

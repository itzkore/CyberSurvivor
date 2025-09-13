import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { BrainstormSwarmRMB } from './abilities/brainstorm_swarm_rmb';

export class NeuralNomadAbilityManager extends BaseAbilityManagerImpl {
  private swarm?: BrainstormSwarmRMB;

  constructor() { super('neural_nomad'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.swarm = new BrainstormSwarmRMB(g, player as Player);
      const self = this;
      if (!(player as any).getNomadSwarmMeter) {
        (player as any).getNomadSwarmMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          return self.swarm ? self.swarm.getMeter(now) : { value: 0, max: 18000, ready: true, active: false };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.swarm) this.swarm = new BrainstormSwarmRMB(g, p);
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const edge = rDown && !prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Provide click world coords if available for boomerang destination
    const cx = (ms && typeof ms.worldX === 'number') ? ms.worldX : undefined;
    const cy = (ms && typeof ms.worldY === 'number') ? ms.worldY : undefined;
    if (!inputLocked) this.swarm!.update(now, deltaTime, rDown, edge, cx, cy);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const out: any = {};
    const p: any = this.player;
    if (p && typeof p.getNomadSwarmMeter === 'function') {
      const m = p.getNomadSwarmMeter();
      out.nomad_swarm = { value: m.value, max: m.max, ready: m.ready, active: !!m.active };
    }
    if (p && typeof p.getOvermindMeter === 'function') {
      const sm = p.getOvermindMeter();
      out.overmind_overload = { value: sm.value, max: sm.max, ready: sm.ready, active: !!sm.active };
    }
    return out;
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  render(ctx: CanvasRenderingContext2D, player: any): void {
    try { this.swarm?.drawWorld(ctx, player); } catch {}
  }

  onTimeShift(deltaMs: number): void {
    const sw: any = this.swarm as any; if (!sw) return;
    try {
      if (typeof sw['cdUntil'] === 'number') sw['cdUntil'] += deltaMs;
      const arr = sw['drones']; if (Array.isArray(arr)) { for (let i=0;i<arr.length;i++){ if (typeof arr[i].next === 'number') arr[i].next += deltaMs; } }
    } catch {}
  }
}

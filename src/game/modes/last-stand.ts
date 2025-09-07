import { WaveManager } from './wave-manager';
import { ShopManager } from './shop-manager';
import { CurrencySystem } from './currency-system';
import { TurretManager } from './turret-manager';
import { eventBus } from '../../core/EventBus';
import { LastStandHUD } from '../../ui/LastStandHUD';
import { LastStandShopOverlay } from '../../ui/LastStandShopOverlay';

type Phase = 'COMBAT'|'SHOP';

export class LastStandGameMode {
  private phase: Phase = 'COMBAT';
  private wave = new WaveManager();
  private shop = new ShopManager();
  private currency = new CurrencySystem();
  private turrets = new TurretManager();
  private hud = new LastStandHUD();
  private overlay!: LastStandShopOverlay;
  private shopEndsAtMs = 0;

  constructor(private game: any){
    this.hud.show(); this.hud.setPhase('COMBAT');
    this.currency.onChange(v => this.hud.setScrap(v));
    // Earn 1 scrap per kill baseline; decrement alive counter
    eventBus.on('enemyDead', () => {
      this.currency.add(1);
      this.wave.onEnemyDefeated();
    });
    // Turret placement via event
    window.addEventListener('laststand:placeTurret', (e: Event) => {
      const d = (e as CustomEvent).detail || {}; const id = d.turretId || 'turret_gun';
      this.turrets.place(id, this.game.player.x, this.game.player.y);
    });
  }

  async init(){
    await Promise.all([ this.wave.load(), this.shop.load(), this.turrets.load() ]);
    this.hud.setWave(this.wave.getCurrentWaveNumber()+1);
    this.overlay = new LastStandShopOverlay(this.shop, this.currency, (off) => {
      this.shop.purchase(off, this.game, this.currency);
    }, () => {
      // Exit shop early
      this.endShopPhase();
    });
    this.startCombatPhase(true);
  }

  update(deltaMs: number){
    // Update turrets always
    this.turrets.update(deltaMs, this.game.getEnemyManager());
    // Shop countdown
    if (this.phase === 'SHOP'){
      const remain = Math.max(0, Math.ceil((this.shopEndsAtMs - performance.now())/1000));
      this.hud.setTimer(remain);
      this.overlay?.setTimer(remain);
      if (performance.now() >= this.shopEndsAtMs) this.endShopPhase();
    }
  }

  private startCombatPhase(first=false){
    this.phase = 'COMBAT';
    this.hud.setPhase('COMBAT'); this.hud.setTimer(0);
    const EM:any = this.game.getEnemyManager();
    // Ensure spawns are active
    try { (EM as any).spawnFreezeUntilMs = 0; } catch {}
    // Start next wave and optionally a boss every 5th wave
    const bm:any = (window as any).__bossManager;
    const nextWave = this.wave.getCurrentWaveNumber()+1;
    this.hud.setWave(nextWave);
    this.wave.startNextWave(EM, this.game.player);
    if (nextWave % 5 === 0 && bm && typeof bm['spawnBoss'] === 'function') {
      // Spawn boss near player without cinematic pause
      bm['spawnBoss']({ cinematic: false });
    }
    // When wave completes, open shop
    this.wave.onWaveComplete(()=> this.startShopPhase());
    if (first) this.currency.add(40); // seed some scrap
  }

  private startShopPhase(){
    this.phase = 'SHOP';
    this.hud.setPhase('SHOP');
    const EM:any = this.game.getEnemyManager();
    // Freeze dynamic spawns for the duration
    try {
      const until = performance.now() + 30000; // 30s shop timer
      (EM as any).spawnFreezeUntilMs = Math.max((EM as any).spawnFreezeUntilMs || 0, until);
    } catch {}
    this.shopEndsAtMs = performance.now() + 30000;
    this.overlay.setTimer(30);
    this.overlay.show();
  }

  private endShopPhase(){
    this.overlay.hide();
    this.startCombatPhase();
  }
}

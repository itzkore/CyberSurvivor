import { CurrencySystem } from '../game/modes/currency-system';
import { ShopManager } from '../game/modes/shop-manager';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { WeaponType } from '../game/WeaponType';

type Offer = ReturnType<ShopManager['rollOffers']>[number];

export class LastStandShopOverlay {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  private closeBtn: HTMLButtonElement;
  private rerollBtn: HTMLButtonElement;
  private timer: HTMLSpanElement;
  private visible = false;
  private offers: Offer[] = [];
  private rerollBase = 20;
  private rerollCount = 0;
  private scrapSpan!: HTMLSpanElement;
  // Track purchased offer ids for the current roll to enforce one-time purchase per card
  private purchasedIds: Set<string> = new Set();

  constructor(private shop: ShopManager, private currency: CurrencySystem, private onPurchase:(offer:Offer)=>void, private onExit:()=>void) {
    const root = document.createElement('div');
    root.className = 'ls-shop-overlay';
    Object.assign(root.style, {
      position:'fixed', inset:'0', display:'none', zIndex:'60',
      background:'radial-gradient(1200px 600px at 50% 10%, rgba(0,20,26,0.96), rgba(0,0,0,0.96))',
      color:'#eaffff', font:'600 14px Orbitron, system-ui, Segoe UI, Roboto, sans-serif',
      alignItems:'center', justifyContent:'center'
    } as CSSStyleDeclaration);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      minWidth:'820px', maxWidth:'1100px', border:'1px solid rgba(120,255,235,0.25)', padding:'18px 18px 14px 18px', borderRadius:'14px',
      background:'linear-gradient(180deg, rgba(2,18,22,0.95), rgba(0,10,12,0.95))', boxShadow:'0 14px 60px rgba(0,255,220,0.20)',
      backdropFilter:'blur(3px)'
    } as CSSStyleDeclaration);
    const header = document.createElement('div');
    header.innerHTML = '<span style="color:#7dffea">ARMORY</span> · Last Stand';
    Object.assign(header.style, { fontSize:'24px', marginBottom:'6px', color:'#a5fff5', letterSpacing:'0.8px', textShadow:'0 0 12px rgba(0,255,220,0.25)' } as CSSStyleDeclaration);
  const sub = document.createElement('div');
  const capNote = `<span style="opacity:.85;font-size:11px;color:#8cf6ff">(Max 3 weapons, 3 passives)</span>`;
  sub.innerHTML = `Scrap <span id="ls-shop-scrap" style="color:#fff">${this.currency.getBalance()}</span> · <span style="opacity:.9">Shop closes in <span id="ls-shop-timer">30</span>s</span> ${capNote}`;
    Object.assign(sub.style, { fontSize:'12px', opacity:'0.95', marginBottom:'10px', display:'flex', justifyContent:'space-between', alignItems:'center' } as CSSStyleDeclaration);
    this.timer = sub.querySelector('#ls-shop-timer') as HTMLSpanElement;
    this.scrapSpan = sub.querySelector('#ls-shop-scrap') as HTMLSpanElement;
    const list = document.createElement('div'); this.list = list;
    Object.assign(list.style, { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' } as CSSStyleDeclaration);
    const actions = document.createElement('div');
    Object.assign(actions.style, { marginTop:'12px', display:'flex', gap:'8px', justifyContent:'space-between', alignItems:'center' } as CSSStyleDeclaration);
    const reroll = document.createElement('button'); this.rerollBtn = reroll;
    reroll.textContent = 'Reroll (20)  [R]';
    const close = document.createElement('button'); this.closeBtn = close; close.textContent = 'Leave Shop  [Enter]';
    Object.assign(reroll.style, { padding:'9px 14px', borderRadius:'9px', border:'1px solid #0aa', background:'linear-gradient(180deg,#07323a,#042126)', color:'#7dffea', cursor:'pointer' } as CSSStyleDeclaration);
    Object.assign(close.style, { padding:'9px 14px', borderRadius:'9px', border:'1px solid rgba(0,170,170,0.65)', background:'linear-gradient(180deg,#0a2227,#051518)', color:'#bff', cursor:'pointer' } as CSSStyleDeclaration);
    actions.appendChild(reroll); actions.appendChild(close);
    panel.appendChild(header); panel.appendChild(sub); panel.appendChild(list); panel.appendChild(actions);
    root.appendChild(panel);
    document.body.appendChild(root);
    this.root = root;

    this.currency.onChange(v => {
      const s = panel.querySelector('#ls-shop-scrap'); if (s) s.textContent = String(v);
    });
    reroll.onclick = () => this.handleReroll();
    close.onclick = () => this.exit();

    // Keyboard shortcuts
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.visible) return;
      if (e.key.toLowerCase() === 'r') { this.handleReroll(); e.preventDefault(); }
      if (e.key === 'Enter') { this.exit(); e.preventDefault(); }
      const idx = parseInt(e.key, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= this.offers.length) {
        const target = this.offers[idx-1];
        if (this.purchasedIds.has(target.id)) return;
        if (this.currency.getBalance() >= target.price) {
          this.onPurchase(target);
          this.purchasedIds.add(target.id);
          this.refreshOffers(false);
        }
      }
    });
  }

  setTimer(seconds:number){ this.timer.textContent = String(Math.max(0, Math.ceil(seconds))); }

  private renderOffers(){
    this.list.innerHTML = '';
    // Discover player's default weapon to badge class items
    let playerDefault: WeaponType | undefined;
    try { playerDefault = ((window as any).__gameInstance || (window as any).game || {}).selectedCharacterData?.defaultWeapon; } catch {}
    for (let i=0;i<this.offers.length;i++) {
      const off = this.offers[i];
      const kind = off.kind;
      const alreadyBought = this.purchasedIds.has(off.id);
      // Derive spec/name/icon for better presentation
      let displayName = off.id;
      let subtitle = '';
      let iconUrl = '';
      let accent = '#7dffea';
      if (kind === 'weapon') {
        const wt = off.data?.weaponType as WeaponType | undefined;
        const spec = (wt != null) ? WEAPON_SPECS[wt] : undefined;
        displayName = spec?.name || displayName;
        subtitle = spec?.traits?.slice(0,3).join(' • ') || spec?.description || 'Weapon';
        const raw = (spec?.icon || spec?.projectileVisual?.sprite || '/assets/projectiles/bullet_cyan.png') as string;
        const norm = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath(raw.startsWith('/') ? raw : ('/' + raw.replace(/^\.\//, ''))) : raw;
        iconUrl = norm;
        accent = '#57ffb0';
      } else if (kind === 'passive') {
        const p = PASSIVE_SPECS.find(p => p.name === off.data?.passiveName);
        displayName = p?.name || displayName;
        subtitle = p?.description || 'Passive bonus';
        iconUrl = (p?.icon || '') as string;
        if (iconUrl) iconUrl = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath(iconUrl) : iconUrl;
        accent = '#a5b7ff';
      } else if (kind === 'perk') {
        displayName = displayName.replace(/^perk[_-]/,'').toUpperCase();
        subtitle = 'Immediate stat boost';
        accent = '#ddb16f';
      } else if (kind === 'turret') {
        subtitle = 'Deployable defense';
        accent = '#eaa';
      } else if (kind === 'bonus') {
        displayName = off.data?.name || 'Bonus';
        subtitle = 'Utility upgrade';
        accent = '#ffd36b';
      }
      const card = document.createElement('button');
      card.type = 'button';
      Object.assign(card.style, { border:`1px solid rgba(120,255,235,0.25)`, borderRadius:'12px', padding:'12px', background:'linear-gradient(180deg, rgba(2,22,26,0.95), rgba(0,12,14,0.92))', color:'#cffffa', textAlign:'left', cursor:'pointer', display:'grid', gridTemplateColumns:'64px 1fr auto', gap:'12px', alignItems:'center', transition:'transform 80ms ease-out, box-shadow 120ms ease-out', position:'relative', overflow:'hidden' } as CSSStyleDeclaration);
      card.onmouseenter = () => { card.style.boxShadow = '0 0 24px rgba(0,255,220,0.18)'; card.style.transform = 'translateY(-1px)'; };
      card.onmouseleave = () => { card.style.boxShadow = 'none'; card.style.transform = 'none'; };
      const icon = document.createElement('div');
      Object.assign(icon.style, { width:'64px', height:'64px', borderRadius:'10px', background:'rgba(0,255,220,0.06)', display:'grid', placeItems:'center', fontSize:'22px', color:'#7dffea', overflow:'hidden', border:`1px solid rgba(120,255,235,0.15)` } as CSSStyleDeclaration);
      if (iconUrl) {
        const img = document.createElement('img'); img.src = iconUrl; img.alt = displayName; Object.assign(img.style, { width:'100%', height:'100%', objectFit:'contain' } as CSSStyleDeclaration);
        icon.appendChild(img);
      } else {
        icon.textContent = kind === 'passive' ? '▲' : kind === 'turret' ? '⛭' : '⨳';
      }
      const body = document.createElement('div');
      const title = document.createElement('div'); title.textContent = displayName; Object.assign(title.style, { color:accent, marginBottom:'4px', fontSize:'16px', letterSpacing:'0.2px' } as CSSStyleDeclaration);
      const desc = document.createElement('div'); desc.textContent = subtitle || this.describe(off); Object.assign(desc.style, { fontSize:'12px', opacity:'0.92' } as CSSStyleDeclaration);
      // Class badge
      let titleNode: HTMLElement = title;
      if (kind === 'weapon' && playerDefault != null && off.data?.weaponType === playerDefault) {
        const badge = document.createElement('span'); badge.textContent = 'CLASS'; Object.assign(badge.style, { marginLeft:'8px', fontSize:'10px', padding:'2px 6px', borderRadius:'6px', background:'#2dbd8b', color:'#012', border:'1px solid rgba(0,0,0,0.25)' } as CSSStyleDeclaration);
        const wrap = document.createElement('div'); Object.assign(wrap.style, { display:'flex', alignItems:'center' } as CSSStyleDeclaration);
        wrap.appendChild(title); wrap.appendChild(badge);
        titleNode = wrap;
      }
      const buyWrap = document.createElement('div');
      Object.assign(buyWrap.style, { display:'grid', gap:'6px', justifyItems:'end', alignContent:'center' } as CSSStyleDeclaration);
      const price = document.createElement('div'); price.textContent = `${off.price} Scrap`; Object.assign(price.style, { fontSize:'15px', color:'#fff', textShadow:'0 0 10px rgba(120,255,235,0.25)' } as CSSStyleDeclaration);
  const buyBtn = document.createElement('div'); buyBtn.textContent = alreadyBought ? 'Purchased' : `Buy  [${i+1}]`; Object.assign(buyBtn.style, { fontSize:'12px', color:'#012', background:accent, padding:'6px 10px', borderRadius:'8px', border:'1px solid rgba(0,0,0,0.2)' } as CSSStyleDeclaration);
      const hint = document.createElement('div'); hint.textContent = `[#${i+1}]`; Object.assign(hint.style, { fontSize:'11px', opacity:'0.65', textAlign:'right' } as CSSStyleDeclaration);
  body.appendChild(titleNode); body.appendChild(desc);
      buyWrap.appendChild(price); buyWrap.appendChild(buyBtn);
      card.appendChild(icon); card.appendChild(body); card.appendChild(buyWrap);

      // Enforce UI disabling for caps in Last Stand (mirror of ShopManager.purchase guard)
      const isLastStand = ((window as any).__gameInstance?.gameMode) === 'LAST_STAND';
      let capped = false;
      if (isLastStand) {
        try {
          if (off.kind === 'weapon') {
            const aw: Map<number, number> | undefined = (window as any).__gameInstance?.player?.activeWeapons || (window as any).game?.player?.activeWeapons;
            const size = aw ? (aw as any).size : 0;
            const has = aw ? (aw as any).has(off.data?.weaponType) : false;
            capped = !has && size >= 3;
          } else if (off.kind === 'passive') {
            const ap: Array<{type:string,level:number}> | undefined = (window as any).__gameInstance?.player?.activePassives || (window as any).game?.player?.activePassives;
            const count = Array.isArray(ap) ? ap.length : 0;
            const already = Array.isArray(ap) ? !!ap.find(p => p.type === off.data?.passiveName) : false;
            capped = !already && count >= 3;
          }
        } catch { /* ignore */ }
      }
      const affordable = this.currency.getBalance() >= off.price && !capped && !alreadyBought;
      if (!affordable) {
        card.style.opacity = '0.8';
        buyBtn.style.filter = 'grayscale(0.4)';
        buyBtn.style.background = '#244a49';
        if (alreadyBought) buyBtn.textContent = 'Purchased'; else buyBtn.textContent = 'Insufficient';
      }

      card.onclick = () => {
        if (!affordable) return;
        this.onPurchase(off);
        this.purchasedIds.add(off.id);
        this.refreshOffers(false);
      };
      this.list.appendChild(card);
    }
  }

  private refreshOffers(newRoll = true){
    if (newRoll) this.offers = this.shop.rollOffers(6);
    this.renderOffers();
    this.updateRerollUI();
  }

  show(){ this.visible = true; this.root.style.display = 'flex'; this.purchasedIds.clear(); this.refreshOffers(); }
  hide(){ this.visible = false; this.root.style.display = 'none'; }
  isVisible(){ return this.visible; }
  exit(){ this.hide(); this.onExit(); }

  private handleReroll(){
    const price = this.currentRerollPrice();
    if (this.currency.spend(price)) {
      this.rerollCount++;
      this.refreshOffers();
      this.updateRerollUI();
    }
  }

  private currentRerollPrice(){ return this.rerollBase + Math.floor(this.rerollCount * 10); }
  private updateRerollUI(){ this.rerollBtn.textContent = `Reroll (${this.currentRerollPrice()})  [R]`; if (this.scrapSpan) this.scrapSpan.textContent = String(this.currency.getBalance()); }

  private describe(off: Offer): string {
    switch (off.kind) {
      case 'weapon': return 'Unlocks a new weapon for your loadout.';
      case 'passive': return 'Permanent passive bonus.';
      case 'perk': return 'Instant stat increase.';
      case 'turret': return 'Place an automated turret in the arena.';
      default: return '';
    }
  }
}

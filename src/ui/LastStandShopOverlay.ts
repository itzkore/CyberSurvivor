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
  private freeSpan!: HTMLSpanElement;
  // Track purchased offer ids for the current roll (one-time purchase per card)
  private purchasedIds: Set<string> = new Set();

  constructor(
    private shop: ShopManager,
    private currency: CurrencySystem,
    private onPurchase: (offer: Offer, useFree?: boolean) => void,
    private onExit: () => void
  ) {
    const root = document.createElement('div');
    root.className = 'ls-shop-overlay';
    Object.assign(root.style, {
      position: 'fixed', inset: '0', display: 'none', zIndex: '60',
      background: 'radial-gradient(1200px 600px at 50% 10%, rgba(0,20,26,0.96), rgba(0,0,0,0.96))',
      color: '#eaffff', font: '600 14px Orbitron, system-ui, Segoe UI, Roboto, sans-serif',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'auto'
    } as CSSStyleDeclaration);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: '1280px', height: '680px',
      border: '1px solid rgba(120,255,235,0.25)', borderRadius: '14px',
      background: 'linear-gradient(180deg, rgba(2,18,22,0.95), rgba(0,10,12,0.95))', boxShadow: '0 24px 90px rgba(0,255,220,0.22)',
      backdropFilter: 'blur(4px)',
      display: 'grid', gridTemplateRows: 'auto auto 1fr auto', padding: '18px'
    } as CSSStyleDeclaration);

    // Header
    const header = document.createElement('div');
    header.innerHTML = '<span style="color:#7dffea">ARMORY</span> · Last Stand';
    Object.assign(header.style, { fontSize: '24px', marginBottom: '6px', color: '#a5fff5', letterSpacing: '0.8px', textShadow: '0 0 12px rgba(0,255,220,0.25)' } as CSSStyleDeclaration);

    // Sub-header (timer + caps note + currency/free tokens)
    const sub = document.createElement('div');
    sub.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="opacity:.9">Shop resets in</span>
          <span id="ls-shop-timer" style="color:#fff">15</span>s
          <span style="opacity:.85;font-size:11px;color:#8cf6ff">(Max 3 weapons, 3 passives)</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="opacity:.9">Scrap</span>
          <span id="ls-shop-scrap" style="color:#fff;background:rgba(120,255,235,0.1);border:1px solid rgba(120,255,235,0.25);padding:4px 8px;border-radius:8px;">${this.currency.getBalance()}</span>
          <span id="ls-shop-free" style="color:#fff;background:rgba(255,210,120,0.10);border:1px solid rgba(255,210,120,0.35);padding:4px 8px;border-radius:8px;">Free: ${this.currency.getFreeUpgradeTokens()}</span>
        </div>
      </div>`;
    this.timer = sub.querySelector('#ls-shop-timer') as HTMLSpanElement;
    this.scrapSpan = sub.querySelector('#ls-shop-scrap') as HTMLSpanElement;
    this.freeSpan = sub.querySelector('#ls-shop-free') as HTMLSpanElement;

    // List grid (4 columns)
    const listWrap = document.createElement('div');
    Object.assign(listWrap.style, { position: 'relative', overflow: 'hidden', paddingRight: '0' } as CSSStyleDeclaration);
    const list = document.createElement('div');
    this.list = list;
  Object.assign(list.style, { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px', alignContent: 'start' } as CSSStyleDeclaration);
    listWrap.appendChild(list);

    // Footer actions
    const actions = document.createElement('div');
    Object.assign(actions.style, { marginTop: '10px', display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' } as CSSStyleDeclaration);
    const reroll = document.createElement('button');
    this.rerollBtn = reroll;
    reroll.textContent = 'Reroll (20)  [R]';
    Object.assign(reroll.style, { padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(120,255,235,0.25)', background: 'rgba(120,255,235,0.10)', color: '#eaffff', cursor: 'pointer' } as CSSStyleDeclaration);
    const close = document.createElement('button');
    this.closeBtn = close;
    close.textContent = 'Resume  [Enter]';
    Object.assign(close.style, { padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(120,255,235,0.25)', background: 'rgba(120,255,235,0.10)', color: '#eaffff', cursor: 'pointer' } as CSSStyleDeclaration);
    actions.appendChild(reroll);
    actions.appendChild(close);

    panel.appendChild(header);
    panel.appendChild(sub);
    panel.appendChild(listWrap);
    panel.appendChild(actions);
    root.appendChild(panel);
    document.body.appendChild(root);
    this.root = root;

    // Currency updates
    this.currency.onChange(() => {
      if (this.scrapSpan) this.scrapSpan.textContent = String(this.currency.getBalance());
      if (this.freeSpan) this.freeSpan.textContent = `Free: ${this.currency.getFreeUpgradeTokens()}`;
      this.updateRerollUI();
    });

    // Actions
    reroll.onclick = () => this.handleReroll();
    close.onclick = () => this.exit();

    // Keyboard shortcuts
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.visible) return;
      const k = e.key;
      if (k === 'Enter' || k === 'Escape') { this.exit(); e.preventDefault(); return; }
      if (k === 'r' || k === 'R') { this.handleReroll(); e.preventDefault(); return; }
      const idx = parseInt(k, 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= 8) {
        const child = this.list.children[idx - 1] as HTMLElement | undefined;
        if (child) { child.click(); e.preventDefault(); }
      }
    });
  }

  setTimer(seconds: number) { this.timer.textContent = String(Math.max(0, Math.ceil(seconds))); }

  private isOfferCapped(off: Offer): boolean {
    const isLastStand = ((window as any).__gameInstance?.gameMode) === 'LAST_STAND';
    if (!isLastStand) return false;
    try {
      if (off.kind === 'weapon') {
        const aw: Map<number, number> | undefined = (window as any).__gameInstance?.player?.activeWeapons || (window as any).game?.player?.activeWeapons;
        const size = aw ? (aw as any).size : 0;
        const has = aw ? (aw as any).has(off.data?.weaponType) : false;
        return (!has && size >= 3);
      } else if (off.kind === 'passive') {
        const ap: Array<{ type: string, level: number }> | undefined = (window as any).__gameInstance?.player?.activePassives || (window as any).game?.player?.activePassives;
        const count = Array.isArray(ap) ? ap.length : 0;
        const already = Array.isArray(ap) ? !!ap.find(p => p.type === off.data?.passiveName) : false;
        return (!already && count >= 3);
      }
    } catch { /* ignore */ }
    return false;
  }

  private renderOffers() {
    this.list.innerHTML = '';
    // Discover player's default weapon to badge class items
    let playerDefault: WeaponType | undefined;
    try { playerDefault = ((window as any).__gameInstance || (window as any).game || {}).selectedCharacterData?.defaultWeapon; } catch {}

    for (let i = 0; i < this.offers.length; i++) {
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
        subtitle = spec?.traits?.slice(0, 3).join(' • ') || spec?.description || 'Weapon';
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
        displayName = displayName.replace(/^perk[_-]/, '').toUpperCase();
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

      // Card container (clicking anywhere will attempt purchase)
      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.index = String(i + 1);
      Object.assign(card.style, {
        border: `1px solid rgba(120,255,235,0.25)`, borderRadius: '12px', padding: '14px',
        background: 'linear-gradient(180deg, rgba(2,22,26,0.96), rgba(0,10,12,0.94))', color: '#cffffa', textAlign: 'left', cursor: 'pointer',
        display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: '10px', alignItems: 'stretch', boxSizing: 'border-box',
        transition: 'transform 80ms ease-out, box-shadow 120ms ease-out', position: 'relative', overflow: 'hidden',
        minHeight: '164px'
      } as CSSStyleDeclaration);
      card.onmouseenter = () => { card.style.boxShadow = '0 0 24px rgba(0,255,220,0.18)'; card.style.transform = 'translateY(-1px)'; };
      card.onmouseleave = () => { card.style.boxShadow = 'none'; card.style.transform = 'none'; };

      // HEADER: icon | (meta + title) | price pill
      const header = document.createElement('div');
      Object.assign(header.style, { display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: '12px', alignItems: 'center' } as CSSStyleDeclaration);
      const icon = document.createElement('div');
      Object.assign(icon.style, { width: '64px', height: '64px', borderRadius: '10px', background: 'rgba(0,255,220,0.06)', display: 'grid', placeItems: 'center', fontSize: '22px', color: '#7dffea', overflow: 'hidden', border: `1px solid rgba(120,255,235,0.15)` } as CSSStyleDeclaration);
      if (iconUrl) {
        const img = document.createElement('img'); img.src = iconUrl; img.alt = displayName; Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'contain' } as CSSStyleDeclaration);
        icon.appendChild(img);
      } else {
        icon.textContent = kind === 'passive' ? '▲' : kind === 'turret' ? '⛭' : '⨳';
      }

      const headText = document.createElement('div');
      Object.assign(headText.style, { display: 'grid', gridTemplateRows: '18px auto', alignContent: 'center' } as CSSStyleDeclaration);
      // badges line
      const meta = document.createElement('div');
      Object.assign(meta.style, { display: 'flex', alignItems: 'center', gap: '6px' } as CSSStyleDeclaration);
      const typeBadge = document.createElement('span');
      typeBadge.textContent = kind.toUpperCase();
      Object.assign(typeBadge.style, { fontSize: '10px', padding: '2px 6px', borderRadius: '6px', background: 'rgba(120,255,235,0.08)', color: accent, border: '1px solid rgba(120,255,235,0.25)' } as CSSStyleDeclaration);
      meta.appendChild(typeBadge);
      if (kind === 'weapon' && playerDefault != null && off.data?.weaponType === playerDefault) {
        const classBadge = document.createElement('span'); classBadge.textContent = 'CLASS'; Object.assign(classBadge.style, { fontSize: '10px', padding: '2px 6px', borderRadius: '6px', background: '#2dbd8b', color: '#012', border: '1px solid rgba(0,0,0,0.25)' } as CSSStyleDeclaration);
        meta.appendChild(classBadge);
      }
      const title = document.createElement('div');
      title.textContent = displayName;
      Object.assign(title.style, { color: accent, fontSize: '17px', letterSpacing: '0.2px', lineHeight: '18px', maxHeight: '36px', overflow: 'hidden' } as CSSStyleDeclaration);
      try { (title.style as any).display = '-webkit-box'; (title.style as any).webkitLineClamp = '2'; (title.style as any).webkitBoxOrient = 'vertical'; } catch { }
      headText.appendChild(meta); headText.appendChild(title);
      const pricePill = document.createElement('div');
      Object.assign(pricePill.style, { fontSize: '14px', color: '#fff', padding: '6px 10px', borderRadius: '999px', border: '1px solid rgba(120,255,235,0.25)', background: 'rgba(120,255,235,0.10)', whiteSpace: 'nowrap' } as CSSStyleDeclaration);
      const hasFree = this.currency.hasFreeUpgrade();
      const showFree = hasFree && !alreadyBought;
      pricePill.textContent = showFree ? 'FREE' : `${off.price} Scrap`;
      if (showFree) { pricePill.style.background = 'rgba(255,210,120,0.12)'; pricePill.style.borderColor = 'rgba(255,210,120,0.45)'; pricePill.style.color = '#fff4ce'; }
      header.appendChild(icon); header.appendChild(headText); header.appendChild(pricePill);

      // CONTENT: trait chips + description (3-line clamp)
      const content = document.createElement('div');
      Object.assign(content.style, { display: 'grid', gridTemplateRows: 'auto auto', rowGap: '6px' } as CSSStyleDeclaration);
      const chips = document.createElement('div');
      Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' } as CSSStyleDeclaration);
      if (kind === 'weapon') {
        try {
          const wt = off.data?.weaponType as WeaponType | undefined;
          const spec = (wt != null) ? WEAPON_SPECS[wt] : undefined;
          const traits: string[] = Array.isArray(spec?.traits) ? spec!.traits.slice(0, 4) : [];
          for (let j = 0; j < traits.length; j++) {
            const chip = document.createElement('span');
            chip.textContent = traits[j];
            // Use inline-flex + fixed height to ensure perfect vertical centering inside the pill
            Object.assign(
              chip.style,
              {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                height: '22px',
                lineHeight: '22px',
                padding: '0 8px',
                fontSize: '11px',
                borderRadius: '999px',
                background: 'rgba(120,255,235,0.08)',
                color: '#aef7ee',
                border: '1px solid rgba(120,255,235,0.25)'
              } as CSSStyleDeclaration
            );
            chips.appendChild(chip);
          }
        } catch { }
      }
      const desc = document.createElement('div');
      desc.textContent = subtitle || this.describe(off);
      Object.assign(desc.style, { fontSize: '13px', opacity: '0.95', lineHeight: '18px', maxHeight: '54px', overflow: 'hidden' } as CSSStyleDeclaration);
      try { (desc.style as any).webkitLineClamp = '3'; (desc.style as any).display = '-webkit-box'; (desc.style as any).webkitBoxOrient = 'vertical'; } catch { }
      if (chips.childElementCount > 0) content.appendChild(chips);
      content.appendChild(desc);

      // ACTIONS: full-width Buy + hint below
      const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'grid', gridTemplateRows: 'auto auto', gap: '6px' } as CSSStyleDeclaration);
      const buyBtn = document.createElement('div');
  Object.assign(buyBtn.style, { fontSize: '13px', color: '#012', background: accent, padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(0,0,0,0.2)', textAlign: 'center', width: '100%', transition: 'box-shadow 140ms ease, filter 140ms ease, transform 80ms ease', cursor: 'pointer', boxSizing: 'border-box', maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } as CSSStyleDeclaration);
      const hint = document.createElement('div'); hint.textContent = `[#${i + 1} or click]`; Object.assign(hint.style, { fontSize: '11px', opacity: '0.65', textAlign: 'right' } as CSSStyleDeclaration);

      const capped = this.isOfferCapped(off);
      const canAffordPrice = this.currency.getBalance() >= off.price;
      const hasFreeNow = this.currency.hasFreeUpgrade();
      const showFreeNow = hasFreeNow && !alreadyBought;
      const canBuy = ((canAffordPrice || hasFreeNow) && !capped && !alreadyBought);

      const btnLabel = alreadyBought ? 'Purchased' : (capped ? 'Slot Full' : (showFreeNow ? `Claim Free  [${i + 1}]` : `Buy  [${i + 1}]`));
      buyBtn.textContent = btnLabel;

      if (!canBuy) {
        buyBtn.style.background = 'linear-gradient(180deg, #233438, #1b2a2e)';
        buyBtn.style.color = '#9bb';
        buyBtn.style.cursor = 'default';
        buyBtn.style.filter = 'grayscale(0.3)';
      } else {
        buyBtn.onmouseenter = () => { buyBtn.style.boxShadow = '0 0 18px rgba(120,255,235,0.45), 0 0 6px rgba(120,255,235,0.35)'; buyBtn.style.transform = 'translateY(-1px)'; };
        buyBtn.onmouseleave = () => { buyBtn.style.boxShadow = 'none'; buyBtn.style.transform = 'none'; };
      }

      const attemptPurchase = () => {
        if (!canBuy) return;
        const useFree = this.currency.hasFreeUpgrade() && this.currency.getBalance() < off.price;
        this.onPurchase(off, useFree);
        this.purchasedIds.add(off.id);
        this.refreshOffers(false);
      };

      buyBtn.onclick = (ev) => { ev.stopPropagation(); attemptPurchase(); };
      card.onclick = () => { attemptPurchase(); };

      actions.appendChild(buyBtn);
      actions.appendChild(hint);
      card.appendChild(header);
      card.appendChild(content);
      card.appendChild(actions);

      this.list.appendChild(card);
    }
  }

  private refreshOffers(newRoll = true) {
    if (newRoll) { this.offers = this.shop.rollOffers(8); this.purchasedIds.clear(); }
    this.renderOffers();
    this.updateRerollUI();
  }

  show() { this.visible = true; this.root.style.display = 'flex'; this.purchasedIds.clear(); this.refreshOffers(); }
  hide() { this.visible = false; this.root.style.display = 'none'; }
  isVisible() { return this.visible; }
  exit() { this.hide(); this.onExit(); }

  private handleReroll() {
    const price = this.currentRerollPrice();
    if (this.currency.getBalance() >= price && this.currency.spend(price)) {
      this.rerollCount++;
      this.refreshOffers(true);
    }
  }

  private currentRerollPrice() { return this.rerollBase + Math.floor(this.rerollCount * 10); }
  private updateRerollUI() {
    const price = this.currentRerollPrice();
    this.rerollBtn.textContent = `Reroll (${price})  [R]`;
    const canAfford = this.currency.getBalance() >= price;
    this.rerollBtn.disabled = !canAfford;
    this.rerollBtn.style.opacity = canAfford ? '1' : '0.75';
    this.rerollBtn.style.filter = canAfford ? 'none' : 'grayscale(0.4)';
    if (this.scrapSpan) this.scrapSpan.textContent = String(this.currency.getBalance());
    if (this.freeSpan) this.freeSpan.textContent = `Free: ${this.currency.getFreeUpgradeTokens()}`;
  }

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

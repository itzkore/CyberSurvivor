import { CurrencySystem } from '../game/modes/currency-system';
import { ShopManager } from '../game/modes/shop-manager';

type Offer = ReturnType<ShopManager['rollOffers']>[number];

export class LastStandShopOverlay {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  private closeBtn: HTMLButtonElement;
  private rerollBtn: HTMLButtonElement;
  private timer: HTMLSpanElement;
  private visible = false;
  private offers: Offer[] = [];

  constructor(private shop: ShopManager, private currency: CurrencySystem, private onPurchase:(offer:Offer)=>void, private onExit:()=>void) {
    const root = document.createElement('div');
    root.className = 'ls-shop-overlay';
    Object.assign(root.style, {
      position:'fixed', inset:'0', display:'none', zIndex:'60',
      background:'radial-gradient(circle at 50% 40%, rgba(0,10,14,0.92), rgba(0,0,0,0.92))',
      color:'#eaffff', font:'600 14px Orbitron, monospace',
      alignItems:'center', justifyContent:'center'
    } as CSSStyleDeclaration);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      minWidth:'540px', maxWidth:'800px', border:'1px solid #0aa', padding:'14px', borderRadius:'10px',
      background:'rgba(0,18,24,0.9)', boxShadow:'0 0 24px #0aa4'
    } as CSSStyleDeclaration);
    const header = document.createElement('div');
    header.textContent = 'Last Stand – Shop';
    Object.assign(header.style, { fontSize:'20px', marginBottom:'8px', color:'#7dffea' } as CSSStyleDeclaration);
    const sub = document.createElement('div');
    sub.innerHTML = `Scrap: <span id="ls-shop-scrap">${this.currency.getBalance()}</span> · Auto-close in <span id="ls-shop-timer">30</span>s`;
    Object.assign(sub.style, { fontSize:'12px', opacity:'0.9', marginBottom:'8px' } as CSSStyleDeclaration);
    this.timer = sub.querySelector('#ls-shop-timer') as HTMLSpanElement;
    const list = document.createElement('div'); this.list = list;
    Object.assign(list.style, { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' } as CSSStyleDeclaration);
    const actions = document.createElement('div');
    Object.assign(actions.style, { marginTop:'12px', display:'flex', gap:'8px', justifyContent:'flex-end' } as CSSStyleDeclaration);
    const reroll = document.createElement('button'); this.rerollBtn = reroll;
    reroll.textContent = 'Reroll (20)';
    const close = document.createElement('button'); this.closeBtn = close; close.textContent = 'Leave Shop';
    actions.appendChild(reroll); actions.appendChild(close);
    panel.appendChild(header); panel.appendChild(sub); panel.appendChild(list); panel.appendChild(actions);
    root.appendChild(panel);
    document.body.appendChild(root);
    this.root = root;

    this.currency.onChange(v => {
      const s = panel.querySelector('#ls-shop-scrap'); if (s) s.textContent = String(v);
    });
    reroll.onclick = () => { if (this.currency.spend(20)) this.refreshOffers(); };
    close.onclick = () => this.exit();
  }

  setTimer(seconds:number){ this.timer.textContent = String(Math.max(0, Math.ceil(seconds))); }

  private renderOffers(){
    this.list.innerHTML = '';
    for (const off of this.offers) {
      const card = document.createElement('div');
      Object.assign(card.style, { border:'1px solid #0aa', borderRadius:'8px', padding:'10px', background:'rgba(0,10,14,0.6)' } as CSSStyleDeclaration);
      const title = document.createElement('div'); title.textContent = off.id; Object.assign(title.style, { color:'#7dffea', marginBottom:'4px' } as CSSStyleDeclaration);
      const price = document.createElement('div'); price.textContent = `Cost: ${off.price}`; Object.assign(price.style, { fontSize:'12px', opacity:'0.9', marginBottom:'6px' } as CSSStyleDeclaration);
      const buy = document.createElement('button'); buy.textContent = 'Purchase';
      buy.onclick = () => {
        this.onPurchase(off);
        // Update list after purchase (allow multiple buys in one shop)
        this.refreshOffers(false);
      };
      card.appendChild(title); card.appendChild(price); card.appendChild(buy);
      this.list.appendChild(card);
    }
  }

  private refreshOffers(newRoll = true){
    if (newRoll) this.offers = this.shop.rollOffers(4);
    this.renderOffers();
  }

  show(){ this.visible = true; this.root.style.display = 'flex'; this.refreshOffers(); }
  hide(){ this.visible = false; this.root.style.display = 'none'; }
  isVisible(){ return this.visible; }
  exit(){ this.hide(); this.onExit(); }
}

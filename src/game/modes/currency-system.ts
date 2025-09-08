export class CurrencySystem {
  private scrap = 0;
  // Number of free upgrade tokens (each grants one free shop purchase)
  private freeUpgradeTokens = 0;
  private listeners: Array<(amount: number) => void> = [];

  add(amount: number) {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.scrap = Math.max(0, this.scrap + Math.round(amount));
    this.emit();
  }

  spend(amount: number): boolean {
    const a = Math.max(0, Math.round(amount));
    if (this.scrap < a) return false;
    this.scrap -= a;
    this.emit();
    return true;
  }

  getBalance() { return this.scrap; }

  // Free upgrade token API
  addFreeUpgradeTokens(count: number = 1) {
    const n = Math.max(0, Math.floor(count));
    if (n <= 0) return;
    this.freeUpgradeTokens += n;
    this.emit();
  }

  getFreeUpgradeTokens(): number { return this.freeUpgradeTokens; }

  hasFreeUpgrade(): boolean { return this.freeUpgradeTokens > 0; }

  /** Consume one free-upgrade token if available. Returns true if consumed. */
  consumeFreeUpgrade(): boolean {
    if (this.freeUpgradeTokens <= 0) return false;
    this.freeUpgradeTokens -= 1;
    this.emit();
    return true;
  }

  onChange(cb: (amount: number) => void) {
    this.listeners.push(cb);
    cb(this.scrap);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(){ for (const l of this.listeners) try { l(this.scrap); } catch {} }
}

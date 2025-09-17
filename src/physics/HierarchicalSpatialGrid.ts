/**
 * Two-level hierarchical spatial grid for ultra-fast collision detection.
 * Combines coarse and fine grids for O(1) insertion and minimal allocation queries.
 */
export class HierarchicalSpatialGrid {
  private coarseGrid: Map<number, Set<any>> = new Map();
  private fineGrid: Map<number, Set<any>> = new Map();
  private coarseCellSize = 400; // Large cells for broad phase
  private fineCellSize = 100;   // Small cells for narrow phase
  
  // Preallocated query result buffers to avoid allocations
  private queryBuffer: any[] = [];
  private tempResults: any[] = [];
  
  /**
   * Insert or update entity in both grid levels.
   */
  public insertOrUpdate(entity: any): void {
    this.removeFromGrids(entity); // Clean up old position
    this.insert(entity);
  }
  
  /**
   * Insert entity into hierarchical grid system.
   */
  public insert(entity: any): void {
    // Coarse grid insertion - always insert for broad queries
    const coarseKey = this.getCoarseKey(entity.x, entity.y);
    if (!this.coarseGrid.has(coarseKey)) {
      this.coarseGrid.set(coarseKey, new Set());
    }
    this.coarseGrid.get(coarseKey)!.add(entity);
    
    // Fine grid insertion only for entities in potentially active regions
    // Use a larger threshold to capture entities entering critical zones
    const isNearCritical = this.isNearCriticalZone(entity);
    if (isNearCritical) {
      const fineKey = this.getFineKey(entity.x, entity.y);
      if (!this.fineGrid.has(fineKey)) {
        this.fineGrid.set(fineKey, new Set());
      }
      this.fineGrid.get(fineKey)!.add(entity);
    }
    
    // Cache grid position on entity for efficient removal
    (entity as any)._gridCoarseKey = coarseKey;
    (entity as any)._gridFineKey = isNearCritical ? this.getFineKey(entity.x, entity.y) : null;
  }
  
  /**
   * Remove entity from all grids.
   */
  public remove(entity: any): void {
    this.removeFromGrids(entity);
  }
  
  /**
   * Query entities within radius using hierarchical approach.
   * Returns preallocated buffer to avoid allocations.
   */
  public query(x: number, y: number, radius: number): any[] {
    this.queryBuffer.length = 0; // Clear previous results
    
    // Determine which grid level to use based on query size
    const useCoarse = radius > this.fineCellSize * 1.5;
    
    if (useCoarse) {
      this.queryCoarse(x, y, radius);
    } else {
      this.queryFine(x, y, radius);
    }
    
    return this.queryBuffer;
  }
  
  /**
   * Clear query cache - called once per frame.
   */
  public clearCache(): void {
    // Grid maintains its structure, just clear result buffers
    this.queryBuffer.length = 0;
    this.tempResults.length = 0;
  }
  
  /**
   * Get total entity count across all grids (debug info).
   */
  public getEntityCount(): number {
    let count = 0;
    for (const set of this.coarseGrid.values()) {
      count += set.size;
    }
    return count;
  }
  
  // Private methods
  
  private getCoarseKey(x: number, y: number): number {
    const cx = Math.floor(x / this.coarseCellSize);
    const cy = Math.floor(y / this.coarseCellSize);
    return (cx << 16) | (cy & 0xFFFF);
  }
  
  private getFineKey(x: number, y: number): number {
    const cx = Math.floor(x / this.fineCellSize);
    const cy = Math.floor(y / this.fineCellSize);
    return (cx << 16) | (cy & 0xFFFF);
  }
  
  private isNearCriticalZone(entity: any): boolean {
    // Simple heuristic: entities within 600px of player position get fine grid treatment
    try {
      const player = (window as any).__gameInstance?.player;
      if (!player) return false;
      
      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      const distSq = dx * dx + dy * dy;
      return distSq < 360000; // 600px squared
    } catch {
      return false;
    }
  }
  
  private removeFromGrids(entity: any): void {
    const coarseKey = (entity as any)._gridCoarseKey;
    const fineKey = (entity as any)._gridFineKey;
    
    if (coarseKey !== undefined) {
      const coarseSet = this.coarseGrid.get(coarseKey);
      if (coarseSet) {
        coarseSet.delete(entity);
        if (coarseSet.size === 0) {
          this.coarseGrid.delete(coarseKey);
        }
      }
    }
    
    if (fineKey !== null && fineKey !== undefined) {
      const fineSet = this.fineGrid.get(fineKey);
      if (fineSet) {
        fineSet.delete(entity);
        if (fineSet.size === 0) {
          this.fineGrid.delete(fineKey);
        }
      }
    }
    
    delete (entity as any)._gridCoarseKey;
    delete (entity as any)._gridFineKey;
  }
  
  private queryCoarse(x: number, y: number, radius: number): void {
    const radiusSq = radius * radius;
    const cellSpan = Math.ceil(radius / this.coarseCellSize) + 1;
    
    const centerCx = Math.floor(x / this.coarseCellSize);
    const centerCy = Math.floor(y / this.coarseCellSize);
    
    for (let dcx = -cellSpan; dcx <= cellSpan; dcx++) {
      for (let dcy = -cellSpan; dcy <= cellSpan; dcy++) {
        const key = ((centerCx + dcx) << 16) | ((centerCy + dcy) & 0xFFFF);
        const set = this.coarseGrid.get(key);
        
        if (set) {
          for (const entity of set) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            if (dx * dx + dy * dy <= radiusSq) {
              this.queryBuffer.push(entity);
            }
          }
        }
      }
    }
  }
  
  private queryFine(x: number, y: number, radius: number): void {
    const radiusSq = radius * radius;
    const cellSpan = Math.ceil(radius / this.fineCellSize) + 1;
    
    const centerCx = Math.floor(x / this.fineCellSize);
    const centerCy = Math.floor(y / this.fineCellSize);
    
    // Try fine grid first for high precision
    let foundInFine = false;
    
    for (let dcx = -cellSpan; dcx <= cellSpan; dcx++) {
      for (let dcy = -cellSpan; dcy <= cellSpan; dcy++) {
        const key = ((centerCx + dcx) << 16) | ((centerCy + dcy) & 0xFFFF);
        const set = this.fineGrid.get(key);
        
        if (set) {
          foundInFine = true;
          for (const entity of set) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            if (dx * dx + dy * dy <= radiusSq) {
              this.queryBuffer.push(entity);
            }
          }
        }
      }
    }
    
    // Fallback to coarse grid if fine grid is sparse in this area
    if (!foundInFine) {
      this.queryCoarse(x, y, radius);
    }
  }
}
/**
 * Spatial hash grid (cache-friendly). Uses nested Map<X> -> Map<Y> to avoid string concat per query.
 * Keep cell size roughly >= max entity diameter for best performance.
 * Optimized for incremental updates with position tracking.
 */
export class SpatialGrid<T extends { x: number; y: number; radius: number; _cellX?: number; _cellY?: number }> {
    private cellSize: number;
    private grid: Map<number, Map<number, T[]>> = new Map();
    private queryScratch: T[] = []; // reused array to reduce GC (caller should copy if retaining)
    private queryCache: Map<string, T[]> = new Map(); // Cache common query patterns
    private frameCounter = 0;

    constructor(cellSize: number) { this.cellSize = cellSize; }

    private toCell(v: number) { return (v / this.cellSize) | 0; }

    /**
     * Optimized insert with position caching for incremental updates.
     * Only moves entity if its cell position changed.
     */
    public insertOrUpdate(entity: T): void {
        const cx = this.toCell(entity.x);
        const cy = this.toCell(entity.y);
        
        // If entity is already in the correct cell, skip work
        if (entity._cellX === cx && entity._cellY === cy) return;
        
        // Remove from old position if exists
        if (entity._cellX !== undefined && entity._cellY !== undefined) {
            this.removeFromCell(entity, entity._cellX, entity._cellY);
        }
        
        // Insert into new position
        this.insertToCell(entity, cx, cy);
        entity._cellX = cx;
        entity._cellY = cy;
    }

    public insert(entity: T): void {
        const cx = this.toCell(entity.x);
        const cy = this.toCell(entity.y);
        this.insertToCell(entity, cx, cy);
        entity._cellX = cx;
        entity._cellY = cy;
    }

    private insertToCell(entity: T, cx: number, cy: number): void {
        let col = this.grid.get(cx);
        if (!col) { col = new Map(); this.grid.set(cx, col); }
        let bucket = col.get(cy);
        if (!bucket) { bucket = []; col.set(cy, bucket); }
        bucket.push(entity);
    }

    /**
     * Remove entity from spatial grid. Must call when entity becomes inactive.
     */
    public remove(entity: T): void {
        if (entity._cellX !== undefined && entity._cellY !== undefined) {
            this.removeFromCell(entity, entity._cellX, entity._cellY);
            entity._cellX = undefined;
            entity._cellY = undefined;
        }
    }

    private removeFromCell(entity: T, cx: number, cy: number): void {
        const col = this.grid.get(cx);
        if (!col) return;
        const bucket = col.get(cy);
        if (!bucket) return;
        
        const idx = bucket.indexOf(entity);
        if (idx !== -1) {
            // Fast removal by swapping with last element
            bucket[idx] = bucket[bucket.length - 1];
            bucket.pop();
            
            // Clean up empty buckets to prevent memory bloat
            if (bucket.length === 0) {
                col.delete(cy);
                if (col.size === 0) {
                    this.grid.delete(cx);
                }
            }
        }
    }

    /** Query potentially overlapping entities (broad phase). Returned array is reused; do not store. */
    public query(x: number, y: number, radius: number): T[] {
        const startX = this.toCell(x - radius);
        const startY = this.toCell(y - radius);
        const endX = this.toCell(x + radius);
        const endY = this.toCell(y + radius);
        const out = this.queryScratch;
        out.length = 0;
        for (let cx = startX; cx <= endX; cx++) {
            const col = this.grid.get(cx); if (!col) continue;
            for (let cy = startY; cy <= endY; cy++) {
                const bucket = col.get(cy); if (!bucket) continue;
                // Inline push loop faster than spread
                for (let i=0;i<bucket.length;i++) out.push(bucket[i]);
            }
        }
        return out;
    }

    /**
     * High-performance query for common patterns. Checks for cached results first.
     * Use for player vicinity queries that happen frequently with same parameters.
     */
    public queryWithCache(x: number, y: number, radius: number, cacheKey?: string): T[] {
        if (cacheKey) {
            // Simple caching for player position queries that happen multiple times per frame
            const cached = this.queryCache.get(cacheKey);
            if (cached) return cached;
        }
        
        const result = this.query(x, y, radius);
        
        if (cacheKey) {
            // Store copy of result for caching
            const copy = [...result];
            this.queryCache.set(cacheKey, copy);
            return copy;
        }
        
        return result;
    }

    /**
     * Clear query cache. Call once per frame to reset cache for next frame.
     */
    public clearCache(): void {
        this.queryCache.clear();
        this.frameCounter++;
    }

    public clear(): void { 
        this.grid.clear(); 
        this.queryCache.clear();
    }
}
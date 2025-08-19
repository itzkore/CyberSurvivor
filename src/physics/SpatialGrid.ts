/**
 * Spatial hash grid (cache-friendly). Uses nested Map<X> -> Map<Y> to avoid string concat per query.
 * Keep cell size roughly >= max entity diameter for best performance.
 */
export class SpatialGrid<T extends { x: number; y: number; radius: number }> {
    private cellSize: number;
    private grid: Map<number, Map<number, T[]>> = new Map();
    private queryScratch: T[] = []; // reused array to reduce GC (caller should copy if retaining)

    constructor(cellSize: number) { this.cellSize = cellSize; }

    private toCell(v: number) { return (v / this.cellSize) | 0; }

    public insert(entity: T): void {
        const cx = this.toCell(entity.x);
        const cy = this.toCell(entity.y);
        let col = this.grid.get(cx);
        if (!col) { col = new Map(); this.grid.set(cx, col); }
        let bucket = col.get(cy);
        if (!bucket) { bucket = []; col.set(cy, bucket); }
        bucket.push(entity);
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

    public clear(): void { this.grid.clear(); }
}
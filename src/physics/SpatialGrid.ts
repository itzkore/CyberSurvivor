export class SpatialGrid<T extends { x: number; y: number; radius: number }> {
    private cellSize: number;
    private grid: Map<string, T[]> = new Map();

    constructor(cellSize: number) {
        this.cellSize = cellSize;
    }

    private getCellKey(x: number, y: number): string {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        return `${cellX},${cellY}`;
    }

    public insert(entity: T): void {
        const key = this.getCellKey(entity.x, entity.y);
        if (!this.grid.has(key)) {
            this.grid.set(key, []);
        }
        this.grid.get(key)!.push(entity);
    }

    public query(x: number, y: number, radius: number): T[] {
        const entities: T[] = [];
        const startX = Math.floor((x - radius) / this.cellSize);
        const startY = Math.floor((y - radius) / this.cellSize);
        const endX = Math.floor((x + radius) / this.cellSize);
        const endY = Math.floor((y + radius) / this.cellSize);

        for (let cellX = startX; cellX <= endX; cellX++) {
            for (let cellY = startY; cellY <= endY; cellY++) {
                const key = `${cellX},${cellY}`;
                if (this.grid.has(key)) {
                    entities.push(...this.grid.get(key)!);
                }
            }
        }
        return entities;
    }

    public clear(): void {
        this.grid.clear();
    }
}
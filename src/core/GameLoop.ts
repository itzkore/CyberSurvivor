/**
 * Represents the main game loop, handling updates and rendering with a fixed timestep.
 * This ensures consistent game logic regardless of varying frame rates.
 */
export class GameLoop {
    private lastTime: number = 0;
    private accumulatedTime: number = 0;
    private readonly fixedUpdateInterval: number = 1000 / 60; // 60 updates per second (restored original speed)

    private update: (deltaTime: number) => void;
    private render: (deltaTime: number) => void;
    private animationFrameId: number | null = null;

    /**
     * Creates an instance of GameLoop.
     * @param updateCallback The function to call for game logic updates.
     * @param renderCallback The function to call for rendering.
     */
    constructor(updateCallback: (deltaTime: number) => void, renderCallback: (deltaTime: number) => void) {
        this.update = updateCallback;
        this.render = renderCallback;
    }

    /**
     * Starts the game loop.
     */
    public start(): void {
        this.animationFrameId = requestAnimationFrame(this.loop.bind(this));
    }

    /**
     * Stops the game loop.
     */
    public stop(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * The core loop function, called by requestAnimationFrame.
     * @param currentTime The current time provided by requestAnimationFrame.
     */
    private loop(currentTime: number): void {
        if (!this.lastTime) {
            this.lastTime = currentTime;
        }

        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        this.accumulatedTime += deltaTime;

        // Fixed timestep updates
        while (this.accumulatedTime >= this.fixedUpdateInterval) {
            this.update(this.fixedUpdateInterval);
            this.accumulatedTime -= this.fixedUpdateInterval;
        }

        // Render with interpolation (optional, but good for smooth visuals)
        // The 'alpha' value represents how far we are into the next fixed update interval.
        const alpha = this.accumulatedTime / this.fixedUpdateInterval;
        this.render(alpha);

        this.animationFrameId = requestAnimationFrame(this.loop.bind(this));
    }
}

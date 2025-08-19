/**
 * Represents the main game loop, handling updates and rendering with a fixed timestep.
 * This ensures consistent game logic regardless of varying frame rates.
 */
export class GameLoop {
    private lastTime = 0;
    private accumulatedTime = 0;
    /** Fixed update interval in ms (logic tick). */
    private readonly fixedUpdateInterval: number;
    /** Update callback receives fixed delta (ms). */
    private update: (deltaMs: number) => void;
    /** Render callback receives interpolation alpha (0..1) OR raw delta (variable mode). */
    private render: (alphaOrDelta: number) => void;
    private animationFrameId: number | null = null;
    private frameHook?: (rawDeltaMs: number) => void; // Optional per-frame listener (for FPS overlay etc.)
    private renderHook?: () => void; // Optional hook after in-thread render for experimental worker snapshots
    private useVariableTimestep = false; // Experimental unlocked update mode (updates == renders)
    private maxCatchUpFrames = 5; // spiral-of-death guard
    private loopBound: (ts: number) => void; // cached bound function to avoid per-frame bind alloc
    private minDeltaClamp = 0.5; // clamp extremely tiny deltas (browser RAF jitter) to stabilize EMA
    private maxDeltaClamp = 1000; // clamp huge tab-switch spikes

    /**
     * Creates an instance of GameLoop.
     * @param updateCallback The function to call for game logic updates.
     * @param renderCallback The function to call for rendering.
     * @param opts Optional config (fixedHz, variableTimestep)
     */
    constructor(updateCallback: (deltaTime: number) => void, renderCallback: (deltaTime: number) => void, opts?: { fixedHz?: number; variableTimestep?: boolean; }) {
        this.update = updateCallback;
        this.render = renderCallback;
        const hz = opts?.fixedHz && opts.fixedHz > 0 ? opts.fixedHz : 60;
        this.fixedUpdateInterval = 1000 / hz;
        this.useVariableTimestep = !!opts?.variableTimestep;
        this.loopBound = this.loop.bind(this);
    }

    /**
     * Starts the game loop.
     */
    public start(): void {
        if (this.animationFrameId !== null) {
            (window as any).__loopDebug = { msg: 'start() ignored; already running', id: this.animationFrameId, t: performance.now() };
            return; // already running
        }
        this.animationFrameId = requestAnimationFrame(this.loopBound);
        (window as any).__loopDebug = { msg: 'loop started', id: this.animationFrameId, t: performance.now() };
    }

    /**
     * Stops the game loop.
     */
    public stop(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            (window as any).__loopDebug = { msg: 'loop stopped', t: performance.now() };
            this.animationFrameId = null;
        }
    }

    /**
     * Reset internal timers so that after a manual pause or tab switch we don't process a huge delta.
     */
    public resetTiming(): void {
        this.lastTime = 0;
        this.accumulatedTime = 0;
    }

    /**
     * Registers a lightweight callback invoked once per RAF after logic & (potential) render.
     * Keep the body extremely small to avoid introducing jank.
     */
    public setFrameHook(cb: (rawDeltaMs: number) => void) {
        this.frameHook = cb;
    }

    /**
     * Registers a hook invoked right after the in-thread render() call.
     * Used to capture a lightweight snapshot for an OffscreenCanvas worker without polluting main render path.
     */
    public setRenderHook(cb: () => void) {
        this.renderHook = cb;
    }

    /** Dynamically toggle variable timestep mode at runtime. */
    public setVariableTimestep(enabled: boolean) {
        this.useVariableTimestep = enabled;
    }

    /**
     * The core loop function, called by requestAnimationFrame.
     * @param currentTime The current time provided by requestAnimationFrame.
     */
    private loop(currentTime: number): void {
        if (this.lastTime === 0) this.lastTime = currentTime;
        let deltaMs = currentTime - this.lastTime;
        this.lastTime = currentTime;
        if (deltaMs < this.minDeltaClamp) deltaMs = this.minDeltaClamp; // dampen min jitter
        if (deltaMs > this.maxDeltaClamp) deltaMs = this.fixedUpdateInterval; // huge spike -> treat as single tick

        if (this.useVariableTimestep) {
            // Single update using raw delta (unlocked). Consumers must scale velocities by deltaMs.
            this.update(deltaMs);
            this.render(deltaMs);
        } else {
            // Fixed timestep path.
            this.accumulatedTime += deltaMs;
            const cap = this.fixedUpdateInterval * this.maxCatchUpFrames;
            if (this.accumulatedTime > cap) this.accumulatedTime = cap; // drop excess backlog
            while (this.accumulatedTime >= this.fixedUpdateInterval) {
                this.update(this.fixedUpdateInterval);
                this.accumulatedTime -= this.fixedUpdateInterval;
            }
            const alpha = this.accumulatedTime / this.fixedUpdateInterval; // interpolation factor
            if (deltaMs < 250) { // skip render only on pathological hitch
                this.render(alpha);
                if (this.renderHook) { try { this.renderHook(); } catch { /* ignore */ } }
            }
        }
        if (this.frameHook) { try { this.frameHook(deltaMs); } catch { /* swallow */ } }
        this.animationFrameId = requestAnimationFrame(this.loopBound);
    }
}

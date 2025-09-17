/**
 * Centralized game constants for better maintainability
 */
export const GameConstants = {
  WORLD: {
    /** Initial world dimensions */
    INITIAL_WIDTH: 40000,
    INITIAL_HEIGHT: 40000,
    /** Expanded world dimensions for Last Stand mode */
    EXPANDED_WIDTH: 400000,
    EXPANDED_HEIGHT: 400000,
    /** Time in seconds for world expansion */
    EXPANSION_TIME: 10,
    /** Basic tile size for calculations */
    TILE_SIZE: 4000,
    /** World scale multiplier */
    SCALE_MULTIPLIER: 10,
  },
  
  CAMERA: {
    /** Camera interpolation factor (0=instant, 1=no movement) */
    LERP_FACTOR: 0.12,
    /** Maximum screen shake intensity */
    SHAKE_MAX_INTENSITY: 10,
  },
  
  RENDERING: {
    /** Minimum render scale for performance */
    MIN_RENDER_SCALE: 0.6,
    /** Maximum pixel budget for auto-scaling */
    MAX_PIXEL_BUDGET: 1300000,
    /** Fog of War tile size in logical pixels */
    FOW_TILE_SIZE: 160,
    /** Background pattern cache size */
    BG_PATTERN_SIZE: 512,
    /** Design resolution */
    DESIGN_WIDTH: 1920,
    DESIGN_HEIGHT: 1080,
  },
  
  PERFORMANCE: {
    /** FPS sampling interval */
    FPS_SAMPLE_INTERVAL: 1000,
    /** Auto-pause delay when tab becomes inactive */
    AUTO_PAUSE_DELAY: 100,
  },
  
  GAME_MODES: {
    DEFAULT: 'LAST_STAND' as const,
    AVAILABLE: ['SHOWDOWN', 'DUNGEON', 'SANDBOX', 'LAST_STAND'] as const,
  },
  
  SPATIAL_GRID: {
    /** Default cell size for spatial partitioning */
    DEFAULT_CELL_SIZE: 200,
  }
} as const;

export type GameMode = typeof GameConstants.GAME_MODES.AVAILABLE[number];
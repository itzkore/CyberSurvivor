/**
 * A lightweight logging utility with support for different log levels and telemetry hooks.
 * In a production build, debug and info logs can be easily disabled.
 */
export class Logger {
    private static logLevel: 'debug' | 'info' | 'warn' | 'error' = 'debug'; // Default log level
    private static telemetryHooks: ((level: string, message: string, ...args: any[]) => void)[] = [];

    /**
     * Sets the minimum log level. Messages below this level will not be displayed.
     * @param level The minimum log level ('debug', 'info', 'warn', 'error').
     */
    public static setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
        Logger.logLevel = level;
    }

    /**
     * Adds a telemetry hook function that will be called for every log message.
     * @param hook The telemetry hook function.
     */
    public static addTelemetryHook(hook: (level: string, message: string, ...args: any[]) => void): void {
        Logger.telemetryHooks.push(hook);
    }

    private static shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
        const levels = {
            'debug': 0,
            'info': 1,
            'warn': 2,
            'error': 3,
        };
        return levels[level] >= levels[Logger.logLevel];
    }

    private static log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
        if (Logger.shouldLog(level)) {
            console[level](`[${level.toUpperCase()}] ${message}`, ...args);
        }
        Logger.telemetryHooks.forEach(hook => hook(level, message, ...args));
    }

    /**
     * Logs a debug message.
     * @param message The message to log.
     * @param args Additional arguments to log.
     */
    public static debug(message: string, ...args: any[]): void {
        Logger.log('debug', message, ...args);
    }

    /**
     * Logs an info message.
     * @param message The message to log.
     * @param args Additional arguments to log.
     */
    public static info(message: string, ...args: any[]): void {
        Logger.log('info', message, ...args);
    }

    /**
     * Logs a warning message.
     * @param message The message to log.
     * @param args Additional arguments to log.
     */
    public static warn(message: string, ...args: any[]): void {
        Logger.log('warn', message, ...args);
    }

    /**
     * Logs an error message.
     * @param message The message to log.
     * @param args Additional arguments to log.
     */
    public static error(message: string, ...args: any[]): void {
        Logger.log('error', message, ...args);
    }
}

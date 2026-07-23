function timestamp(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
    info: (...args: any[]) => console.log(`[${timestamp()}]`, ...args),
    error: (...args: any[]) => console.error(`[${timestamp()}]`, ...args),
    warn: (...args: any[]) => console.warn(`[${timestamp()}]`, ...args),
    debug: (...args: any[]) => {
        if (process.env.DEBUG) console.log(`[${timestamp()}] [DEBUG]`, ...args);
    },
};

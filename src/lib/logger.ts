import fs from 'fs';
import path from 'path';
import util from 'util';

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const MAX_SIZE = Number(process.env.LOG_MAX_SIZE_BYTES) || 10 * 1024 * 1024; // 10MB
const MAX_FILES = Number(process.env.LOG_MAX_FILES) || 5;

try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
    // ignore
}

interface LogTarget {
    name: string;
    patterns: RegExp[];
}

const targets: LogTarget[] = [
    { name: 'feedback', patterns: [/\[feedback\]/i] },
    { name: 'chat', patterns: [/\[chat\]/i] },
    { name: 'files', patterns: [/\[(files|ocr)\]/i] },
    { name: 'owu', patterns: [/\[owu\]/i] },
    { name: 'token', patterns: [/\[token\]/i] },
    { name: 'plans', patterns: [/\[(cycle|purge|resetKB)\]/i] },
    { name: 'auth', patterns: [/\[(auth|signin|admin|timer)\]/i] },
];

function resolveTargets(formatted: string): string[] {
    const matched = targets
        .filter((t) => t.patterns.some((p) => p.test(formatted)))
        .map((t) => t.name);
    if (matched.length > 0) return matched;
    return ['gateway'];
}

class RotatingFileWriter {
    private filePath: string;

    constructor(name: string) {
        this.filePath = path.join(LOG_DIR, `${name}.log`);
    }

    write(line: string) {
        this.rotateIfNeeded();
        fs.appendFileSync(this.filePath, line + '\n');
    }

    private rotateIfNeeded() {
        try {
            const stats = fs.statSync(this.filePath);
            if (stats.size < MAX_SIZE) return;
        } catch {
            return;
        }

        for (let i = MAX_FILES - 1; i >= 1; i--) {
            const src = path.join(LOG_DIR, `${path.basename(this.filePath, '.log')}.log.${i}`);
            const dst = path.join(LOG_DIR, `${path.basename(this.filePath, '.log')}.log.${i + 1}`);
            try {
                fs.renameSync(src, dst);
            } catch {
                // ignore missing files
            }
        }

        try {
            fs.renameSync(
                this.filePath,
                path.join(LOG_DIR, `${path.basename(this.filePath, '.log')}.log.1`),
            );
        } catch {
            // ignore
        }
    }
}

const writers = new Map<string, RotatingFileWriter>();

function getWriter(name: string): RotatingFileWriter {
    if (!writers.has(name)) {
        writers.set(name, new RotatingFileWriter(name));
    }
    return writers.get(name)!;
}

function timestamp(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatLine(level: string, args: any[]): string {
    const prefix = `[${timestamp()}] [${level}]`;
    const body = util.format('', ...args).trim();
    return body.startsWith('[') ? `${prefix} ${body}` : `${prefix} ${body}`;
}

function log(level: string, consoleFn: (...args: any[]) => void, args: any[]) {
    const line = formatLine(level, args);
    consoleFn(line);

    const targetNames = resolveTargets(line);
    for (const name of targetNames) {
        try {
            getWriter(name).write(line);
        } catch (e) {
            console.error('[logger] failed to write to file:', e);
        }
    }
}

export const logger = {
    info: (...args: any[]) => log('INFO', console.log, args),
    error: (...args: any[]) => log('ERROR', console.error, args),
    warn: (...args: any[]) => log('WARN', console.warn, args),
    debug: (...args: any[]) => {
        if (process.env.DEBUG) {
            log('DEBUG', console.log, [`[DEBUG]`, ...args]);
        }
    },
};

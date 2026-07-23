import crypto from 'crypto';
import { config } from '../config';

export function usdToNative(usd: number): number {
    return Math.round(usd * config.quotaPerUnit);
}

export function nativeToUsd(native: number): number {
    return native / config.quotaPerUnit;
}

export function cycleMs(): number {
    return config.planCycleDays * 24 * 60 * 60 * 1000;
}

export function utcNow(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function randomId(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

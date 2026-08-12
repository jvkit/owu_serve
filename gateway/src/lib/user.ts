import crypto from 'crypto';
import { db } from './db';
import { config } from '../config';
import { utcNow } from './utils';

export function generateUserId(): string {
    for (let i = 0; i < 100; i++) {
        const id = 'u_' + crypto.randomBytes(8).toString('hex');
        const exists = db.prepare('SELECT 1 FROM user_storage WHERE user_id = ?').get(id);
        if (!exists) return id;
    }
    throw new Error('Failed to generate unique user_id');
}

export function ensureUserStorage(email: string): void {
    const row = db.prepare('SELECT user_id, storage_quota, storage_used FROM user_storage WHERE user_email = ?').get(email) as any;
    if (!row) {
        const now = utcNow();
        const userId = generateUserId();
        const t1 = config.planTiers[1];
        db.prepare(
            'INSERT OR IGNORE INTO user_storage (user_email, user_id, storage_quota, storage_used, file_count_quota, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)'
        ).run(email, userId, t1.storage_quota, t1.file_count_quota, now, now);
    }
}

export function getUserId(email: string): string {
    const row = db.prepare('SELECT user_id FROM user_storage WHERE user_email = ?').get(email) as any;
    if (!row) {
        ensureUserStorage(email);
        return (db.prepare('SELECT user_id FROM user_storage WHERE user_email = ?').get(email) as any).user_id;
    }
    return row.user_id;
}

export function renewUserStorage(email: string): void {
    ensureUserStorage(email);
    const fstats = db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE user_email = ?').get(email) as any;
    const used = Number(fstats.total) || 0;
    db.prepare('UPDATE user_storage SET storage_used = ?, updated_at = ? WHERE user_email = ?').run(used, utcNow(), email);
}

export function getUserStorage(email: string): { storage_quota: number; storage_used: number } {
    ensureUserStorage(email);
    return db.prepare('SELECT storage_quota, storage_used FROM user_storage WHERE user_email = ?').get(email) as any;
}

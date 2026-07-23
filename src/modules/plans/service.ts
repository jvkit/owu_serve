import fs from 'fs';
import path from 'path';
import { db } from '../../lib/db';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { callNewApi } from '../../lib/newapi';
import { utcNow, randomId, cycleMs } from '../../lib/utils';
import { getUserId, getUserStorage, ensureUserStorage, renewUserStorage } from '../../lib/user';
import { usdToNative } from './utils';
import { syncUserModel } from '../rag/service';
import { owuDeleteCollection, owuSafeDeleteFile, syncCollectionToOWU, owuGetUserByEmail, owuDeleteUser, owuRequest } from '../../lib/owu';

const cycleLocks = new Map<string, Promise<void>>();

export function runWithCycleLock(email: string, fn: () => Promise<void>): Promise<void> {
    if (cycleLocks.has(email)) return cycleLocks.get(email)!;
    const p = fn().finally(() => cycleLocks.delete(email));
    cycleLocks.set(email, p);
    return p;
}

export function ensureUserPlan(email: string): void {
    const plan = db.prepare('SELECT user_email FROM user_plans WHERE user_email = ?').get(email) as any;
    if (plan) return;

    const now = utcNow();
    const userId = getUserId(email);
    const expiresAt = new Date(Date.now() + cycleMs()).toISOString().replace('T', ' ').substring(0, 19);
    db.prepare(
        "INSERT OR IGNORE INTO user_plans (user_email, user_id, tier, status, started_at, expires_at, created_at, updated_at) VALUES (?, ?, 1, 'active', ?, ?, ?, ?)"
    ).run(email, userId, now, expiresAt, now, now);

    const t1 = config.planTiers[1];
    db.prepare('UPDATE user_storage SET storage_quota = ?, file_count_quota = ?, updated_at = ? WHERE user_email = ?')
        .run(t1.storage_quota, t1.file_count_quota, now, email);
}

export function checkAndApplyPlanCycle(email: string): void {
    const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
    if (!plan || plan.status !== 'active') return;

    const now = utcNow();
    if (now <= plan.expires_at) return;

    runWithCycleLock(email, () => applyPlanCycle(email)).catch(e => logger.error('[cycle] background cycle failed:', e.message));
}

export async function checkAndApplyPlanCycleSync(email: string): Promise<void> {
    const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
    if (!plan || plan.status !== 'active') return;

    const now = utcNow();
    if (now <= plan.expires_at) return;

    await runWithCycleLock(email, () => applyPlanCycle(email));
}

export async function applyPlanCycle(email: string): Promise<void> {
    const p = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
    if (!p || p.status !== 'active') return;
    if (utcNow() <= p.expires_at) return;

    if (p.next_tier != null) {
        await applyCycleTransition(email, p);
    } else {
        await deactivateUser(email, p);
    }
}

export async function applyCycleTransition(email: string, plan: any): Promise<void> {
    const tierInfo = config.planTiers[plan.next_tier];
    if (!tierInfo) return;

    const tokenRow = db.prepare('SELECT token_id, token_name FROM user_tokens WHERE email = ?').get(email) as any;
    const nextExpiresUnix = Math.floor(new Date(plan.next_expires_at.replace(' ', 'T') + 'Z').getTime() / 1000);

    if (plan.next_tier < plan.tier) {
        const storage = getUserStorage(email);
        const fileCount = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(email) as any;
        if (storage.storage_used > tierInfo.storage_quota || fileCount.count > tierInfo.file_count_quota) {
            await resetUserKB(email);
        }
    }

    if (tokenRow) {
        try {
            const r1 = await callNewApi('PUT', '/api/token/', {
                id: tokenRow.token_id,
                name: tokenRow.token_name,
                remain_quota: usdToNative(tierInfo.chat_quota_usd),
                expired_time: nextExpiresUnix,
            });
            if (r1.status < 200 || r1.status >= 300 || !r1.data?.success) {
                throw new Error(`NewAPI token update failed (${r1.status})`);
            }
            const r2 = await callNewApi('PUT', '/api/token/?status_only=1', { id: tokenRow.token_id, status: 1 });
            if (r2.status < 200 || r2.status >= 300 || !r2.data?.success) {
                throw new Error(`NewAPI token re-enable failed (${r2.status})`);
            }
        } catch (e: any) {
            logger.error('[cycle] Failed to update token on transition:', e.message);
        }
    }

    const now = utcNow();
    db.transaction(() => {
        db.prepare(`
            UPDATE user_plans SET
                tier = next_tier, started_at = ?, expires_at = next_expires_at,
                next_tier = NULL, next_expires_at = NULL,
                extra_quota = 0, updated_at = ?
            WHERE user_email = ?
        `).run(plan.expires_at, now, email);
        db.prepare('UPDATE user_storage SET storage_quota = ?, file_count_quota = ?, updated_at = ? WHERE user_email = ?')
            .run(tierInfo.storage_quota, tierInfo.file_count_quota, now, email);
    })();

    if (tokenRow) {
        db.prepare('UPDATE user_tokens SET remain_quota = ?, updated_at = ? WHERE email = ?')
            .run(usdToNative(tierInfo.chat_quota_usd), now, email);
    }

    logger.info(`[cycle] Transition: ${email} tier ${plan.tier} → ${plan.next_tier}, expires ${plan.next_expires_at}`);
}

export async function deactivateUser(email: string, _plan?: any): Promise<void> {
    const tokenRow = db.prepare('SELECT token_id FROM user_tokens WHERE email = ?').get(email) as any;
    if (tokenRow) {
        try {
            await callNewApi('PUT', '/api/token/?status_only=1', { id: tokenRow.token_id, status: 2 });
        } catch (e: any) {
            logger.error('[cycle] Failed to disable token:', e.message);
        }
    }

    db.prepare("UPDATE user_plans SET status = 'inactive', updated_at = ? WHERE user_email = ?")
        .run(utcNow(), email);

    logger.info(`[cycle] Deactivated: ${email}`);
}

export async function resetUserKB(email: string): Promise<void> {
    const cols = db.prepare('SELECT id, owu_collection_id FROM collections WHERE user_email = ?').all(email) as any[];
    for (const c of cols) {
        const files = db.prepare('SELECT owu_file_id FROM files WHERE collection_id = ? AND user_email = ?').all(c.id, email) as any[];
        for (const f of files) {
            if (f.owu_file_id) await owuSafeDeleteFile(f.owu_file_id, c.owu_collection_id).catch(() => {});
        }
        if (c.owu_collection_id) await owuDeleteCollection(c.owu_collection_id).catch(() => {});
    }

    const userRecord = db.prepare('SELECT user_id FROM user_plans WHERE user_email = ?').get(email) as any;
    if (userRecord) {
        fs.rmSync(path.join(config.documentsDir, userRecord.user_id), { recursive: true, force: true });
    }

    const now = utcNow();
    db.transaction(() => {
        db.prepare('DELETE FROM files WHERE user_email = ?').run(email);
        db.prepare('DELETE FROM collections WHERE user_email = ?').run(email);
        renewUserStorage(email);
    })();

    const kcId = randomId('kc');
    db.prepare("INSERT INTO collections (id, user_email, name, is_default, created_at, updated_at) VALUES (?, ?, '默认知识库', 1, ?, ?)")
        .run(kcId, email, now, now);

    syncCollectionToOWU(email, kcId).catch(e => logger.error('[resetKB] default sync failed:', e.message));
    syncUserModel(email).catch(e => logger.error('[resetKB] model sync failed:', e.message));
    db.prepare('UPDATE user_plans SET kb_purged_at = ?, updated_at = ? WHERE user_email = ?').run(now, now, email);
    logger.info(`[resetKB] Reset knowledge base for ${email}`);
}


export async function completelyPurgeUser(email: string, userId: string): Promise<void> {
    // 1. Clear OWU collections/files/model (best-effort, individual errors swallowed)
    const cols = db.prepare('SELECT owu_collection_id FROM collections WHERE user_email = ? AND owu_collection_id IS NOT NULL').all(email) as any[];
    for (const c of cols) {
        const files = db.prepare('SELECT owu_file_id FROM files WHERE user_email = ?').all(email) as any[];
        for (const f of files) { if (f.owu_file_id) await owuSafeDeleteFile(f.owu_file_id, c.owu_collection_id).catch(() => {}); }
        await owuDeleteCollection(c.owu_collection_id).catch(() => {});
    }
    try { await owuRequest('POST', '/api/v1/models/model/delete', { id: `rag_${email}` }); } catch {}

    let failed = false;

    const token = db.prepare('SELECT token_id FROM user_tokens WHERE email = ?').get(email) as any;
    if (token) {
        try {
            const { status, data } = await callNewApi('DELETE', `/api/token/${token.token_id}`);
            if (status < 200 || status >= 300) {
                logger.error(`[purge] NewAPI token delete failed for ${email}: HTTP ${status} —`, JSON.stringify(data).slice(0, 200));
                failed = true;
            }
        } catch (e: any) {
            logger.error(`[purge] NewAPI token delete network error for ${email}:`, e.message);
            failed = true;
        }
    }

    if (!failed) {
        try {
            const owuUser = await owuGetUserByEmail(email);
            if (owuUser?.id) await owuDeleteUser(owuUser.id);
        } catch (e: any) {
            const msg = e.message || '';
            if (msg.includes('403') || msg.includes('restricted')) {
                logger.info(`[purge] OWU user ${email} is protected (admin), skipping OWU deletion and proceeding with local cleanup`);
            } else {
                logger.error(`[purge] OWU user delete failed for ${email}:`, msg);
                failed = true;
            }
        }
    }

    if (failed) {
        logger.info(`[purge] Partial failure for ${email}, will retry next cycle`);
        return;
    }

    if (userId) fs.rmSync(path.join(config.documentsDir, userId), { recursive: true, force: true });
    db.transaction(() => {
        db.prepare('DELETE FROM files WHERE user_email = ?').run(email);
        db.prepare('DELETE FROM collections WHERE user_email = ?').run(email);
        db.prepare('DELETE FROM user_storage WHERE user_email = ?').run(email);
        db.prepare('DELETE FROM user_tokens WHERE email = ?').run(email);
        db.prepare('DELETE FROM user_plans WHERE user_email = ?').run(email);
        db.prepare('INSERT OR REPLACE INTO purged_users (email, purged_at) VALUES (?, ?)').run(email, utcNow());
    })();
    logger.info(`[purge] Completely purged user ${email}`);
}

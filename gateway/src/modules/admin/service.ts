import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { utcNow } from '../../lib/utils';
import { completelyPurgeUser } from '../plans/service';

const adminOpLocks = new Map<string, Promise<void>>();

export function runWithAdminLock(email: string, fn: () => Promise<void>): Promise<void> {
    if (adminOpLocks.has(email)) return adminOpLocks.get(email)!;
    const p = fn().finally(() => adminOpLocks.delete(email));
    adminOpLocks.set(email, p);
    return p;
}

export function startPurgeTimer() {
    const intervalMs = config.purgeCheckIntervalSeconds * 1000;
    setInterval(async () => {
        try {
            const cutoff = new Date(Date.now() - config.kbRetentionDays * 24 * 3600 * 1000)
                .toISOString()
                .replace('T', ' ')
                .substring(0, 19);
            const users = db.prepare(
                "SELECT user_email, user_id FROM user_plans WHERE status = 'inactive' AND expires_at < ? ORDER BY expires_at ASC LIMIT 5"
            ).all(cutoff) as any[];

            for (const u of users) {
                await runWithAdminLock(u.user_email, async () => {
                    await completelyPurgeUser(u.user_email, u.user_id).catch((e: any) =>
                        logger.error('[timer] purge failed:', e.message)
                    );
                });
            }

            const staleCutoff = new Date(Date.now() - 24 * 3600 * 1000)
                .toISOString()
                .replace('T', ' ')
                .substring(0, 19);
            db.prepare('DELETE FROM purged_users WHERE purged_at < ?').run(staleCutoff);
        } catch {
            // ignore
        }
    }, intervalMs);

    logger.info(`[purge] inactive user purge timer started (${intervalMs}ms)`);
}

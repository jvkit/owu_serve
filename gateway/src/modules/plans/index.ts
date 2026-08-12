import type { Express, Request, Response } from 'express';
import { db } from '../../lib/db';
import { requireAuth } from '../../lib/auth';
import { createOrFetchUserToken, searchRemoteToken, dbUpsertUser } from '../../lib/token';
import { checkAndApplyPlanCycle } from './service';
import { nativeToUsd } from '../../lib/utils';

export function plansModule(app: Express) {
    app.get('/api/user/quota', async (req: Request, res: Response) => {
        try {
            const email = String(req.query.email || '').trim().toLowerCase();
            const token = String(req.query.token || '').trim();
            if (!email) throw new Error('Email omitted');
            if (!requireAuth(req, res, email, token)) return;

            checkAndApplyPlanCycle(email);
            const r = await createOrFetchUserToken(email, true);
            const remote = await searchRemoteToken(r.token_name, false);
            if (remote) {
                r.remain_quota = remote.quota;
                r.used_quota = remote.used_quota;
                r.unlimited_quota = remote.unlimited_quota;
                dbUpsertUser(r);
            }

            const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
            const storage = db.prepare('SELECT * FROM user_storage WHERE user_email = ?').get(email) as any;
            const fc = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(email) as any;

            const usedUsd = nativeToUsd(r.used_quota || 0);
            const remainUsd = nativeToUsd(r.remain_quota || 0);

            res.json({
                ...r,
                chat_quota_used_usd: usedUsd,
                chat_quota_remaining_usd: remainUsd,
                chat_quota_total_usd: usedUsd + remainUsd,
                plan: plan ? {
                    tier: plan.tier,
                    status: plan.status,
                    started_at: plan.started_at,
                    expires_at: plan.expires_at,
                    next_tier: plan.next_tier,
                    next_expires_at: plan.next_expires_at,
                    extra_quota: plan.extra_quota,
                } : null,
                storage_quota: storage?.storage_quota || 0,
                storage_used: storage?.storage_used || 0,
                file_count_quota: storage?.file_count_quota || 0,
                file_count_used: fc?.count || 0,
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });
}

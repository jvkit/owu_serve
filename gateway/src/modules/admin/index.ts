import type { Express, Request, Response } from 'express';
import path from 'path';
import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { signAdminSession, requireAdminAuth, getAdminTokenFromRequest } from '../../lib/auth';
import { callNewApi } from '../../lib/newapi';
import { usdToNative, nativeToUsd, cycleMs, utcNow } from '../../lib/utils';
import { getPlanTiers, listPlanTiers, createPlanTier, updatePlanTier, deletePlanTier } from '../plans/tiers';
import { getUserId, getUserStorage } from '../../lib/user';
import {
    checkAndApplyPlanCycleSync,
    resetUserKB,
} from '../plans/service';
import { runWithAdminLock } from './service';

export function adminModule(app: Express) {
    app.post('/api/admin/login', (req: Request, res: Response) => {
        try {
            const username = String(req.body.username || '').trim();
            const password = String(req.body.password || '');
            if (!username || !password) {
                res.status(400).json({ ok: false, error: '请输入管理员账号和密码' });
                return;
            }
            if (username !== config.newApiUsername || password !== config.newApiPassword) {
                res.status(401).json({ ok: false, error: '管理员账号或密码错误' });
                return;
            }
            const token = signAdminSession();
            res.json({ ok: true, token, expires_at: new Date(Date.now() + config.sessionTtlMs).toISOString() });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // OWU token exchange: auto-login admin from OWU iframe
    app.post('/api/admin/owu', async (req: Request, res: Response) => {
        try {
            const owuToken = String(req.body.owu_token || '').trim();
            if (!owuToken) {
                res.status(400).json({ ok: false, error: '缺少 OWU token' });
                return;
            }

            const url = config.openWebuiBaseUrl + '/api/v1/auths/';
            const owuRes = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${owuToken}`,
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(config.openWebuiTimeoutSeconds * 1000),
            }).catch((e: any) => {
                logger.error('[admin/owu] OWU token verify network error:', e.message);
                return null;
            });

            if (!owuRes) {
                res.status(503).json({ ok: false, error: '身份验证服务暂时不可用' });
                return;
            }

            const data: any = await owuRes.json().catch(() => null);
            if (owuRes.status !== 200 || !data?.id) {
                res.status(401).json({ ok: false, error: 'OWU token 无效或已过期' });
                return;
            }

            if (data.role !== 'admin') {
                res.status(403).json({ ok: false, error: '该账号不是管理员' });
                return;
            }

            const token = signAdminSession();
            res.json({ ok: true, token, expires_at: new Date(Date.now() + config.sessionTtlMs).toISOString() });
        } catch (e: any) {
            logger.error('[admin/owu] exchange error:', e);
            res.status(500).json({ ok: false, error: '服务器内部错误，请稍后重试' });
        }
    });

    app.get('/api/admin/plans/search', async (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const email = String(req.query.email || '').trim().toLowerCase();
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }

            await checkAndApplyPlanCycleSync(email);
            const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
            if (!plan) { res.json({ ok: true, found: false }); return; }

            const storage = db.prepare('SELECT * FROM user_storage WHERE user_email = ?').get(email) as any;
            const fc = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(email) as any;
            const tk = db.prepare('SELECT remain_quota, used_quota FROM user_tokens WHERE email = ?').get(email) as any;
            const tier = getPlanTiers()[plan.tier];

            res.json({
                ok: true,
                found: true,
                email,
                tier: plan.tier,
                status: plan.status,
                started_at: plan.started_at,
                expires_at: plan.expires_at,
                next_tier: plan.next_tier,
                next_expires_at: plan.next_expires_at,
                extra_quota: plan.extra_quota,
                kb_purged_at: plan.kb_purged_at,
                storage_used: storage?.storage_used || 0,
                storage_quota: storage?.storage_quota || tier.storage_quota,
                file_count_used: fc?.count || 0,
                file_count_quota: storage?.file_count_quota || tier.file_count_quota,
                chat_quota_remaining: tk ? nativeToUsd(tk.remain_quota) : 0,
                chat_quota_used: tk ? nativeToUsd(tk.used_quota) : 0,
                chat_quota_total: tier.chat_quota_usd + (plan.extra_quota || 0),
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/plans/renew', async (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const email = String(req.body.email || '').trim().toLowerCase();
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }

            await runWithAdminLock(email, async () => {
                await checkAndApplyPlanCycleSync(email);
                const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
                if (!plan) throw new Error('用户尚未拥有套餐，请先分配套餐');

                const now = utcNow();
                const tiers = getPlanTiers();
                const tierInfo = tiers[plan.tier];
                if (!tierInfo) throw new Error('当前套餐档位已不存在');

                // 已过期：立即重新激活当前档位
                if (plan.status === 'inactive') {
                    const expires = new Date(Date.now() + cycleMs()).toISOString().replace('T', ' ').substring(0, 19);
                    const expiresUnix = Math.floor((Date.now() + cycleMs()) / 1000);
                    const tr = db.prepare('SELECT token_id, token_name FROM user_tokens WHERE email = ?').get(email) as any;
                    if (tr) {
                        const r1 = await callNewApi('PUT', '/api/token/', { id: tr.token_id, name: tr.token_name, remain_quota: usdToNative(tierInfo.chat_quota_usd), expired_time: expiresUnix });
                        if (r1.status < 200 || r1.status >= 300 || !r1.data?.success) throw new Error('NewAPI token update failed');
                        const r2 = await callNewApi('PUT', '/api/token/?status_only=1', { id: tr.token_id, status: 1 });
                        if (r2.status < 200 || r2.status >= 300 || !r2.data?.success) throw new Error('NewAPI token re-enable failed');
                        db.prepare('UPDATE user_tokens SET remain_quota = ?, updated_at = ? WHERE email = ?').run(usdToNative(tierInfo.chat_quota_usd), now, email);
                    }
                    db.prepare("UPDATE user_plans SET status = 'active', started_at = ?, expires_at = ?, next_tier = NULL, next_expires_at = NULL, extra_quota = 0, updated_at = ? WHERE user_email = ?")
                        .run(now, expires, now, email);
                    res.json({ ok: true, message: '套餐已重新激活并续期一个周期' });
                    return;
                }

                if (plan.status !== 'active') throw new Error('用户不在活跃套餐中');
                if (plan.next_tier != null) throw new Error('当前有待生效的套餐，请等待套餐生效后再续费');
                const nextExpires = new Date(new Date(plan.expires_at.replace(' ', 'T') + 'Z').getTime() + cycleMs())
                    .toISOString()
                    .replace('T', ' ')
                    .substring(0, 19);
                db.prepare('UPDATE user_plans SET next_tier = ?, next_expires_at = ?, updated_at = ? WHERE user_email = ?')
                    .run(plan.tier, nextExpires, now, email);
                res.json({ ok: true, message: '续费成功' });
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/plans/upgrade', async (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const email = String(req.body.email || '').trim().toLowerCase();
            const newTier = Number(req.body.new_tier) || 0;
            const tiers = getPlanTiers();
            if (!email || !newTier || !tiers[newTier]) { res.status(400).json({ ok: false, error: 'Invalid tier' }); return; }

            await runWithAdminLock(email, async () => {
                await checkAndApplyPlanCycleSync(email);
                const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
                if (!plan || plan.status !== 'active') throw new Error('用户不在活跃套餐中');
                if (newTier <= plan.tier) throw new Error('升级必须选择更高等级');

                const tierInfo = tiers[newTier];
                const now = utcNow();
                const expires = new Date(Date.now() + cycleMs()).toISOString().replace('T', ' ').substring(0, 19);
                const expiresUnix = Math.floor(new Date(expires.replace(' ', 'T') + 'Z').getTime() / 1000);
                const tokenRow = db.prepare('SELECT token_id, token_name FROM user_tokens WHERE email = ?').get(email) as any;

                if (tokenRow) {
                    const r1 = await callNewApi('PUT', '/api/token/', {
                        id: tokenRow.token_id,
                        name: tokenRow.token_name,
                        remain_quota: usdToNative(tierInfo.chat_quota_usd),
                        expired_time: expiresUnix,
                    });
                    if (r1.status < 200 || r1.status >= 300 || !r1.data?.success) throw new Error('NewAPI token update failed');
                    const r2 = await callNewApi('PUT', '/api/token/?status_only=1', { id: tokenRow.token_id, status: 1 });
                    if (r2.status < 200 || r2.status >= 300 || !r2.data?.success) throw new Error('NewAPI token re-enable failed');
                    db.prepare('UPDATE user_tokens SET remain_quota = ?, updated_at = ? WHERE email = ?')
                        .run(usdToNative(tierInfo.chat_quota_usd), now, email);
                }

                db.transaction(() => {
                    db.prepare('UPDATE user_plans SET tier = ?, started_at = ?, expires_at = ?, next_tier = NULL, next_expires_at = NULL, extra_quota = 0, updated_at = ? WHERE user_email = ?')
                        .run(newTier, now, expires, now, email);
                    db.prepare('UPDATE user_storage SET storage_quota = ?, file_count_quota = ?, updated_at = ? WHERE user_email = ?')
                        .run(tierInfo.storage_quota, tierInfo.file_count_quota, now, email);
                })();
                res.json({ ok: true, message: `已升级至等级 ${newTier}` });
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/plans/downgrade', async (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const email = String(req.body.email || '').trim().toLowerCase();
            const newTier = Number(req.body.new_tier) || 0;
            if (!email || !newTier || !getPlanTiers()[newTier]) { res.status(400).json({ ok: false, error: 'Invalid tier' }); return; }

            await runWithAdminLock(email, async () => {
                await checkAndApplyPlanCycleSync(email);
                const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
                if (!plan || plan.status !== 'active') throw new Error('用户不在活跃套餐中');
                if (plan.next_tier != null) throw new Error('当前有待生效的套餐，请等待套餐生效后再降级');
                if (newTier >= plan.tier) throw new Error('降级必须选择更低等级');

                const now = utcNow();
                const nextExpires = new Date(new Date(plan.expires_at.replace(' ', 'T') + 'Z').getTime() + cycleMs())
                    .toISOString()
                    .replace('T', ' ')
                    .substring(0, 19);
                db.prepare('UPDATE user_plans SET next_tier = ?, next_expires_at = ?, updated_at = ? WHERE user_email = ?')
                    .run(newTier, nextExpires, now, email);
                res.json({ ok: true, message: `将在当前套餐结束后降级至等级 ${newTier}` });
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/plans/topup', async (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const email = String(req.body.email || '').trim().toLowerCase();
            const amountUsd = Number(req.body.amount_usd) || 0;
            if (!email || amountUsd <= 0) { res.status(400).json({ ok: false, error: 'Invalid amount' }); return; }

            await runWithAdminLock(email, async () => {
                await checkAndApplyPlanCycleSync(email);
                const plan = db.prepare('SELECT * FROM user_plans WHERE user_email = ?').get(email) as any;
                if (!plan || plan.status !== 'active') throw new Error('用户不在活跃套餐中');

                const tr = db.prepare('SELECT token_id, token_name, remain_quota FROM user_tokens WHERE email = ?').get(email) as any;
                if (!tr) throw new Error('用户无有效令牌');

                const newNative = tr.remain_quota + usdToNative(amountUsd);
                const r1 = await callNewApi('PUT', '/api/token/', { id: tr.token_id, name: tr.token_name, remain_quota: newNative, expired_time: -1 });
                if (r1.status < 200 || r1.status >= 300 || !r1.data?.success) throw new Error(`NewAPI token update failed (${r1.status}): ${JSON.stringify(r1.data).slice(0, 200)}`);
                const r2 = await callNewApi('PUT', '/api/token/?status_only=1', { id: tr.token_id, status: 1 });
                if (r2.status < 200 || r2.status >= 300 || !r2.data?.success) throw new Error(`NewAPI token re-enable failed (${r2.status}): ${JSON.stringify(r2.data).slice(0, 200)}`);

                const now = utcNow();
                db.prepare('UPDATE user_tokens SET remain_quota = ?, updated_at = ? WHERE email = ?').run(newNative, now, email);
                db.prepare('UPDATE user_plans SET extra_quota = extra_quota + ?, updated_at = ? WHERE user_email = ?').run(amountUsd, now, email);
                res.json({ ok: true, message: `已追加 ${amountUsd} 元额度` });
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/plans/assign', async (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const email = String(req.body.email || '').trim().toLowerCase();
            const newTier = Number(req.body.tier) || 0;
            const tiers = getPlanTiers();
            if (!email || !newTier || !tiers[newTier]) { res.status(400).json({ ok: false, error: 'Invalid tier' }); return; }

            await runWithAdminLock(email, async () => {
                await checkAndApplyPlanCycleSync(email);
                const tierInfo = tiers[newTier];
                const st = db.prepare('SELECT * FROM user_storage WHERE user_email = ?').get(email) as any;
                const fc = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(email) as any;
                if ((st?.storage_used || 0) > tierInfo.storage_quota || (fc?.count || 0) > tierInfo.file_count_quota) {
                    await resetUserKB(email);
                }

                const now = utcNow();
                const expires = new Date(Date.now() + cycleMs()).toISOString().replace('T', ' ').substring(0, 19);
                const expiresUnix = Math.floor((Date.now() + cycleMs()) / 1000);
                const tr = db.prepare('SELECT token_id, token_name FROM user_tokens WHERE email = ?').get(email) as any;

                if (tr) {
                    const r1 = await callNewApi('PUT', '/api/token/', { id: tr.token_id, name: tr.token_name, remain_quota: usdToNative(tierInfo.chat_quota_usd), expired_time: expiresUnix });
                    if (r1.status < 200 || r1.status >= 300 || !r1.data?.success) throw new Error('NewAPI token update failed');
                    const r2 = await callNewApi('PUT', '/api/token/?status_only=1', { id: tr.token_id, status: 1 });
                    if (r2.status < 200 || r2.status >= 300 || !r2.data?.success) throw new Error('NewAPI token re-enable failed');
                    db.prepare('UPDATE user_tokens SET remain_quota = ?, updated_at = ? WHERE email = ?').run(usdToNative(tierInfo.chat_quota_usd), now, email);
                }

                const ep = db.prepare('SELECT user_email FROM user_plans WHERE user_email = ?').get(email) as any;
                if (ep) {
                    db.prepare("UPDATE user_plans SET tier = ?, status = 'active', started_at = ?, expires_at = ?, next_tier = NULL, next_expires_at = NULL, extra_quota = 0, updated_at = ? WHERE user_email = ?")
                        .run(newTier, now, expires, now, email);
                } else {
                    const uid = getUserId(email);
                    db.prepare("INSERT INTO user_plans (user_email, user_id, tier, status, started_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)")
                        .run(email, uid, newTier, now, expires, now, now);
                }
                db.prepare('UPDATE user_storage SET storage_quota = ?, file_count_quota = ?, updated_at = ? WHERE user_email = ?')
                    .run(tierInfo.storage_quota, tierInfo.file_count_quota, now, email);

                const kbOver = (st?.storage_used || 0) > tierInfo.storage_quota || (fc?.count || 0) > tierInfo.file_count_quota;
                res.json({ ok: true, message: `已激活等级 ${newTier}${kbOver ? '（知识库已重置）' : ''}` });
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/admin/plans/search-suggest', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const q = String(req.query.q || '').trim().toLowerCase();
            if (!q || q.length < 1) { res.json({ ok: true, emails: [] }); return; }
            const rows = db.prepare('SELECT DISTINCT user_email FROM user_plans WHERE user_email LIKE ? ORDER BY user_email ASC LIMIT 8')
                .all(`%${q}%`) as any[];
            res.json({ ok: true, emails: rows.map((r: any) => r.user_email) });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/admin/plans/tier-limits', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const limits: Record<number, { storage: number; files: number }> = {};
            for (const [k, v] of Object.entries(getPlanTiers())) {
                limits[Number(k)] = { storage: v.storage_quota, files: v.file_count_quota };
            }
            res.json({ ok: true, tiers: limits });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/admin/plans/inactive-list', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const now = utcNow();
            const staleActives = db.prepare("SELECT user_email FROM user_plans WHERE status = 'active' AND expires_at < ?").all(now) as any[];
            for (const u of staleActives) { checkAndApplyPlanCycleSync(u.user_email); }

            const cutoff = new Date(Date.now() - config.kbRetentionDays * 24 * 3600 * 1000)
                .toISOString()
                .replace('T', ' ')
                .substring(0, 19);
            const users = db.prepare("SELECT user_email, tier, expires_at, kb_purged_at FROM user_plans WHERE status = 'inactive' AND expires_at > ? ORDER BY expires_at ASC")
                .all(cutoff) as any[];

            const result = users.map(u => {
                const st = db.prepare('SELECT storage_used FROM user_storage WHERE user_email = ?').get(u.user_email) as any;
                const fc = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(u.user_email) as any;
                const days = Math.ceil((new Date(u.expires_at.replace(' ', 'T') + 'Z').getTime() + config.kbRetentionDays * 24 * 3600 * 1000 - Date.now()) / (24 * 3600 * 1000));
                return {
                    email: u.user_email,
                    tier: u.tier,
                    expired_at: u.expires_at,
                    storage_used: st?.storage_used || 0,
                    file_count_used: fc?.count || 0,
                    kb_purged_at: u.kb_purged_at,
                    days_until_purge: Math.max(0, days),
                };
            });
            res.json({ ok: true, users: result });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // Plan tier management
    app.get('/api/admin/plan-tiers', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;
            res.json({ ok: true, tiers: listPlanTiers() });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/plan-tiers', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const id = Number(req.body.id);
            const name = String(req.body.name || '').trim();
            const storage_gb = Number(req.body.storage_gb);
            const file_count = Number(req.body.file_count);
            const chat_quota_usd = Number(req.body.chat_quota_usd);

            if (!id || id < 1 || !name) { res.status(400).json({ ok: false, error: 'Invalid id or name' }); return; }
            if (!Number.isFinite(storage_gb) || storage_gb < 0) { res.status(400).json({ ok: false, error: 'Invalid storage_gb' }); return; }
            if (!Number.isFinite(file_count) || file_count < 0) { res.status(400).json({ ok: false, error: 'Invalid file_count' }); return; }
            if (!Number.isFinite(chat_quota_usd) || chat_quota_usd < 0) { res.status(400).json({ ok: false, error: 'Invalid chat_quota_usd' }); return; }

            createPlanTier({ id, name, storage_gb, file_count, chat_quota_usd, is_active: 1 });
            res.json({ ok: true, message: '套餐档位已创建' });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.put('/api/admin/plan-tiers/:id', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;

            const id = Number(req.params.id);
            const patch: any = {};
            if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
            if (req.body.storage_gb !== undefined) patch.storage_gb = Number(req.body.storage_gb);
            if (req.body.file_count !== undefined) patch.file_count = Number(req.body.file_count);
            if (req.body.chat_quota_usd !== undefined) patch.chat_quota_usd = Number(req.body.chat_quota_usd);
            if (req.body.is_active !== undefined) patch.is_active = req.body.is_active ? 1 : 0;

            updatePlanTier(id, patch);
            res.json({ ok: true, message: '套餐档位已更新' });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/admin/plan-tiers/:id', (req: Request, res: Response) => {
        try {
            const token = getAdminTokenFromRequest(req);
            if (!requireAdminAuth(req, res, token)) return;
            deletePlanTier(Number(req.params.id));
            res.json({ ok: true, message: '套餐档位已删除' });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/admin', (_req: Request, res: Response) => {
        res.redirect('/admin/dashboard');
    });

    app.get('/admin/dashboard', (_req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'admin.html'));
    });
}

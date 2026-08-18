import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../lib/auth';
import { logger } from '../../lib/logger';
import { owuFindUserIdByEmail, owuGetFullUserByEmail, owuUpdateUserProfile } from '../../lib/owu';
import { getEmailFromRequest, getTokenFromRequest } from '../files/service';

export function userModule(app: Express) {
    // 当前用户 OWU 资料（name/头像/bio/gender/role）
    app.get('/api/user/profile', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            if (!requireAuth(req, res, email, token)) return;
            const profile = await owuGetFullUserByEmail(email);
            if (!profile) {
                res.status(404).json({ ok: false, error: '用户不存在' });
                return;
            }
            res.json({ ok: true, profile });
        } catch (e: any) {
            logger.error('[user] get profile error:', e);
            res.status(500).json({ ok: false, error: e.message || '获取资料失败' });
        }
    });

    // 更新当前用户 OWU 资料（改名/头像/bio/性别）
    app.post('/api/user/profile', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            if (!requireAuth(req, res, email, token)) return;

            const { name, profile_image_url, bio, gender } = req.body || {};
            const owuUserId = await owuFindUserIdByEmail(email);
            if (!owuUserId) {
                res.status(404).json({ ok: false, error: 'OWU 用户不存在' });
                return;
            }

            const updated = await owuUpdateUserProfile(owuUserId, { name, profile_image_url, bio, gender });
            const profile = {
                id: owuUserId,
                email,
                name: updated?.name ?? name,
                profile_image_url: updated?.profile_image_url ?? profile_image_url ?? '',
                bio: updated?.bio ?? bio ?? '',
                gender: updated?.gender ?? gender ?? '',
                role: updated?.role ?? '',
            };
            res.json({ ok: true, profile });
        } catch (e: any) {
            logger.error('[user] update profile error:', e);
            res.status(500).json({ ok: false, error: e.message || '更新资料失败' });
        }
    });
}

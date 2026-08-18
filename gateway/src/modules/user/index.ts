import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../lib/auth';
import { logger } from '../../lib/logger';
import { owuFindUserIdByEmail, owuGetFullUserByEmail, owuUpdateUserProfile, owuRequestRaw } from '../../lib/owu';
import { getEmailFromRequest, getTokenFromRequest } from '../files/service';
import { config } from '../../config';

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
            // OWU /users/all 不返回 base64 头像，直接调用 profile/image 端点拉取二进制并转 base64
            if (profile.id) {
                try {
                    const upstream = await owuRequestRaw('GET', `/api/v1/users/${encodeURIComponent(profile.id)}/profile/image`, undefined, undefined, 30000);
                    if (upstream.ok && upstream.status === 200) {
                        const contentType = upstream.headers.get('content-type') || 'image/png';
                        const buf = Buffer.from(await upstream.arrayBuffer());
                        profile.profile_image_url = `data:${contentType};base64,${buf.toString('base64')}`;
                    }
                } catch (e: any) {
                    logger.warn('[user] failed to load avatar:', e.message);
                }
            }
            res.json({ ok: true, profile });
        } catch (e: any) {
            logger.error('[user] get profile error:', e);
            res.status(500).json({ ok: false, error: e.message || '获取资料失败' });
        }
    });

    // 当前用户头像代理（OWU /users/all 不返回 base64，直接代理 profile/image 端点）
    app.get('/api/user/avatar', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            if (!requireAuth(req, res, email, token)) return;

            const owuUserId = await owuFindUserIdByEmail(email);
            if (!owuUserId) {
                res.status(404).end();
                return;
            }

            const upstream = await owuRequestRaw('GET', `/api/v1/users/${encodeURIComponent(owuUserId)}/profile/image`, undefined, undefined, 30000);
            if (upstream.status === 302 || upstream.status === 301) {
                res.status(upstream.status).setHeader('Location', upstream.headers.get('Location') || '');
                res.end();
                return;
            }
            res.status(upstream.status);
            upstream.headers.forEach((val: string, key: string) => {
                const lower = key.toLowerCase();
                if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding') return;
                res.setHeader(key, val);
            });
            if (upstream.body) {
                const reader = upstream.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
            }
            res.end();
        } catch (e: any) {
            logger.error('[user] avatar proxy error:', e);
            res.status(500).end();
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

import type { Express, Request, Response } from 'express';
import path from 'path';
import { config } from '../../config';
import { handleError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { signSession } from '../../lib/auth';
import { createOrFetchUserToken } from '../../lib/token';
import { checkAndApplyPlanCycle } from '../plans/service';
import { syncUserModel } from '../rag/service';

export function dashboardModule(app: Express) {
    // Auth
    app.post('/api/auth/signin', async (req: Request, res: Response) => {
        try {
            const email = String(req.body.email || '').trim().toLowerCase();
            const password = String(req.body.password || '');
            if (!email || !password) {
                res.status(400).json({ ok: false, error: '请输入邮箱和密码' });
                return;
            }

            const url = config.openWebuiBaseUrl + '/api/v1/auths/signin';
            const owuRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ email, password }),
                signal: AbortSignal.timeout(config.openWebuiTimeoutSeconds * 1000),
            }).catch((e: any) => {
                if (e.name === 'TimeoutError' || e.name === 'AbortError') {
                    res.status(503).json({ ok: false, error: '身份验证服务响应超时，请稍后重试' });
                } else {
                    res.status(503).json({ ok: false, error: '身份验证服务暂时不可用，请稍后重试' });
                }
                return null;
            });
            if (!owuRes) return;

            const data: any = await owuRes.json().catch(() => null);
            if (owuRes.status >= 400 && owuRes.status < 500) {
                res.status(401).json({ ok: false, error: '邮箱或密码错误' });
                return;
            }
            if (owuRes.status !== 200 || !data?.token) {
                res.status(502).json({ ok: false, error: '身份验证服务返回异常，请稍后重试' });
                return;
            }
            if (data.role === 'pending') {
                res.json({ ok: false, error: '您的账户正在等待管理员激活，激活后即可登录使用' });
                return;
            }

            const token = signSession(email);
            checkAndApplyPlanCycle(email);
            createOrFetchUserToken(email, true).catch((e: any) =>
                logger.error('[signin] token/plan creation failed:', e.message),
            );
            syncUserModel(email).catch((e: any) => logger.error('[owu] init model sync failed:', e.message));

            res.json({ ok: true, token, user: { email: data.email, name: data.name, role: data.role } });
        } catch (e: any) {
            logger.error('[auth] signin error:', e);
            res.status(500).json({ ok: false, error: '服务器内部错误，请稍后重试' });
        }
    });

    // Serve dashboard SPA (also handled by root static middleware)
    app.get('/dashboard', (_req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'index.html'));
    });
}

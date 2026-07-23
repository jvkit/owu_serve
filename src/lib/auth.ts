import crypto from 'crypto';
import type { Request, Response } from 'express';
import { config } from '../config';
import { db } from './db';

const { sessionSecret, sessionTtlMs, adminSessionTokenPrefix } = config;

export function signSession(email: string): string {
    const expires = Date.now() + sessionTtlMs;
    const payload = `${email}|${expires}`;
    const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

export function verifySession(email: string, token: string): boolean {
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf8');
        const parts = decoded.split('|');
        if (parts.length !== 3) return false;
        const [tokEmail, tokExpires, tokSig] = parts;
        if (tokEmail !== email) return false;
        if (Date.now() > Number(tokExpires)) return false;
        const payload = `${tokEmail}|${tokExpires}`;
        const expectedSig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
        if (tokSig.length !== expectedSig.length) return false;
        return crypto.timingSafeEqual(Buffer.from(tokSig), Buffer.from(expectedSig));
    } catch {
        return false;
    }
}

export function signAdminSession(): string {
    const expires = Date.now() + sessionTtlMs;
    const payload = `${adminSessionTokenPrefix}|${expires}`;
    const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

export function verifyAdminSession(token: string): boolean {
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf8');
        const parts = decoded.split('|');
        if (parts.length !== 3) return false;
        const [prefix, tokExpires, tokSig] = parts;
        if (prefix !== adminSessionTokenPrefix) return false;
        if (Date.now() > Number(tokExpires)) return false;
        const payload = `${prefix}|${tokExpires}`;
        const expectedSig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
        if (tokSig.length !== expectedSig.length) return false;
        return crypto.timingSafeEqual(Buffer.from(tokSig), Buffer.from(expectedSig));
    } catch {
        return false;
    }
}

export function sessionCreatedAt(token: string): number | null {
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf8');
        const parts = decoded.split('|');
        if (parts.length !== 3) return null;
        const expires = Number(parts[1]);
        return expires - sessionTtlMs;
    } catch {
        return null;
    }
}

export function requireAuth(req: Request, res: Response, email: string, token: string): boolean {
    if (!email || !token || !verifySession(email, token)) {
        res.status(401).json({ ok: false, error: '登录已过期，请重新登录' });
        return false;
    }
    const purgedRow = db.prepare('SELECT purged_at FROM purged_users WHERE email = ?').get(email) as any;
    if (purgedRow) {
        const decoded = Buffer.from(token, 'base64url').toString('utf8');
        const tokExpires = Number(decoded.split('|')[1]);
        const sessionCreated = tokExpires - sessionTtlMs;
        const purgedEpoch = new Date(purgedRow.purged_at.replace(' ', 'T') + 'Z').getTime();
        if (purgedEpoch > sessionCreated) {
            res.status(401).json({ ok: false, error: '该账户已被注销' });
            return false;
        }
    }
    return true;
}

export function requireAdminAuth(req: Request, res: Response, token: string): boolean {
    if (!token || !verifyAdminSession(token)) {
        res.status(401).json({ ok: false, error: '管理员登录已过期，请重新登录' });
        return false;
    }
    return true;
}

export function getAdminTokenFromRequest(req: Request): string {
    const fromQuery = String(req.query.token || '').trim();
    if (fromQuery) return fromQuery;
    const fromBody = req.body && typeof req.body === 'object' && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (fromBody) return fromBody;
    const auth = (req.headers.authorization || '').split(' ')[1] || '';
    return auth.trim();
}

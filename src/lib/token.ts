import crypto from 'crypto';
import { db } from './db';
import { config } from '../config';
import { callNewApi } from './newapi';
import { logger } from './logger';
import { utcNow } from './utils';
import { ensureUserPlan } from '../modules/plans/service';
import { usdToNative } from '../modules/plans/utils';

const tokenLocks = new Map<string, Promise<any>>();

export function tokenNameForEmail(email: string): string {
    return email;
}

export function normalizeTokenKey(key: any): string {
    let normalized = String(key || '');
    if (normalized && !normalized.startsWith('sk-')) normalized = 'sk-' + normalized;
    return normalized;
}

export function isMaskedTokenKey(key: any): boolean {
    const value = String(key || '');
    return !!value && (value.includes('...') || value.includes('*'));
}

export function extractTokenKey(payload: any): string | null {
    const key = payload?.data?.key || payload?.key || null;
    return key ? normalizeTokenKey(key) : null;
}

export async function fetchRemoteTokenKey(tokenId: any): Promise<string | null> {
    const { status, data } = await callNewApi('POST', `/api/token/${tokenId}/key`);
    const key = extractTokenKey(data);
    if (status === 200 && key && !isMaskedTokenKey(key)) {
        return key;
    }

    const message = data?.message ? ` message=${data.message}` : '';
    logger.warn(`[Token] Failed to fetch unmasked key via /api/token/${tokenId}/key. status=${status}${message}`);
    return null;
}

export function dbUpsertUser(r: any) {
    const stmt = db.prepare(`
      INSERT INTO user_tokens (
        email, user_id, user_name, user_role, token_id, token_name, token_key,
        remain_quota, used_quota, unlimited_quota, created_at, updated_at
      ) VALUES (
        @email, @user_id, @user_name, @user_role, @token_id, @token_name, @token_key,
        @remain_quota, @used_quota, @unlimited_quota, @created_at, @updated_at
      )
      ON CONFLICT(email) DO UPDATE SET
        token_id = excluded.token_id,
        token_name = excluded.token_name,
        token_key = excluded.token_key,
        remain_quota = excluded.remain_quota,
        updated_at = excluded.updated_at
    `);

    const safeData = {
        email: r.email ? String(r.email) : '',
        user_id: r.user_id ? String(r.user_id) : '',
        user_name: r.user_name ? String(r.user_name) : '',
        user_role: r.user_role ? String(r.user_role) : '',
        token_id: parseInt(String(r.token_id)) || 0,
        token_name: r.token_name ? String(r.token_name) : '',
        token_key: r.token_key ? String(r.token_key) : '',
        remain_quota: parseInt(String(r.remain_quota)) || 0,
        used_quota: parseInt(String(r.used_quota)) || 0,
        unlimited_quota: r.unlimited_quota ? 1 : 0,
        created_at: r.created_at ? String(r.created_at) : utcNow(),
        updated_at: r.updated_at ? String(r.updated_at) : utcNow(),
    };
    stmt.run(safeData);
}

export async function searchRemoteToken(tokenName: string, needKey: boolean = true) {
    let { status, data } = await callNewApi('GET', `/api/token/?keyword=${encodeURIComponent(tokenName)}`);

    if (status !== 200 || !data?.success) {
        const fallback = await callNewApi('GET', `/api/token/search?keyword=${encodeURIComponent(tokenName)}`);
        status = fallback.status;
        data = fallback.data;
    }

    if (status === 200 && (data?.success || data?.data)) {
        const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.data?.items) ? data.data.items : []);
        const exact = list.find((x: any) => String(x.name) === String(tokenName));
        if (exact) {
            let key = normalizeTokenKey(exact.key);

            if (needKey && isMaskedTokenKey(key)) {
                logger.info(`[Token] Search returned masked key. Attempting to fetch unmasked key via /api/token/${exact.id}/key...`);
                try {
                    const fullKey = await fetchRemoteTokenKey(exact.id);
                    if (fullKey) {
                        key = fullKey;
                        logger.info(`[Token] Retrieved unmasked key successfully.`);
                    }
                } catch (e) {
                    logger.warn('[Token] Error fetching full token key:', e);
                }
            }

            return {
                id: exact.id,
                key: key,
                quota: exact.remain_quota,
                used_quota: exact.used_quota || 0,
                unlimited_quota: exact.unlimited_quota ? 1 : 0,
            };
        }
    }
    return null;
}

export async function createOrFetchUserToken(email: string, autoCreate: boolean = true, displayName?: string, role?: string): Promise<any> {
    if (tokenLocks.has(email)) return tokenLocks.get(email);
    const p = createOrFetchUserTokenImpl(email, autoCreate, displayName, role);
    tokenLocks.set(email, p);
    try { return await p; } finally { tokenLocks.delete(email); }
}

export function dbUpdateUserName(email: string, name: string) {
    const clean = name ? String(name).trim() : '';
    if (!clean) return;
    db.prepare('UPDATE user_tokens SET user_name = ? WHERE email = ?').run(clean, email);
}

export function dbUpdateUserRole(email: string, role: string) {
    const clean = role ? String(role).trim() : '';
    if (!clean) return;
    db.prepare('UPDATE user_tokens SET user_role = ? WHERE email = ?').run(clean, email);
}

async function createOrFetchUserTokenImpl(email: string, autoCreate: boolean = true, displayName?: string, role?: string): Promise<any> {
    const local = db.prepare('SELECT * FROM user_tokens WHERE email = ?').get(email) as any;
    if (local && local.token_key && !isMaskedTokenKey(local.token_key)) {
        // Sync the real display name & role from OWU if we have them and they differ.
        if (displayName && String(local.user_name || '') !== String(displayName)) {
            dbUpdateUserName(email, displayName);
            local.user_name = displayName;
        }
        if (role && String(local.user_role || '') !== String(role)) {
            dbUpdateUserRole(email, role);
            local.user_role = role;
        }
        return local;
    }

    const tName = tokenNameForEmail(email);
    let remoteInfo = await searchRemoteToken(tName);

    if (remoteInfo && remoteInfo.key && isMaskedTokenKey(remoteInfo.key)) {
        logger.info(`[Token] Existing token for ${email} has masked key. Attempting to extract via /api/token/${remoteInfo.id}/key...`);
        const unmaskedKey = await fetchRemoteTokenKey(remoteInfo.id);
        if (unmaskedKey) {
            remoteInfo.key = unmaskedKey;
            logger.info(`[Token] Successfully extracted unmasked key for existing token [${remoteInfo.id}]`);
        } else {
            logger.error(`[Token] Cannot unmask existing token key for ${email} (id: ${remoteInfo.id}).`);
            throw new Error(`\n❌ [NewAPI 密钥掩码拦截]\n\n已存在的令牌密钥被掩码，无法提取。\n请前往 NewAPI 管理面板 -> 系统设置 -> 开启"以明文显示令牌"(Display Token in Plain Text)。`);
        }
    }

    if (!remoteInfo || !remoteInfo.id) {
        if (!autoCreate) {
            throw new Error('用户不存在或尚未被授权。请先在 OpenWebUI 中发起一次对话以初始化账户！');
        }

        logger.info(`[Token] Creating remote token for -> ${email}`);
        let customKey: string;
        do {
            customKey = 'sk-' + crypto.randomBytes(24).toString('hex');
        } while (db.prepare('SELECT 1 FROM user_tokens WHERE token_key = ?').get(customKey));

        const t1 = config.planTiers[1];
        const payload: any = {
            name: tName,
            remain_quota: usdToNative(t1.chat_quota_usd),
            expired_time: -1,
            unlimited_quota: false,
            key: customKey,
        };
        if (config.allowedModels.length > 0) {
            payload.models = config.allowedModels.join(',');
        }

        const payloadForLog = {
            ...payload,
            key: payload.key ? `${String(payload.key).slice(0, 6)}...${String(payload.key).slice(-4)}` : payload.key,
        };
        logger.info('[Token] POST payload:', payloadForLog);
        const { status, data } = await callNewApi('POST', '/api/token', payload);
        logger.info(`[Token] POST response (${status}):`, JSON.stringify(data));

        if (status !== 200 && status !== 201) {
            throw new Error(`Token Creation Failed in NewAPI (Status ${status}): ${data?.message || JSON.stringify(data) || 'Unknown'}`);
        }

        if (data && data.success === false) {
            throw new Error(`Token Creation Failed in NewAPI: ${data.message || JSON.stringify(data)}`);
        }

        logger.info('[Token] Fetching created token ID via search API...');
        await new Promise(r => setTimeout(r, 200));
        remoteInfo = await searchRemoteToken(tName);
        if (!remoteInfo) throw new Error('Could not verify newly created token. Creation API succeeded, but search failed. Check NewAPI response format.');

        if (isMaskedTokenKey(remoteInfo.key)) {
            logger.info('[Token] Token key is masked. Attempting to extract unmasked key from NewAPI...');
            const unmaskedKey = await fetchRemoteTokenKey(remoteInfo.id);
            if (unmaskedKey) {
                remoteInfo.key = unmaskedKey;
                logger.info(`[Token] Successfully extracted unmasked key for token ID [${remoteInfo.id}]!`);
            } else {
                logger.error('[Token] FATAL ERROR: Newly created token key could not be unmasked!');
                throw new Error(`\n❌ [NewAPI 密钥掩码拦截 / Masked Token Error]\n\n网关成功在 NewAPI 中为您创建了令牌，但由于 NewAPI 版本接口限制，提取真实密钥失败（${unmaskedKey || remoteInfo.key}）。\n\n👉 解决方案：\n请前往 NewAPI 管理面板 -> 系统设置 -> [以明文显示令牌] (Display Token in Plain Text)，将其【开启】。\n或者关闭 [隐藏令牌密钥] 选项。\n然后重新发送消息。`);
            }
        } else {
            logger.info(`[Token] Token ID [${remoteInfo.id}] created and unmasked key retrieved!`);
        }
    }

    const record = {
        email: email,
        user_id: '',
        user_name: displayName || email,
        user_role: role || '',
        token_id: remoteInfo.id,
        token_name: tName,
        token_key: remoteInfo.key,
        remain_quota: remoteInfo.quota || usdToNative(config.planTiers[1].chat_quota_usd),
        used_quota: remoteInfo.used_quota || 0,
        unlimited_quota: remoteInfo.unlimited_quota || 0,
    };

    dbUpsertUser(record);
    ensureUserPlan(email);
    return record;
}



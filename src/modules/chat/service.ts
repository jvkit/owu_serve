import type { Request, Response } from 'express';
import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { ApiError } from '../../lib/errors';
import { createOrFetchUserToken } from '../../lib/token';
import { checkAndApplyPlanCycle } from '../plans/service';
import { syncUserModel } from '../rag/service';

export function listModels() {
    return {
        object: 'list',
        data: config.allowedModels.map((m) => ({
            id: m,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'gateway',
        })),
    };
}

function sendOpenAIError(res: Response, status: number, message: string) {
    res.status(status).json({ error: { message } });
}

function extractEmail(req: Request, body: any): string | null {
    const fromHeader = (
        req.headers['x-openwebui-user-email']
        || req.headers['x-user-email']
        || req.headers['x-email']
        || req.headers['x-openwebui-user-id']
        || req.headers['x-user-id']
    );
    let email = String(fromHeader || '').trim().toLowerCase();

    if (!email && body?.metadata?.email) {
        email = String(body.metadata.email).trim().toLowerCase();
    }
    if (!email && body?.user) {
        email = String(body.user).trim().toLowerCase();
    }

    if (!email && Array.isArray(body?.messages)) {
        for (const msg of body.messages) {
            const match = typeof msg.content === 'string' && msg.content.match(/\[OWU_META email=(.*?) user_id/);
            if (match) {
                email = match[1].trim().toLowerCase();
                msg.content = msg.content.replace(/\[OWU_META.*?\]/g, '').trim();
                break;
            }
        }
    }

    return email || null;
}

export async function proxyChatCompletion(req: Request, res: Response) {
    const body = req.body || {};
    const email = extractEmail(req, body);

    if (!email) {
        logger.error('[chat] Blocked: No user email parsed.');
        logger.error('[chat] Headers:', JSON.stringify(req.headers));
        logger.error('[chat] Body metadata:', JSON.stringify(body.metadata));
        logger.error('[chat] Body user:', body.user);
        sendOpenAIError(res, 401, 'No OWU User associated with request.');
        return;
    }

    let finalKey = '';
    try {
        checkAndApplyPlanCycle(email);

        const planRec = db.prepare('SELECT status FROM user_plans WHERE user_email = ?').get(email) as any;
        if (planRec?.status === 'inactive') {
            sendOpenAIError(res, 403, '套餐已过期，聊天功能暂停使用，请联系管理员续费');
            return;
        }

        const uToken = await createOrFetchUserToken(email);
        finalKey = uToken.token_key;
        const safeKeyLog = finalKey.length > 10
            ? `${finalKey.substring(0, 6)}...${finalKey.substring(finalKey.length - 4)}`
            : finalKey;
        logger.info(
            `[chat] Routing: ${email} model=${body.model} tools=${!!body.tools?.length} ` +
            `tool_choice=${JSON.stringify(body.tool_choice)} files=${body.files?.length || 0} key=${safeKeyLog}`
        );
        syncUserModel(email).catch((e) => logger.error('[owu] init model sync failed:', e.message));
    } catch (err: any) {
        logger.error(`[chat] Auto-Token Generation Error: ${err.message}`);
        sendOpenAIError(res, 500, `Gateway DB Error: ${err.message}`);
        return;
    }

    const cleanBody = { ...body };
    delete cleanBody.user;
    delete cleanBody.metadata;
    delete cleanBody.chat_id;
    delete cleanBody.session_id;
    delete cleanBody.conversation_id;
    delete cleanBody.tool_ids;

    try {
        const upstream = await fetch(`${config.newApiBaseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${finalKey}`,
            },
            body: JSON.stringify(cleanBody),
        });

        if (upstream.status === 401) {
            const errText = await upstream.text();
            logger.warn(`[chat] Token for ${email} was rejected (401) by NewAPI. Response: ${errText}`);
            res.status(401).send(errText);
            return;
        }

        res.status(upstream.status);
        upstream.headers.forEach((val, key) => {
            res.setHeader(key, val);
        });

        if (upstream.body) {
            const reader = upstream.body.getReader();
            const pump = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        res.write(value);
                    }
                } finally {
                    res.end();
                }
            };
            pump();
        } else {
            res.end();
        }
    } catch (error: any) {
        logger.error('[chat] Upstream proxy error:', error);
        sendOpenAIError(res, 500, error.message);
    }
}

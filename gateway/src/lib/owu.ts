import crypto from 'crypto';
import fs from 'fs';
import { config } from '../config';
import { db } from './db';
import { logger } from './logger';

let owuTokenCache: string | null = null;

export async function owuRequest(
    method: string,
    path: string,
    body?: any,
    contentType?: string,
    timeoutMs?: number,
): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (contentType) headers['Content-Type'] = contentType;
    if (owuTokenCache) headers['Authorization'] = `Bearer ${owuTokenCache}`;

    const isJson = !contentType || contentType.includes('json');
    const reqBody = body instanceof Buffer || typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined;
    if (isJson && reqBody && !contentType) headers['Content-Type'] = 'application/json';

    const url = config.openWebuiBaseUrl + path;
    const timeout = timeoutMs ?? config.openWebuiTimeoutSeconds * 1000;
    let res = await fetch(url, {
        method,
        headers,
        body: reqBody,
        signal: AbortSignal.timeout(timeout),
    });

    if (
        res.status === 401 &&
        config.openWebuiEmail &&
        config.openWebuiPassword &&
        owuTokenCache !== config.openWebuiToken
    ) {
        await owuSignIn();
        headers['Authorization'] = `Bearer ${owuTokenCache}`;
        res = await fetch(url, {
            method,
            headers,
            body: reqBody,
            signal: AbortSignal.timeout(timeout),
        });
    }

    const text = await res.text();
    let data: any = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }
    return { status: res.status, data };
}

export async function owuSignIn(): Promise<string> {
    const { status, data } = await owuRequest('POST', '/api/v1/auths/signin', {
        email: config.openWebuiEmail,
        password: config.openWebuiPassword,
    });
    if (status !== 200 || !data.token) {
        throw new Error('Open WebUI sign-in failed: ' + (data.detail || data.message || status));
    }
    owuTokenCache = data.token;
    return data.token;
}

export async function owuGetAdminToken(): Promise<string> {
    if (owuTokenCache) return owuTokenCache;
    if (config.openWebuiToken) {
        owuTokenCache = config.openWebuiToken;
        return owuTokenCache;
    }
    return owuSignIn();
}

export async function owuListCollections(page = 1): Promise<{ items: any[]; total: number }> {
    await owuGetAdminToken();
    const { data } = await owuRequest('GET', `/api/v1/knowledge/?page=${page}`);
    return { items: data?.items || [], total: data?.total || 0 };
}

export async function owuListAllCollections(): Promise<any[]> {
    await owuGetAdminToken();
    const all: any[] = [];
    let page = 1;
    while (true) {
        const { items, total } = await owuListCollections(page);
        if (!items.length) break;
        all.push(...items);
        if (all.length >= total) break;
        page++;
        if (page > 100) break;
    }
    return all;
}

export async function owuCreateCollection(name: string, ownerUserId?: string): Promise<any> {
    await owuGetAdminToken();
    const payload: Record<string, any> = {
        name,
        description: '',
        data: {},
        access_control: {},
    };
    if (ownerUserId) payload.user_id = ownerUserId;
    const { status, data } = await owuRequest('POST', '/api/v1/knowledge/create', payload);
    if (status !== 200 && status !== 201) {
        throw new Error(`OWU create collection failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
}

export async function owuDeleteCollection(id: string): Promise<void> {
    await owuGetAdminToken();
    try {
        await owuRequest('DELETE', `/api/v1/knowledge/${encodeURIComponent(id)}/delete`);
    } catch (e: any) {
        if (!e.message?.includes('not found')) throw e;
    }
}

export function getCollectionOWUDisplayName(
    name: string,
    isDefault: boolean,
    userName: string,
    email: string,
): string {
    if (!isDefault) return name;
    const displayName = (userName || '').trim() || email.split('@')[0] || email;
    return `RAG（${displayName}）`;
}

export async function owuUpdateCollection(
    id: string,
    payload: { name?: string; description?: string; access_grants?: any[]; user_id?: string },
): Promise<any> {
    await owuGetAdminToken();
    const { status, data } = await owuRequest('POST', `/api/v1/knowledge/${encodeURIComponent(id)}/update`, payload);
    if (status !== 200 && status !== 201) {
        throw new Error(`OWU update collection failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
}

export async function owuListUsers(): Promise<any[]> {
    await owuGetAdminToken();
    const { data } = await owuRequest('GET', '/api/v1/users/all');
    if (Array.isArray(data)) return data;
    return data?.users || data?.items || [];
}

export async function owuFindUserIdByEmail(email: string): Promise<string | null> {
    const users = await owuListUsers();
    const user = users.find((u: any) => (u.email || '').toLowerCase() === email.toLowerCase());
    return user?.id || null;
}

export async function owuGetUserByEmail(
    email: string,
): Promise<{ id: string; name: string; email: string; role: string } | null> {
    const users = await owuListUsers();
    const user = users.find((u: any) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!user?.id) return null;
    return { id: user.id, name: user.name || email, email: user.email, role: user.role };
}

export async function owuGetFullUserByEmail(email: string): Promise<any | null> {
    const users = await owuListUsers();
    const user = users.find((u: any) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!user?.id) return null;
    return {
        id: user.id,
        name: user.name || email,
        email: user.email,
        role: user.role,
        profile_image_url: user.profile_image_url || '',
        bio: user.bio || '',
        gender: user.gender || '',
    };
}

export async function owuUpdateUserProfile(
    userId: string,
    data: { name?: string; profile_image_url?: string; bio?: string; gender?: string },
): Promise<any> {
    await owuGetAdminToken();
    const body: Record<string, any> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.profile_image_url !== undefined) body.profile_image_url = data.profile_image_url;
    if (data.bio !== undefined) body.bio = data.bio;
    if (data.gender !== undefined) body.gender = data.gender;
    const { status, data: resp } = await owuRequest('POST', `/api/v1/users/${encodeURIComponent(userId)}/update`, body);
    if (status !== 200 && status !== 201) {
        throw new Error(`OWU profile update failed (${status}): ${JSON.stringify(resp).slice(0, 200)}`);
    }
    return resp;
}

export async function owuDeleteFile(fileId: string): Promise<void> {
    await owuGetAdminToken();
    const { status } = await owuRequest(
        'DELETE',
        `/api/v1/files/${encodeURIComponent(fileId)}`,
        undefined,
        undefined,
        config.owuUploadTimeoutSeconds * 1000,
    );
    if (status !== 200 && status !== 204) {
        logger.error(`[owu] delete file ${fileId} returned ${status}`);
    }
}

export async function owuSafeDeleteFile(owuFileId: string, owuCollectionId?: string): Promise<void> {
    if (!owuFileId) return;
    if (owuCollectionId) {
        try {
            await owuRequest(
                'POST',
                `/api/v1/knowledge/${encodeURIComponent(owuCollectionId)}/file/remove`,
                { file_id: owuFileId },
            );
        } catch (e: any) {
            logger.error(`[owu] failed to remove file ${owuFileId} from collection: ${e.message}`);
        }
    }
    try {
        await owuDeleteFile(owuFileId);
    } catch (e: any) {
        logger.error(`[owu] failed to delete OWU file ${owuFileId}: ${e.message}`);
    }
}

export async function owuUploadFile(filePath: string, fileName: string): Promise<string> {
    await owuGetAdminToken();
    const fileData = fs.readFileSync(filePath);
    const boundary = '----OwUBoundary' + crypto.randomBytes(8).toString('hex');
    const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        fileData,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const { status, data } = await owuRequest(
        'POST',
        '/api/v1/files/',
        payload,
        `multipart/form-data; boundary=${boundary}`,
        config.owuUploadTimeoutSeconds * 1000,
    );
    if (!data.id) throw new Error('OWU upload failed, no file id returned');
    return data.id;
}

export async function owuPollFileProcess(fileId: string): Promise<'completed' | 'failed'> {
    const start = Date.now();
    const timeout = config.owuPollTimeoutSeconds * 1000;
    while (Date.now() - start < timeout) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
            const { status, data } = await owuRequest('GET', `/api/v1/files/${encodeURIComponent(fileId)}/process/status`);
            if (data?.status === 'completed') return 'completed';
            if (data?.status === 'failed') return 'failed';
        } catch (e: any) {
            logger.error('[owu] poll error:', e.message);
        }
    }
    try {
        const { data } = await owuRequest('GET', `/api/v1/files/${encodeURIComponent(fileId)}/process/status`);
        if (data?.status === 'completed') return 'completed';
    } catch (e: any) {
        logger.error('[owu] final poll error:', e.message);
    }
    return 'failed';
}

export async function owuAddFileToCollection(collectionId: string, fileId: string): Promise<void> {
    await owuGetAdminToken();
    const { status, data } = await owuRequest(
        'POST',
        `/api/v1/knowledge/${encodeURIComponent(collectionId)}/file/add`,
        { file_id: fileId },
        undefined,
        config.owuUploadTimeoutSeconds * 1000,
    );
    if (status !== 200 && status !== 201) {
        throw new Error(`OWU add file to collection failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
}

export async function owuUpdateReaders(collectionId: string, readerUserIds: string[]): Promise<void> {
    await owuGetAdminToken();
    const accessGrants = readerUserIds.map((uid) => ({
        principal_type: 'user',
        principal_id: uid,
        permission: 'read',
    }));
    const { status, data } = await owuRequest('POST', `/api/v1/knowledge/${encodeURIComponent(collectionId)}/access/update`, {
        access_grants: accessGrants,
    });
    if (status < 200 || status >= 300) {
        throw new Error(`OWU collection access update failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
}

export async function owuFindModelById(modelId: string): Promise<any | null> {
    await owuGetAdminToken();
    const { status, data } = await owuRequest('GET', `/api/v1/models/model?id=${encodeURIComponent(modelId)}`);
    if (status !== 200 || !data) return null;
    return data;
}

export async function owuCreateModel(
    id: string,
    name: string,
    baseModelId: string,
    knowledge: { id: string; name: string; type?: string; user_id?: string }[],
    params: Record<string, any>,
    owuUserId: string,
): Promise<any> {
    await owuGetAdminToken();
    const payload = {
        id,
        name,
        base_model_id: baseModelId,
        meta: {
            description: null,
            capabilities: config.ragCapabilities as Record<string, boolean>,
            knowledge: knowledge || [],
        },
        params,
        is_active: true,
        access_grants: owuUserId ? [{ principal_type: 'user', principal_id: owuUserId, permission: 'read' }] : undefined,
        user_id: owuUserId || undefined,
    };
    const { status, data } = await owuRequest('POST', '/api/v1/models/create', payload);
    if (status !== 200 && status !== 201) {
        throw new Error(`OWU create model failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
}

export async function owuUpdateModel(
    id: string,
    name: string,
    baseModelId: string,
    knowledge: { id: string; name: string; type?: string; user_id?: string }[],
    params: Record<string, any>,
    owuUserId: string,
): Promise<any> {
    await owuGetAdminToken();
    try {
        await owuRequest('POST', '/api/v1/models/model/delete', { id });
    } catch (e: any) {
        /* ignore */
    }
    const payload = {
        id,
        name,
        base_model_id: baseModelId,
        meta: {
            description: null,
            capabilities: config.ragCapabilities as Record<string, boolean>,
            knowledge: knowledge || [],
        },
        params,
        is_active: true,
        access_grants: owuUserId ? [{ principal_type: 'user', principal_id: owuUserId, permission: 'read' }] : undefined,
        user_id: owuUserId || undefined,
    };
    const { status, data } = await owuRequest('POST', '/api/v1/models/create', payload);
    if (status !== 200 && status !== 201) {
        throw new Error(`OWU recreate model failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
}

export async function owuSetModelReaders(modelId: string, owuUserId: string): Promise<void> {
    await owuGetAdminToken();
    await owuRequest('POST', '/api/v1/models/model/access/update', {
        id: modelId,
        access_grants: [{ principal_type: 'user', principal_id: owuUserId, permission: 'read' }],
    });
}

const syncLocks = new Map<string, Promise<void>>();

export async function syncCollectionToOWU(email: string, collectionId: string): Promise<void> {
    const key = `${email}:${collectionId}`;
    if (syncLocks.has(key)) return syncLocks.get(key);
    const p = syncCollectionToOWUImpl(email, collectionId);
    syncLocks.set(key, p);
    try {
        await p;
    } finally {
        syncLocks.delete(key);
    }
}

async function syncCollectionToOWUImpl(email: string, collectionId: string): Promise<void> {
    try {
        await owuGetAdminToken();
        const col = db
            .prepare('SELECT name, is_default, owu_collection_id FROM collections WHERE id = ? AND user_email = ?')
            .get(collectionId, email) as any;
        if (!col) return;

        const user = await owuGetUserByEmail(email);
        if (!user) {
            logger.warn(`[owu] user not found while syncing collection: ${email}`);
            return;
        }

        const displayName = getCollectionOWUDisplayName(col.name, !!col.is_default, user.name, user.email);

        let owuColId = col.owu_collection_id;
        if (!owuColId) {
            const created = await owuCreateCollection(displayName, user.id);
            owuColId = created?.id;
            if (owuColId) {
                db.prepare('UPDATE collections SET owu_collection_id = ? WHERE id = ?').run(owuColId, collectionId);
            }
        }

        if (owuColId) {
            // 同步知识库显示名（默认库映射为 RAG（用户名））
            await owuUpdateCollection(owuColId, { name: displayName, description: '' });
            // 新建库 owner 已是该用户本人；对存量库（服务号代建的）仍补充读授权兜底
            await owuUpdateReaders(owuColId, [user.id]);
        }
        logger.info(`[owu] collection synced: ${displayName} (${owuColId})`);
    } catch (e: any) {
        logger.error(`[owu] sync collection failed (${email}, ${collectionId}): ${e.message}`);
    }
}


export async function owuDeleteUser(userId: string): Promise<void> {
    await owuGetAdminToken();
    try {
        const { status, data } = await owuRequest('DELETE', `/api/v1/users/${encodeURIComponent(userId)}`);
        if (status < 200 || status >= 300) {
            const msg = String(data?.detail || data?.message || data?.error || JSON.stringify(data)).slice(0, 200);
            if (!msg.includes('not found')) throw new Error(`OWU user delete failed (${status}): ${msg}`);
        }
    } catch (e: any) {
        if (!e.message?.includes('not found') && !String(e.message).includes('not found')) throw e;
    }
}

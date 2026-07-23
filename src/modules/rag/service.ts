import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import {
    owuGetUserByEmail,
    owuListCollections,
    owuFindModelById,
    owuCreateModel,
    owuUpdateModel,
    owuRequest,
} from '../../lib/owu';

const modelSyncLocks = new Map<string, Promise<void>>();

export async function syncUserModel(email: string): Promise<void> {
    const key = email.toLowerCase();
    if (modelSyncLocks.has(key)) return modelSyncLocks.get(key);
    const p = syncUserModelImpl(email);
    modelSyncLocks.set(key, p);
    try {
        await p;
    } finally {
        modelSyncLocks.delete(key);
    }
}

async function syncUserModelImpl(email: string): Promise<void> {
    if (!config.owuRagBaseModel) return;

    try {
        const user = await owuGetUserByEmail(email);
        if (!user) return;

        const cols = db
            .prepare('SELECT owu_collection_id, name FROM collections WHERE user_email = ? AND owu_collection_id IS NOT NULL')
            .all(email) as any[];
        const remoteCollections = await owuListCollections();
        const knowledge = cols.map((c: any) => {
            const remote = remoteCollections.find((k: any) => k.id === c.owu_collection_id);
            return {
                id: c.owu_collection_id,
                name: c.name,
                type: 'collection',
                user_id: remote?.user_id || user.id,
            };
        });

        const modelId = `rag_${email}`;
        const displayName = `RAG (${user.name})`;
        const params: Record<string, any> = {
            system: config.ragSystemPrompt,
            temperature: config.owuRagTemperature,
            top_k: config.owuRagTopK,
            top_p: config.owuRagTopP,
        };

        const existing = await owuFindModelById(modelId);

        if (!existing) {
            await owuCreateModel(modelId, displayName, config.owuRagBaseModel, knowledge, params, user.id);
            logger.info(`[owu] created RAG model ${displayName} (${modelId}) for ${email} with ${knowledge.length} knowledge bases`);
        } else {
            const curKnowledge = existing.meta?.knowledge || [];
            const curIdSet = JSON.stringify(
                [...new Set(curKnowledge.map((k: any) => `${k.id}:${k.user_id || ''}`))].sort(),
            );
            const newIdSet = JSON.stringify([...new Set(knowledge.map((k) => `${k.id}:${k.user_id || ''}`))].sort());
            const needsUpdate = curIdSet !== newIdSet || curKnowledge.length !== knowledge.length;

            if (needsUpdate) {
                const existingParams = existing.params && typeof existing.params === 'object' ? existing.params : params;
                await owuUpdateModel(modelId, displayName, config.owuRagBaseModel, knowledge, existingParams, user.id);
                logger.info(`[owu] updated RAG model knowledge for ${email}, now ${knowledge.length} bases`);
            }
        }

        owuRequest('GET', '/api/models?refresh=true').catch(() => {});
    } catch (e: any) {
        logger.error(`[owu] syncUserModel failed for ${email}:`, e.message);
    }
}

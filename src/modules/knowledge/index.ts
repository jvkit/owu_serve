import fs from 'fs';
import type { Express, Request, Response } from 'express';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { handleError } from '../../lib/errors';
import { requireAuth } from '../../lib/auth';
import { ensureUserStorage, renewUserStorage } from '../../lib/user';
import { utcNow, randomId } from '../../lib/utils';
import { checkAndApplyPlanCycle } from '../plans/service';
import { syncUserModel } from '../rag/service';
import { owuDeleteCollection, syncCollectionToOWU } from '../../lib/owu';
import { config, SUPPORTED_EXTENSIONS, OCR_EXTENSIONS, PASSTHROUGH_EXTENSIONS } from '../../config';
import { collectionDir, getEmailFromRequest, getTokenFromRequest } from '../files/service';

function serializeCollection(c: any) {
    return { id: c.id, name: c.name, isDefault: !!c.is_default, createdAt: c.created_at };
}

export function knowledgeModule(app: Express) {
    app.get('/api/files/collections', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            ensureUserStorage(email);
            checkAndApplyPlanCycle(email);

            let collections = db.prepare('SELECT * FROM collections WHERE user_email = ? ORDER BY created_at').all(email) as any[];
            if (collections.length === 0) {
                const now = utcNow();
                const kcId = randomId('kc');
                db.prepare('INSERT OR IGNORE INTO collections (id, user_email, name, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(kcId, email, '默认知识库', now, now);
                collections = db.prepare('SELECT * FROM collections WHERE user_email = ?').all(email) as any[];
                syncCollectionToOWU(email, kcId)
                    .then(() => syncUserModel(email))
                    .catch((e: any) => logger.error('[owu] default collection/model sync failed:', e.message));
            }
            const storage = db.prepare('SELECT * FROM user_storage WHERE user_email = ?').get(email) as any;
            res.json({
                ok: true,
                collections: collections.map(serializeCollection),
                storage: { used: storage.storage_used, quota: storage.storage_quota },
                supportedExtensions: {
                    all: Array.from(SUPPORTED_EXTENSIONS).sort(),
                    ocr: Array.from(OCR_EXTENSIONS).sort(),
                    passthrough: Array.from(PASSTHROUGH_EXTENSIONS).sort(),
                },
                maxFilenameChars: config.maxFilenameChars,
            });
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.post('/api/files/collections', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const name = (req.body.name || '').trim();
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            checkAndApplyPlanCycle(email);
            const planStatus = db.prepare('SELECT status FROM user_plans WHERE user_email = ?').get(email) as any;
            if (planStatus?.status === 'inactive') { res.status(403).json({ ok: false, error: '套餐已过期，无法新建知识库' }); return; }
            if (!name || name.length > 80) { res.status(400).json({ ok: false, error: 'Invalid collection name' }); return; }

            const existing = db.prepare('SELECT id FROM collections WHERE user_email = ? AND name = ?').get(email, name);
            if (existing) { res.status(409).json({ ok: false, error: 'Collection already exists' }); return; }

            const now = utcNow();
            const kcId = randomId('kc');
            db.prepare('INSERT INTO collections (id, user_email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(kcId, email, name, now, now);
            res.json({
                ok: true,
                collection: { id: kcId, name, isDefault: false, createdAt: now },
                collections: db.prepare('SELECT id, name, is_default, created_at, updated_at FROM collections WHERE user_email = ? ORDER BY created_at ASC').all(email),
            });
            syncCollectionToOWU(email, kcId)
                .then(() => syncUserModel(email))
                .catch((e: any) => logger.error('[owu] sync after collection create failed:', e.message));
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.delete('/api/files/collections/:id', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const collectionId = req.params.id as string;
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;

            const collection = db.prepare('SELECT * FROM collections WHERE id = ? AND user_email = ?').get(collectionId, email) as any;
            if (!collection) { res.status(404).json({ ok: false, error: 'Collection not found' }); return; }
            const owuColId = collection.owu_collection_id;

            const dirPath = collectionDir(email, collectionId);
            if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true });

            db.transaction(() => {
                db.prepare('DELETE FROM files WHERE collection_id = ? AND user_email = ?').run(collectionId, email);
                db.prepare('DELETE FROM collections WHERE id = ? AND user_email = ?').run(collectionId, email);
                renewUserStorage(email);

                const remaining = db.prepare('SELECT COUNT(*) as cnt FROM collections WHERE user_email = ?').get(email) as any;
                if (!remaining || remaining.cnt === 0) {
                    const kcId = randomId('kc');
                    db.prepare('INSERT OR IGNORE INTO collections (id, user_email, name, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(kcId, email, '默认知识库', utcNow(), utcNow());
                    syncCollectionToOWU(email, kcId).catch((e: any) => logger.error('[owu] default sync failed:', e.message));
                }
            })();

            res.json({ ok: true, collections: db.prepare('SELECT id, name, is_default, created_at, updated_at FROM collections WHERE user_email = ? ORDER BY created_at ASC').all(email) });
            if (owuColId) { owuDeleteCollection(owuColId).catch((e: any) => logger.error('[owu] delete collection failed:', e.message)); }
            syncUserModel(email).catch((e: any) => logger.error('[owu] model update failed:', e.message));
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.post('/api/files/collections/:id/delete', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const collectionId = req.params.id as string;
            if (!email || !collectionId) { res.status(400).json({ ok: false, error: 'Email and collection ID required' }); return; }
            if (!requireAuth(req, res, email, token)) return;

            const collection = db.prepare('SELECT * FROM collections WHERE id = ? AND user_email = ?').get(collectionId, email) as any;
            if (!collection) { res.status(404).json({ ok: false, error: 'Collection not found' }); return; }
            const owuColId = collection.owu_collection_id;

            const dirPath = collectionDir(email, collectionId);
            if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true });

            db.transaction(() => {
                db.prepare('DELETE FROM files WHERE collection_id = ? AND user_email = ?').run(collectionId, email);
                db.prepare('DELETE FROM collections WHERE id = ? AND user_email = ?').run(collectionId, email);
                renewUserStorage(email);

                const remaining = db.prepare('SELECT COUNT(*) as cnt FROM collections WHERE user_email = ?').get(email) as any;
                if (!remaining || remaining.cnt === 0) {
                    const kcId = randomId('kc');
                    db.prepare('INSERT OR IGNORE INTO collections (id, user_email, name, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(kcId, email, '默认知识库', utcNow(), utcNow());
                    syncCollectionToOWU(email, kcId).catch((e: any) => logger.error('[owu] default sync failed:', e.message));
                }
            })();

            res.json({ ok: true, collections: db.prepare('SELECT id, name, is_default, created_at, updated_at FROM collections WHERE user_email = ? ORDER BY created_at ASC').all(email) });
            if (owuColId) { owuDeleteCollection(owuColId).catch((e: any) => logger.error('[owu] delete collection failed:', e.message)); }
            syncUserModel(email).catch((e: any) => logger.error('[owu] model update failed:', e.message));
        } catch (e: any) {
            handleError(res, e);
        }
    });
}

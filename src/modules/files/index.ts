import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { config, SUPPORTED_EXTENSIONS, OCR_EXTENSIONS, PASSTHROUGH_EXTENSIONS } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { handleError } from '../../lib/errors';
import { requireAuth } from '../../lib/auth';
import { ensureUserStorage, getUserStorage } from '../../lib/user';
import { utcNow, randomId } from '../../lib/utils';
import { checkAndApplyPlanCycle } from '../plans/service';
import {
    fileExtension,
    parseStrategyFor,
    normalizeFilename,
    parsedNameFor,
    originalDir,
    parsedDir,
    parseMultipart,
    getEmailFromRequest,
    getTokenFromRequest,
    serializeFile,
    deleteLocalFile,
} from './service';
import { enqueueOcrParse, enqueueOwuBuild, rebuildFileToOWU } from './workers';

export function filesModule(app: Express) {
    app.delete('/api/files/:id', async (req: Request, res: Response) => {
        try {
            const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
            const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            const fileId = req.params.id as string;

            await deleteLocalFile(email, fileId);
            res.json({ ok: true });
        } catch (e: any) {
            if (e.status === 404) { res.status(404).json({ ok: false, error: e.message }); return; }
            handleError(res, e);
        }
    });

    app.post('/api/files/upload', express.raw({ type: 'multipart/form-data', limit: config.maxUploadBytes }), async (req: Request, res: Response) => {
        try {
            const raw = req.body as Buffer;
            if (!Buffer.isBuffer(raw) || raw.length === 0) {
                res.status(400).json({ ok: false, error: 'Empty upload' }); return;
            }
            const contentType = req.headers['content-type'] || '';
            const boundaryMatch = contentType.match(/boundary=(.+)/);
            if (!boundaryMatch) {
                res.status(400).json({ ok: false, error: 'Multipart boundary missing' }); return;
            }
            const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');

            const parts = parseMultipart(req, boundary);
            if (parts.fileParts.length !== 1) {
                res.status(400).json({ ok: false, error: 'Exactly one file required' }); return;
            }

            const collectionId = parts.fields['collectionId'] || '';
            const requestedName = parts.fields['name'] || parts.fileParts[0].name;
            const email = (parts.fields['email'] || '').trim().toLowerCase();
            const token = (parts.fields['token'] || '').trim();
            const duplicateAction = parts.fields['duplicateAction'] || 'create';
            const targetFileId = parts.fields['targetFileId'] || '';

            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            checkAndApplyPlanCycle(email);
            const plan = db.prepare('SELECT status FROM user_plans WHERE user_email = ?').get(email) as any;
            if (plan?.status === 'inactive') { res.status(403).json({ ok: false, error: '套餐已过期，无法上传文件' }); return; }
            if (!collectionId) { res.status(400).json({ ok: false, error: 'Collection ID required' }); return; }
            if (!['create', 'replace'].includes(duplicateAction)) { res.status(400).json({ ok: false, error: 'Invalid duplicate action' }); return; }

            const collection = db.prepare('SELECT * FROM collections WHERE id = ? AND user_email = ?').get(collectionId, email) as any;
            if (!collection) { res.status(404).json({ ok: false, error: 'Collection not found' }); return; }

            const normalized = normalizeFilename(requestedName);
            if (normalized.error) {
                res.status(normalized.error.code === 'unsupported_file_type' ? 415 : 400).json({ ok: false, ...normalized.error }); return;
            }

            const name = normalized.name!;
            const strategy = parseStrategyFor(name);
            if (!strategy) { res.status(415).json({ ok: false, error: 'Unsupported file type' }); return; }

            const payload = parts.fileParts[0].data;
            ensureUserStorage(email);
            const storage = db.prepare('SELECT * FROM user_storage WHERE user_email = ?').get(email) as any;
            const fileCount = (db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(email) as any).count;

            const now = utcNow();
            let fileId: string;
            let oldSizeForReplace = 0;
            let isReplace = false;
            let replaceTmpDir = '';

            const existingFiles = db.prepare('SELECT * FROM files WHERE user_email = ? AND collection_id = ? AND name = ?').all(email, collectionId, name) as any[];

            if (duplicateAction === 'replace' && targetFileId) {
                const target = existingFiles.find((f: any) => f.id === targetFileId);
                if (!target) { res.status(409).json({ ok: false, error: 'Target file not found for replacement' }); return; }
                oldSizeForReplace = target.size;
                if (storage.storage_used - oldSizeForReplace + payload.length > storage.storage_quota) {
                    res.status(413).json({ ok: false, error: '存储空间不足' }); return;
                }
                fileId = targetFileId;
                isReplace = true;
                replaceTmpDir = originalDir(email, collectionId, fileId) + '_tmp';
                if (fs.existsSync(replaceTmpDir)) fs.rmSync(replaceTmpDir, { recursive: true });
                fs.mkdirSync(replaceTmpDir, { recursive: true });
            } else {
                if (existingFiles.length > 0) {
                    res.status(409).json({ ok: false, error: 'File already exists', existingFile: { fileId: existingFiles[0].id, name } }); return;
                }
                if (storage.storage_used + payload.length > storage.storage_quota) {
                    res.status(413).json({ ok: false, error: '存储空间不足' }); return;
                }
                if (fileCount >= storage.file_count_quota) {
                    res.status(413).json({ ok: false, error: '文件数量已达上限' }); return;
                }
                fileId = randomId('file');
            }

            const origDir = originalDir(email, collectionId, fileId);
            const diskPath = path.join(isReplace ? replaceTmpDir : origDir, name);
            if (!isReplace) {
                fs.mkdirSync(origDir, { recursive: true });
                fs.writeFileSync(path.join(origDir, name), payload);
            } else {
                fs.writeFileSync(path.join(replaceTmpDir, name), payload);
                const oldParsed = parsedDir(email, collectionId, fileId);
                if (fs.existsSync(oldParsed)) fs.rmSync(oldParsed, { recursive: true });
            }

            let parsedPathVal = '';
            let status = 'uploaded';
            let progressVal = 10;
            if (strategy === 'passthrough') {
                const parseDir = parsedDir(email, collectionId, fileId);
                fs.mkdirSync(parseDir, { recursive: true });
                parsedPathVal = path.join(parseDir, name);
                fs.writeFileSync(parsedPathVal, payload);
                status = 'parsed';
                progressVal = 100;
            }

            let booked = false;
            try {
                db.transaction(() => {
                    if (isReplace) {
                        db.prepare(`UPDATE files SET name = ?, size = ?, parse_strategy = ?, status = ?, progress = ?, error = NULL, disk_path = ?, parsed_path = ?, source_ext = ?, updated_at = ? WHERE id = ?`)
                            .run(name, payload.length, strategy, status, progressVal, path.join(origDir, name), parsedPathVal, fileExtension(name), now, fileId);
                    } else {
                        db.prepare(`INSERT INTO files (id, user_email, collection_id, name, size, parse_strategy, status, progress, ocr_task_id, error, disk_path, parsed_path, source_ext, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`)
                            .run(fileId, email, collectionId, name, payload.length, strategy, status, progressVal, diskPath, parsedPathVal || '', fileExtension(name), now, now);
                    }

                    const result = (() => {
                        if (isReplace) {
                            return db.prepare(
                                `UPDATE user_storage SET storage_used = storage_used - ? + ?, updated_at = ? 
                                 WHERE user_email = ? AND storage_quota >= storage_used - ? + ?`
                            ).run(oldSizeForReplace, payload.length, now, email, oldSizeForReplace, payload.length);
                        } else {
                            return db.prepare(
                                `UPDATE user_storage SET storage_used = storage_used + ?, updated_at = ? 
                                 WHERE user_email = ? AND storage_quota >= storage_used + ?`
                            ).run(payload.length, now, email, payload.length);
                        }
                    })();
                    if (result.changes === 0) throw new Error('QUOTA_EXCEEDED');
                    booked = true;
                })();
            } catch (e: any) {
                if (e.message !== 'QUOTA_EXCEEDED') throw e;
            }

            if (!booked) {
                if (isReplace) {
                    fs.rmSync(replaceTmpDir, { recursive: true });
                } else {
                    if (fs.existsSync(origDir)) fs.rmSync(origDir, { recursive: true });
                }
                res.status(413).json({ ok: false, error: '存储空间不足' }); return;
            }

            if (isReplace) {
                if (fs.existsSync(origDir)) fs.rmSync(origDir, { recursive: true });
                fs.renameSync(replaceTmpDir, origDir);
            }

            if (strategy === 'ocr') {
                enqueueOcrParse(email, collectionId, fileId);
            }
            if (strategy === 'passthrough') {
                enqueueOwuBuild(email, collectionId, fileId);
            }

            const uploaded = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
            res.json({
                ok: true,
                file: {
                    fileId: uploaded.id,
                    collectionId: uploaded.collection_id,
                    name: uploaded.name,
                    size: uploaded.size,
                    parseStrategy: uploaded.parse_strategy,
                    status: uploaded.status,
                    progress: uploaded.progress,
                    createdAt: uploaded.created_at,
                    updatedAt: uploaded.updated_at,
                    error: uploaded.error,
                    requestedName: normalized.name,
                    nameChanged: normalized.nameChanged,
                    notice: normalized.notice,
                }
            });
        } catch (e: any) {
            logger.error('[files] upload error:', e);
            handleError(res, e);
        }
    });

    app.get('/api/files/list', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const collectionId = typeof req.query.collectionId === 'string' ? req.query.collectionId : '';
            const query = typeof req.query.q === 'string' ? req.query.q : '';
            if (!email || !collectionId) { res.status(400).json({ ok: false, error: 'Email and collection ID required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            checkAndApplyPlanCycle(email);

            let rows;
            if (query) {
                rows = db.prepare('SELECT * FROM files WHERE user_email = ? AND collection_id = ? AND name LIKE ? ORDER BY created_at DESC').all(email, collectionId, '%' + query + '%');
            } else {
                rows = db.prepare('SELECT * FROM files WHERE user_email = ? AND collection_id = ? ORDER BY created_at DESC').all(email, collectionId);
            }

            res.json({ ok: true, files: (rows as any[]).map(serializeFile) });
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.get('/api/files/usage', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            ensureUserStorage(email);
            checkAndApplyPlanCycle(email);
            const storage = db.prepare('SELECT storage_quota, storage_used, file_count_quota FROM user_storage WHERE user_email = ?').get(email) as any;
            const fileCount = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_email = ?').get(email) as any;
            res.json({ ok: true, used: storage.storage_used, quota: storage.storage_quota, file_count_quota: storage.file_count_quota, file_count_used: fileCount?.count || 0 });
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.get('/api/files/:id', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const fileId = req.params.id as string;
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;

            const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_email = ?').get(fileId, email) as any;
            if (!file) { res.status(404).json({ ok: false, error: 'File not found' }); return; }

            res.json({ ok: true, file: serializeFile(file) });
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.get('/api/files/:id/download', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const fileId = req.params.id as string;
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;

            const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_email = ?').get(fileId, email) as any;
            if (!file || !file.disk_path) { res.status(404).json({ ok: false, error: 'File not found' }); return; }
            if (!fs.existsSync(file.disk_path)) { res.status(404).json({ ok: false, error: 'Original file not found on disk' }); return; }

            res.download(file.disk_path, file.name);
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.post('/api/files/validate-names', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const collectionId = (req.body.collectionId || '').trim();
            const filesInput = req.body.files || [];
            if (!email || !collectionId) { res.status(400).json({ ok: false, error: 'Email and collection ID required' }); return; }
            if (!requireAuth(req, res, email, token)) return;

            const results: any[] = [];
            const seen: Record<string, string> = {};
            const existingFiles = db.prepare('SELECT name, id FROM files WHERE user_email = ? AND collection_id = ?').all(email, collectionId) as any[];
            const existingNames = new Map(existingFiles.map((f: any) => [f.name, f.id]));

            for (const item of filesInput) {
                const clientId = item.clientId || randomId('tmp');
                const requestedName = item.name || '';
                const normalized = normalizeFilename(requestedName);
                const result: any = { clientId, requestedName, name: normalized.name, nameChanged: normalized.nameChanged, notice: normalized.notice, error: normalized.error, conflict: false };

                if (normalized.name && !normalized.error) {
                    const existingFileId = existingNames.get(normalized.name);
                    if (existingFileId) {
                        result.conflict = true;
                        result.existingFile = { fileId: existingFileId, name: normalized.name };
                    } else if (seen[normalized.name]) {
                        result.conflict = true;
                        result.conflictWithClientId = seen[normalized.name];
                        result.error = { code: 'duplicate_in_selection', message: '本次选择中存在重复文件名。' };
                    } else {
                        seen[normalized.name] = clientId;
                    }
                }
                results.push(result);
            }

            res.json({ ok: true, files: results });
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.post('/api/files/:id/retry-parse', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const id = req.params.id as string;
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_email = ?').get(id, email) as any;
            if (!file) { res.status(404).json({ ok: false, error: 'File not found' }); return; }
            if (file.status === 'parsing') { res.status(409).json({ ok: false, error: 'File is being parsed' }); return; }
            if (file.parse_strategy === 'passthrough') {
                if (fs.existsSync(file.disk_path)) {
                    fs.mkdirSync(path.dirname(file.parsed_path || ''), { recursive: true });
                    fs.copyFileSync(file.disk_path, file.parsed_path || '');
                }
                db.prepare('UPDATE files SET status = ?, progress = 100, error = NULL, updated_at = ? WHERE id = ?').run('parsed', utcNow(), id);
                enqueueOwuBuild(email, file.collection_id, id);
            } else {
                if (file.parsed_path && fs.existsSync(file.parsed_path)) fs.unlinkSync(file.parsed_path);
                db.prepare('UPDATE files SET status = ?, progress = 10, ocr_task_id = NULL, error = NULL, updated_at = ? WHERE id = ?').run('uploaded', utcNow(), id);
                enqueueOcrParse(email, file.collection_id, id);
            }
            const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
            res.json({ ok: true, file: updated });
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.post('/api/files/:id/rebuild', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const id = req.params.id as string;
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;
            const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_email = ?').get(id, email) as any;
            if (!file) { res.status(404).json({ ok: false, error: 'File not found' }); return; }
            db.prepare('UPDATE files SET owu_status = ?, owu_error = NULL, updated_at = ? WHERE id = ?').run('build_queued', utcNow(), id);
            const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
            res.json({ ok: true, file: updated });
            rebuildFileToOWU(email, file.collection_id, id).catch((e: any) => logger.error('[owu] async rebuild failed:', e.message));
        } catch (e: any) {
            handleError(res, e);
        }
    });

    app.post('/api/files/:id/delete', async (req: Request, res: Response) => {
        try {
            const email = getEmailFromRequest(req);
            const token = getTokenFromRequest(req);
            const fileId = req.params.id as string;
            if (!email) { res.status(400).json({ ok: false, error: 'Email required' }); return; }
            if (!requireAuth(req, res, email, token)) return;

            await deleteLocalFile(email, fileId);
            res.json({ ok: true });
        } catch (e: any) {
            if (e.status === 404) { res.status(404).json({ ok: false, error: e.message }); return; }
            handleError(res, e);
        }
    });
}

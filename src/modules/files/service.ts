import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { config, OCR_EXTENSIONS, PASSTHROUGH_EXTENSIONS, SUPPORTED_EXTENSIONS } from '../../config';
import { db } from '../../lib/db';
import { utcNow, randomId } from '../../lib/utils';
import { getUserId } from '../../lib/user';
import { owuSafeDeleteFile } from '../../lib/owu';
import { logger } from '../../lib/logger';

export function fileExtension(name: string): string {
    return path.extname(name).toLowerCase();
}

export function parseStrategyFor(name: string): 'ocr' | 'passthrough' | null {
    const ext = fileExtension(name);
    if (OCR_EXTENSIONS.has(ext)) return 'ocr';
    if (PASSTHROUGH_EXTENSIONS.has(ext)) return 'passthrough';
    return null;
}

export function parsedFilenameFor(name: string, strategy: string): string {
    if (strategy === 'passthrough') return name;
    return name + '.md';
}

export function userRoot(email: string): string {
    return path.join(config.documentsDir, getUserId(email));
}

export function collectionRoot(email: string, collectionId: string): string {
    return path.join(userRoot(email), collectionId);
}

export function collectionDir(email: string, collectionId: string): string {
    return collectionRoot(email, collectionId);
}

export function fileRoot(email: string, collectionId: string, fileId: string): string {
    return path.join(collectionRoot(email, collectionId), 'files', fileId);
}

export function originalDir(email: string, collectionId: string, fileId: string): string {
    return path.join(fileRoot(email, collectionId, fileId), 'original');
}

export function parsedDir(email: string, collectionId: string, fileId: string): string {
    return path.join(fileRoot(email, collectionId, fileId), 'parsed');
}

export interface NormalizeResult {
    name: string | null;
    nameChanged: boolean;
    notice: string;
    error?: { code: string; message: string };
}

export function normalizeFilename(filename: string): NormalizeResult {
    const name = (filename || '').replace(/\\/g, '/').split('/').pop() || '';
    const sanitized = name
        .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af.\- ()\[\]]/gu, '_')
        .replace(/^[.\s]+/, '')
        .trim();
    if (!sanitized || !path.parse(sanitized).name) {
        return { name: null, nameChanged: false, notice: '', error: { code: 'invalid_filename', message: '文件名无效，请重命名后再上传。' } };
    }
    if (sanitized.length > config.maxFilenameChars) {
        return { name: null, nameChanged: false, notice: '', error: { code: 'filename_too_long', message: '文件名过长，请重命名后再上传。' } };
    }
    const ext = fileExtension(sanitized);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return { name: sanitized, nameChanged: sanitized !== filename, notice: '', error: { code: 'unsupported_file_type', message: '暂不支持该文件类型。' } };
    }
    const changed = sanitized !== filename;
    return { name: sanitized, nameChanged: changed, notice: changed ? '文件名已修正不合法字符' : '' };
}

export function parsedNameFor(name: string, strategy: string): string {
    return parsedFilenameFor(name, strategy);
}

export interface MultipartParts {
    fields: Record<string, string>;
    fileParts: { name: string; data: Buffer }[];
}

export function parseRawMultipart(raw: Buffer, boundary: string): MultipartParts {
    const fields: Record<string, string> = {};
    const fileParts: { name: string; data: Buffer }[] = [];
    const bdry = '--' + boundary;
    const bdryBuf = Buffer.from(bdry);
    const endBuf = Buffer.from(bdry + '--');

    let pos = raw.indexOf(bdryBuf);
    if (pos === -1) return { fields, fileParts };
    pos += bdryBuf.length;

    while (pos < raw.length) {
        if (raw.subarray(pos, pos + 2).toString() === '--') break;
        if (raw.subarray(pos, pos + 2).toString() === '\r\n') pos += 2;
        else if (raw.subarray(pos, pos + 1).toString() === '\n') pos += 1;

        const headerSearch = raw.subarray(pos);
        const hdrEndIdx = headerSearch.indexOf('\r\n\r\n');
        if (hdrEndIdx === -1) break;
        const hdrBuf = headerSearch.subarray(0, hdrEndIdx);
        const hdrStr = hdrBuf.toString('utf-8');
        const contentStart = pos + hdrEndIdx + 4;

        const nextBdry = raw.indexOf(bdryBuf, contentStart);
        let contentEnd = nextBdry;
        if (contentEnd === -1) {
            contentEnd = raw.indexOf(endBuf, contentStart);
            if (contentEnd === -1) contentEnd = raw.length;
        }
        if (contentEnd > 0 && raw[contentEnd - 1] === 0x0a) contentEnd--;
        if (contentEnd > 0 && raw[contentEnd - 1] === 0x0d) contentEnd--;

        const content = raw.subarray(contentStart, contentEnd);

        const nameMatch = hdrStr.match(/name="([^"]*)"/);
        const fnMatch = hdrStr.match(/filename="([^"]*)"/);
        const fieldName = nameMatch ? nameMatch[1] : '';
        const filename = fnMatch ? fnMatch[1] : '';

        if (filename && content.length > 0) {
            fileParts.push({ name: filename, data: Buffer.from(content) });
        } else if (fieldName && !filename) {
            fields[fieldName] = content.toString('utf-8').trim();
        }
        pos = contentEnd;
    }
    return { fields, fileParts };
}

export function getEmailFromRequest(req: Request): string {
    const emailFromQuery = typeof req.query.email === 'string' ? req.query.email : '';
    const emailFromBody = req.body && typeof req.body.email === 'string' ? req.body.email : '';
    return (emailFromQuery || emailFromBody).trim().toLowerCase();
}

export function getTokenFromRequest(req: Request): string {
    const tokFromQuery = typeof req.query.token === 'string' ? req.query.token : '';
    const tokFromBody = req.body && typeof req.body.token === 'string' ? req.body.token : '';
    return (tokFromQuery || tokFromBody).trim();
}

export function parseMultipart(req: Request, boundary: string): MultipartParts {
    const raw = req.body as Buffer;
    if (!raw) return { fields: {}, fileParts: [] };
    return parseRawMultipart(raw, boundary);
}

export function serializeFile(file: any): Record<string, any> {
    const statusesAfterUpload = ['uploaded', 'parsing', 'parsed', 'build_pending', 'build_done'];
    return {
        fileId: file.id,
        collectionId: file.collection_id,
        name: file.name,
        size: file.size,
        parseStrategy: file.parse_strategy,
        status: file.status,
        progress: file.progress,
        uploadProgress: file.status === 'uploading' ? file.progress : (statusesAfterUpload.includes(file.status) ? 100 : 0),
        parseProgress: file.parse_progress ?? (file.status === 'parsing' ? Math.round(Math.max(0, (file.progress - 10) / 0.9)) : (['parsed', 'build_pending', 'build_done'].includes(file.status) ? 100 : 0)),
        error: file.error,
        owuStatus: file.owu_status,
        owuError: file.owu_error,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
    };
}

export async function deleteLocalFile(email: string, fileId: string): Promise<void> {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_email = ?').get(fileId, email) as any;
    if (!file) {
        const err: any = new Error('File not found');
        err.status = 404;
        throw err;
    }

    const rootDir = fileRoot(email, file.collection_id, file.id);
    if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true });

    const now = utcNow();
    db.transaction(() => {
        db.prepare('UPDATE user_storage SET storage_used = MAX(0, storage_used - ?), updated_at = ? WHERE user_email = ?').run(file.size, now, email);
        db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    })();

    if (file.owu_file_id) {
        const col = db.prepare('SELECT owu_collection_id FROM collections WHERE id = ?').get(file.collection_id) as any;
        owuSafeDeleteFile(file.owu_file_id, col?.owu_collection_id).catch((e: any) =>
            logger.error('[files] async OWU delete failed:', e.message)
        );
    }
}

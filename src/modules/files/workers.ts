import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { utcNow } from '../../lib/utils';
import {
    owuUploadFile,
    owuPollFileProcess,
    owuAddFileToCollection,
    owuSafeDeleteFile,
    syncCollectionToOWU,
} from '../../lib/owu';
import { syncUserModel } from '../rag/service';
import { parsedDir, parsedNameFor } from './service';

interface ParseTask {
    email: string;
    collectionId: string;
    fileId: string;
}

const parseQueue: ParseTask[] = [];
let activeParses = 0;

function spawnWorkers(): void {
    while (activeParses < config.parseMaxWorkers && parseQueue.length > 0) {
        activeParses++;
        runOcrWorker().finally(() => {
            activeParses--;
            spawnWorkers();
        });
    }
}

async function runOcrWorker(): Promise<void> {
    const task = parseQueue.shift();
    if (!task) return;
    try {
        await runSingleOcrTask(task.email, task.collectionId, task.fileId);
    } catch (e: any) {
        logger.error('[ocr] worker error:', e.message);
    }
}

export function enqueueOcrParse(email: string, collectionId: string, fileId: string): void {
    parseQueue.push({ email, collectionId, fileId });
    spawnWorkers();
}

const buildQueue: ParseTask[] = [];
let activeBuilds = 0;

function spawnBuildWorkers(): void {
    while (activeBuilds < config.buildMaxWorkers && buildQueue.length > 0) {
        activeBuilds++;
        runBuildWorker().finally(() => {
            activeBuilds--;
            spawnBuildWorkers();
        });
    }
}

async function runBuildWorker(): Promise<void> {
    const task = buildQueue.shift();
    if (!task) return;
    db.prepare('UPDATE files SET owu_status = ?, updated_at = ? WHERE id = ?').run('build_pending', utcNow(), task.fileId);
    try {
        await syncFileToOWU(task.email, task.collectionId, task.fileId);
    } catch (e: any) {
        logger.error('[owu] build worker error:', e.message);
    }
}

export function enqueueOwuBuild(email: string, collectionId: string, fileId: string): void {
    db.prepare('UPDATE files SET owu_status = ?, owu_error = NULL, updated_at = ? WHERE id = ?').run('build_queued', utcNow(), fileId);
    buildQueue.push({ email, collectionId, fileId });
    spawnBuildWorkers();
}

async function runSingleOcrTask(email: string, collectionId: string, fileId: string): Promise<void> {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
    if (!file || file.parse_strategy !== 'ocr') return;

    db.prepare('UPDATE files SET status = ?, progress = 10, error = NULL, updated_at = ? WHERE id = ?').run('parsing', utcNow(), fileId);

    if (!config.ocrApiKey) {
        db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?').run(
            'parse_failed',
            JSON.stringify({ code: 'ocr_not_configured', message: 'OCR_API_KEY is not configured.' }),
            utcNow(),
            fileId,
        );
        return;
    }

    if (!fs.existsSync(file.disk_path)) {
        db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?').run(
            'parse_failed',
            JSON.stringify({ code: 'file_missing', message: 'Original file not found.' }),
            utcNow(),
            fileId,
        );
        return;
    }

    const fileData = fs.readFileSync(file.disk_path);
    const params = new URLSearchParams();
    params.set('key', config.ocrApiKey);
    params.set('filename', file.name);
    if (config.ocrVllmUrl) params.set('vllm_url', config.ocrVllmUrl);
    if (config.ocrVllmApiKey) params.set('api_key', config.ocrVllmApiKey);
    if (config.ocrModel) params.set('model', config.ocrModel);

    let taskId = '';
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.ocrTransferTimeoutSeconds * 1000);

        const createResp = await fetch(`${config.ocrTasksUrl}?${params.toString()}`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': file.source_ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
            },
            body: fileData,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const createData = (await createResp.json().catch(() => ({}))) as any;
        taskId = createData.task_id || createData.taskId || createData.id || '';

        if (createData.ok !== true && createData.ok !== undefined) {
            throw new Error('OCR task creation failed: ' + JSON.stringify(createData));
        }
        if (!taskId) throw new Error('OCR task creation returned no task ID');

        db.prepare('UPDATE files SET ocr_task_id = ?, updated_at = ? WHERE id = ?').run(taskId, utcNow(), fileId);
    } catch (e: any) {
        if (e.name === 'AbortError') {
            db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?').run(
                'parse_failed',
                JSON.stringify({ code: 'ocr_timeout', message: 'OCR request timed out.' }),
                utcNow(),
                fileId,
            );
        } else {
            db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?').run(
                'parse_failed',
                JSON.stringify({ code: 'ocr_create_failed', message: e.message }),
                utcNow(),
                fileId,
            );
        }
        return;
    }

    let success = false;
    const pollStart = Date.now();
    const pollTimeout = config.ocrPollMaxSeconds * 1000;
    while (Date.now() - pollStart < pollTimeout) {
        try {
            const pollParams = new URLSearchParams();
            pollParams.set('key', config.ocrApiKey);
            const pollResp = await fetch(`${config.ocrTasksUrl}/${encodeURIComponent(taskId)}?${pollParams.toString()}`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(config.ocrTransferTimeoutSeconds * 1000),
            });
            const statusData = (await pollResp.json().catch(() => ({}))) as any;
            const taskStatus = String(statusData.status || '').toLowerCase();

            const successStates = ['succeeded', 'success', 'completed', 'complete', 'done', 'finished'];
            const failStates = ['failed', 'failure', 'error', 'cancelled', 'canceled'];

            if (successStates.includes(taskStatus)) {
                success = true;
                break;
            }
            if (failStates.includes(taskStatus)) {
                logger.error(`[ocr] task ${taskId} failed with status: ${taskStatus}`);
                break;
            }

            const progress = Math.max(0, Math.min(100, Number(statusData.progress || 0)));
            db.prepare('UPDATE files SET progress = ?, parse_progress = ?, updated_at = ? WHERE id = ?').run(
                Math.round(10 + progress * 0.9),
                Math.round(progress),
                utcNow(),
                fileId,
            );
        } catch (e: any) {
            logger.error('[ocr] poll error:', e.message);
        }
        await new Promise((r) => setTimeout(r, config.ocrPollIntervalSeconds * 1000));
    }

    if (!success) {
        db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?').run(
            'parse_failed',
            JSON.stringify({ code: 'ocr_poll_timeout', message: 'OCR processing timed out.' }),
            utcNow(),
            fileId,
        );
        return;
    }

    try {
        const resultParams = new URLSearchParams();
        resultParams.set('key', config.ocrApiKey);
        const resultResp = await fetch(`${config.ocrTasksUrl}/${encodeURIComponent(taskId)}/result?${resultParams.toString()}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(config.ocrTimeoutSeconds * 1000),
        });
        const resultData = (await resultResp.json().catch(() => ({}))) as any;

        const markdown = resultData.result;
        if (typeof markdown !== 'string' || !markdown.trim()) {
            throw new Error('OCR result did not contain Markdown');
        }

        const parsedFileName = parsedNameFor(file.name, 'ocr');
        const parseDir = parsedDir(email, collectionId, fileId);
        fs.mkdirSync(parseDir, { recursive: true });
        const parsedPath = path.join(parseDir, parsedFileName);
        fs.writeFileSync(parsedPath, markdown, 'utf-8');

        db.prepare('UPDATE files SET status = ?, progress = 100, parsed_path = ?, error = NULL, updated_at = ? WHERE id = ?').run(
            'parsed',
            parsedPath,
            utcNow(),
            fileId,
        );

        enqueueOwuBuild(email, collectionId, fileId);
    } catch (e: any) {
        db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?').run(
            'parse_failed',
            JSON.stringify({ code: 'ocr_result_failed', message: e.message }),
            utcNow(),
            fileId,
        );
    }
}

async function syncFileToOWU(email: string, collectionId: string, fileId: string): Promise<void> {
    let owuFileId = '';
    try {
        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
        if (!file || !file.parsed_path || !fs.existsSync(file.parsed_path)) return;
        if (file.owu_status === 'build_done') return;

        db.prepare('UPDATE files SET owu_status = ?, owu_error = NULL, updated_at = ? WHERE id = ?').run('build_pending', utcNow(), fileId);

        await syncCollectionToOWU(email, collectionId);

        owuFileId = await owuUploadFile(file.parsed_path, file.parsed_path.split('/').pop() || file.name);
        db.prepare('UPDATE files SET owu_file_id = ?, updated_at = ? WHERE id = ?').run(owuFileId, utcNow(), fileId);

        const processResult = await owuPollFileProcess(owuFileId);
        if (processResult !== 'completed') {
            const col = db.prepare('SELECT owu_collection_id FROM collections WHERE id = ?').get(collectionId) as any;
            try {
                await owuSafeDeleteFile(owuFileId, col?.owu_collection_id);
            } catch (e: any) {
                logger.error('[owu] cleanup failed:', e.message);
            }
            db.prepare('UPDATE files SET owu_status = ?, owu_error = ?, owu_file_id = NULL, updated_at = ? WHERE id = ?').run(
                'build_failed',
                'OWU file processing did not complete in time',
                utcNow(),
                fileId,
            );
            return;
        }

        const col = db.prepare('SELECT owu_collection_id FROM collections WHERE id = ?').get(collectionId) as any;
        if (col?.owu_collection_id) {
            await owuAddFileToCollection(col.owu_collection_id, owuFileId);
        }

        db.prepare('UPDATE files SET owu_status = ?, updated_at = ? WHERE id = ?').run('build_done', utcNow(), fileId);
        logger.info(`[owu] file synced: ${file.name}`);
        await syncUserModel(email);
    } catch (e: any) {
        const col2 = db.prepare('SELECT owu_collection_id FROM collections WHERE id = ?').get(collectionId) as any;
        try {
            await owuSafeDeleteFile(owuFileId, col2?.owu_collection_id);
        } catch (e2: any) {
            logger.error('[owu] cleanup failed:', e2.message);
        }
        db.prepare('UPDATE files SET owu_status = ?, owu_error = ?, owu_file_id = NULL, updated_at = ? WHERE id = ?').run(
            'build_failed',
            e.message,
            utcNow(),
            fileId,
        );
        logger.error(`[owu] sync file failed: ${e.message}`);
    }
}

export async function rebuildFileToOWU(email: string, collectionId: string, fileId: string): Promise<void> {
    try {
        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
        if (!file) return;
        if (file.owu_file_id) {
            const col = db.prepare('SELECT owu_collection_id FROM collections WHERE id = ?').get(collectionId) as any;
            await owuSafeDeleteFile(file.owu_file_id, col?.owu_collection_id);
            db.prepare('UPDATE files SET owu_file_id = NULL WHERE id = ?').run(fileId);
        }
        enqueueOwuBuild(email, collectionId, fileId);
    } catch (e: any) {
        logger.error(`[owu] rebuild failed: ${e.message}`);
    }
}

(function resetPendingOcrTasks() {
    const rows = db.prepare("SELECT * FROM files WHERE status = 'parsing'").all() as any[];
    for (const r of rows) {
        db.prepare('UPDATE files SET status = ?, progress = 100, error = ?, updated_at = ? WHERE id = ?')
            .run('parse_failed', JSON.stringify({ code: 'server_restarted', message: 'Server restarted while parsing.' }), utcNow(), r.id);
    }
})();

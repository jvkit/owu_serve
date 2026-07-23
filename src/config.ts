import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const GB = 1024 * 1024 * 1024;

function readFileWithFallback(filePath: string, fallback: string): string {
    try {
        return fs.readFileSync(filePath, 'utf-8').trim();
    } catch {
        return fallback;
    }
}

function parsePlanTiers(raw: string): Record<number, { storage_quota: number; file_count_quota: number; chat_quota_usd: number }> {
    const tiers: Record<number, { storage_quota: number; file_count_quota: number; chat_quota_usd: number }> = {};
    raw.split('|').forEach((seg, i) => {
        const [gb, fc, quota] = seg.split(',').map(Number);
        tiers[i + 1] = { storage_quota: gb * GB, file_count_quota: fc, chat_quota_usd: quota };
    });
    return tiers;
}

export const config = {
    port: Number(process.env.PORT || 3019),
    nodeEnv: process.env.NODE_ENV || 'development',

    // NewAPI
    newApiBaseUrl: (process.env.NEW_API_BASEURL || 'http://192.168.30.3:3001').replace(/\/+$/, ''),
    newApiAdminAccessToken: (process.env.NEWAPI_ADMIN_ACCESS_TOKEN || '').trim(),
    newApiUsername: (process.env.NEWAPI_USERNAME || 'root').trim(),
    newApiPassword: (process.env.NEWAPI_PASSWORD || '123456').trim(),

    // Plans
    quotaPerUnit: 500000,
    planCycleDays: Number(process.env.PLAN_CYCLE_DAYS || 30),
    kbRetentionDays: Number(process.env.KB_RETENTION_DAYS || 30),
    purgeCheckIntervalSeconds: Number(process.env.PURGE_CHECK_INTERVAL_SECONDS || 3600),
    planTiers: parsePlanTiers(process.env.PLAN_TIERS || '1,100,5|5,500,10|15,1500,20|30,3000,40|100,10000,150'),

    // Chat
    allowedModels: (process.env.ALLOWED_MODELS || 'btbtyler09-Qwen3-Coder-Next-GPTQ-4bit-kv16-tool')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),

    // Files / OCR
    dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'gateway.db'),
    documentsDir: process.env.DOCUMENTS_DIR || path.join(process.cwd(), 'documents'),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 100 * 1024 * 1024,
    maxFilenameChars: Number(process.env.MAX_FILENAME_CHARS) || 180,
    ocrTasksUrl: (process.env.OCR_TASKS_URL || 'http://192.168.61.21:8765/api/ocr/tasks').replace(/\/+$/, ''),
    ocrApiKey: (process.env.OCR_API_KEY || '').trim(),
    ocrVllmUrl: (process.env.OCR_VLLM_URL || '').trim(),
    ocrVllmApiKey: (process.env.OCR_VLLM_API_KEY || '').trim(),
    ocrModel: (process.env.OCR_MODEL || '').trim(),
    ocrTimeoutSeconds: Number(process.env.OCR_TIMEOUT_SECONDS) || 60,
    ocrPollIntervalSeconds: Number(process.env.OCR_POLL_INTERVAL_SECONDS) || 3,
    ocrPollMaxSeconds: Number(process.env.OCR_POLL_MAX_SECONDS) || 600,
    ocrTransferTimeoutSeconds: Number(process.env.OCR_TRANSFER_TIMEOUT_SECONDS) || 300,
    parseMaxWorkers: Math.max(1, Number(process.env.PARSE_MAX_WORKERS) || 2),
    buildMaxWorkers: Math.max(1, Number(process.env.BUILD_MAX_WORKERS) || 2),

    // Open WebUI
    openWebuiBaseUrl: (process.env.OPENWEBUI_BASE_URL || 'http://192.168.30.3:3000').replace(/\/+$/, ''),
    openWebuiToken: (process.env.OPENWEBUI_TOKEN || '').trim(),
    openWebuiEmail: (process.env.OPENWEBUI_EMAIL || '').trim(),
    openWebuiPassword: (process.env.OPENWEBUI_PASSWORD || '').trim(),
    openWebuiTimeoutSeconds: Number(process.env.OPENWEBUI_TIMEOUT_SECONDS) || 60,
    owuPollTimeoutSeconds: Number(process.env.OWU_POLL_TIMEOUT_SECONDS) || 180,
    owuUploadTimeoutSeconds: Number(process.env.OWU_UPLOAD_TIMEOUT_SECONDS) || 300,

    // RAG
    owuRagBaseModel: (process.env.OWU_RAG_BASE_MODEL || '').trim(),
    owuRagTemperature: Number(process.env.OWU_RAG_TEMPERATURE) || 1.0,
    owuRagTopK: Number(process.env.OWU_RAG_TOP_K) || 40,
    owuRagTopP: Number(process.env.OWU_RAG_TOP_P) || 0.95,
    ragSystemPrompt: readFileWithFallback(path.join(process.cwd(), 'system_prompt.md'), ''),
    ragCapabilities: {
        file_context: true,
        vision: true,
        file_upload: true,
        web_search: true,
        image_generation: true,
        code_interpreter: true,
        terminal: true,
        citations: true,
        status_updates: true,
        builtin_tools: true,
    },

    // Auth
    sessionTtlMs: 24 * 60 * 60 * 1000,
    sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    adminSessionTokenPrefix: 'admin_',
};

export const OCR_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.step', '.stp']);
export const PASSTHROUGH_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.text', '.csv', '.tsv', '.json', '.jsonl',
    '.yaml', '.yml', '.xml', '.html', '.htm', '.log', '.rst', '.tex',
]);
export const SUPPORTED_EXTENSIONS = new Set([...OCR_EXTENSIONS, ...PASSTHROUGH_EXTENSIONS]);

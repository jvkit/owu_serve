import type { Express } from 'express';

export function ragModule(_app: Express) {
    // RAG model auto-creation is triggered by chat/files lifecycle.
    // Service functions will live in src/modules/rag/service.ts
}

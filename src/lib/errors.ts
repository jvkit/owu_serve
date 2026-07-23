export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public code?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export function handleError(res: any, error: unknown) {
    if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, error: error.message, code: error.code });
    }
    const message = error instanceof Error ? error.message : '服务器内部错误';
    return res.status(500).json({ ok: false, error: message });
}

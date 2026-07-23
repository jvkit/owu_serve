import type { Express, Request, Response } from 'express';
import { listModels, proxyChatCompletion } from './service';

export function chatModule(app: Express) {
    // OpenAI-compatible proxy endpoints
    app.get('/v1/models', (_req: Request, res: Response) => {
        res.json(listModels());
    });

    app.post('/v1/chat/completions', async (req: Request, res: Response) => {
        await proxyChatCompletion(req, res);
    });
}

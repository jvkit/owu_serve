import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { logger } from './lib/logger';
import { ApiError, handleError } from './lib/errors';
import { initSchema } from './lib/db';

// Import modules
import { chatModule } from './modules/chat';
import { plansModule } from './modules/plans';
import { filesModule } from './modules/files';
import { knowledgeModule } from './modules/knowledge';
import { ragModule } from './modules/rag';
import { dashboardModule } from './modules/dashboard';
import { adminModule } from './modules/admin';
import { startPurgeTimer } from './modules/admin/service';
import { feedbackModule } from './modules/feedback';
import { userModule } from './modules/user';
import { seedPlanTiersFromEnv } from './modules/plans/tiers';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));

// Seed plan tiers from environment on first startup
seedPlanTiersFromEnv();

// Register raw-body route before JSON parser
// (moved here as placeholder; actual upload route lives in files module)
app.use('/api/files/upload', (req, res, next) => {
    // files module will register its own handler later
    next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
        const email = String(
            req.query.email
            || (req.body && typeof req.body === 'object' && typeof req.body.email === 'string' ? req.body.email : '')
            || req.headers['x-openwebui-user-email']
            || ''
        ).trim().toLowerCase();
        logger.info(`${res.statusCode} ${req.method} ${req.path} ${email || '-'} ${Date.now() - start}ms`);
    });
    next();
});

// Health check
app.get('/health', (_req, res) => {
    res.json({ ok: true, version: '2.0.0' });
});

// Register modules
chatModule(app);
plansModule(app);
knowledgeModule(app);
filesModule(app);
ragModule(app);
dashboardModule(app);
adminModule(app);
feedbackModule(app);
userModule(app);

// Static frontend (built by Vite into frontend/dist, served under /gw/)
const staticRoot = path.join(__dirname, '..', 'frontend', 'dist');
app.use('/gw', express.static(staticRoot, { index: false }));

// SPA fallbacks
app.get('/dashboard', (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));
// 用户中心独立入口（OWU iframe 嵌入用，避免与 OWU /dashboard 路由冲突）
app.get('/uc', (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));
app.get('/uc/index.html', (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));
app.get('/admin', (_req, res) => res.redirect('/admin/dashboard'));
app.get('/admin/dashboard', (_req, res) => res.sendFile(path.join(staticRoot, 'admin.html')));

// Root redirect
app.get('/', (_req, res) => res.redirect('/dashboard'));

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('[unhandled error]', err);
    handleError(res, err);
});

// 404
app.use((_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'Not Found' });
});

initSchema();
startPurgeTimer();

app.listen(config.port, () => {
    logger.info(`owu-gateway v2 listening on port ${config.port}`);
});

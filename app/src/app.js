import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-dist';
import { openDb } from './db.js';
import { loadConfig } from './config.js';
import { authMiddleware, sameOriginGuard } from './auth.js';
import { errorHandler } from './util/errors.js';
import { createEnrichment } from './services/enrichment.js';
import { createNotifications } from './services/notifications.js';
import { createApplications } from './services/applications.js';
import { createContextService } from './services/context.js';
import { createLlm } from './services/llm.js';
import { createIntentService } from './services/intent.js';
import { createApi } from './routes/api.js';
import { seedDemo } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const db = overrides.db || openDb(config.dbPath);
  if (config.seed) seedDemo(db);

  const enrichment = createEnrichment({ db, config, fetchImpl: overrides.fetchImpl });
  const notifications = createNotifications(db);
  const contexts = createContextService({ enrichment, ttlMs: overrides.contextTtlMs });
  const apps = createApplications({ db, config, enrichment, notifications });
  const llm = overrides.llm || createLlm({ config, fetchImpl: overrides.llmFetch });
  const intent = createIntentService({ llm });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': req.path.startsWith('/api-docs')
        ? "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'"
        : "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(authMiddleware(db, config.secret));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', sameOriginGuard);

  app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.use('/api', createApi({ db, config, apps, contexts, notifications, enrichment, llm, intent }));

  // Документация API
  const docsDir = process.env.DOCS_DIR || path.resolve(here, '../../docs');
  const specPath = path.join(docsDir, 'openapi.yaml');
  app.get('/openapi.json', (_req, res) => {
    if (!fs.existsSync(specPath)) return res.status(404).json({ error: { code: 'not_found', message: 'Спецификация не найдена' } });
    res.json(YAML.parse(fs.readFileSync(specPath, 'utf8')));
  });
  app.get('/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(specPath));
  const swaggerDir = swaggerUi.getAbsoluteFSPath();
  app.get('/api-docs', (_req, res) => res.type('html').send(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>API — Умный кредитный кабинет</title><link rel="stylesheet" href="/api-docs/swagger-ui.css"></head><body><div id="ui"></div><script src="/api-docs/swagger-ui-bundle.js"></script><script src="/api-docs/init.js"></script></body></html>`));
  app.get('/api-docs/init.js', (_req, res) => res.type('js').send(`window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#ui' });`));
  app.use('/api-docs', express.static(swaggerDir, { index: false }));

  app.use(express.static(path.resolve(here, '../public'), { maxAge: 0, extensions: ['html'] }));
  app.use(errorHandler);

  return { app, db, apps, contexts, notifications, enrichment, config, llm, intent };
}

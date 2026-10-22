import { createApp } from './app.js';

const { app, apps, db, config, intent } = createApp();
if (/change-me/.test(config.secret)) console.warn('[cabinet] APP_SECRET не задан: сессии подписаны демо-секретом. Не публикуйте стенд в интернет без своего секрета (.env).');
const server = app.listen(config.port, () => console.log(`[cabinet] http://localhost:${config.port}  (API: /api-docs)`));

apps.recover();
// Прогреваем модель после старта: сервер llama.cpp может ещё загружать веса, поэтому несколько попыток
(async () => { for (let i = 0; i < 20; i++) { const r = await intent.warmup({ force: true }); if (r?.ok) { console.log(`[cabinet] модель прогрета за ${r.ms} мс`); return; } await new Promise((x) => setTimeout(x, 15_000)); } })();                                  // продолжаем заявки, прерванные перезапуском
const sweep = setInterval(() => apps.sweepExpired(), 60_000);

const stop = () => { clearInterval(sweep); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

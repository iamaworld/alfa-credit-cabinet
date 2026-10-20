import { createApp } from './app.js';

const { app, apps, db, config } = createApp();
if (/change-me/.test(config.secret)) console.warn('[cabinet] APP_SECRET не задан: сессии подписаны демо-секретом. Не публикуйте стенд в интернет без своего секрета (.env).');
const server = app.listen(config.port, () => console.log(`[cabinet] http://localhost:${config.port}  (API: /api-docs)`));

apps.recover();                                  // продолжаем заявки, прерванные перезапуском
const sweep = setInterval(() => apps.sweepExpired(), 60_000);

const stop = () => { clearInterval(sweep); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

// Запуск без Docker: три мока и приложение в одном процессе.
//   cd app && npm ci && cd .. && node --disable-warning=ExperimentalWarning scripts/dev.mjs
import { createMock } from '../mocks/src/server.js';

for (const [kind, port] of [['fns', 4001], ['bki', 4002], ['statement', 4003]]) {
  await createMock(kind, { port }).listen();
}
process.env.FNS_URL ??= 'http://127.0.0.1:4001';
process.env.BKI_URL ??= 'http://127.0.0.1:4002';
process.env.STATEMENT_URL ??= 'http://127.0.0.1:4003';
process.env.DB_PATH ??= './data/cabinet.db';
await import('../app/src/server.js');

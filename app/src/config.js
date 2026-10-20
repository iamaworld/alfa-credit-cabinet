// Конфигурация из переменных окружения. Значения по умолчанию подходят для локального запуска.
const int = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    dbPath: env.DB_PATH || './data/cabinet.db',
    secret: env.APP_SECRET || 'dev-only-secret-change-me',
    secureCookies: env.SECURE_COOKIES === '1',
    sources: {
      fns: env.FNS_URL || 'http://127.0.0.1:4001',
      bki: env.BKI_URL || 'http://127.0.0.1:4002',
      statement: env.STATEMENT_URL || 'http://127.0.0.1:4003',
    },
    enrichTimeoutMs: int(env.ENRICH_TIMEOUT_MS, 2000),
    enrichRetries: int(env.ENRICH_RETRIES, 1),
    // Пауза между этапами обработки заявки: нужна, чтобы статус был виден «в движении»
    stageDelayMs: int(env.STAGE_DELAY_MS, 1800),
    seed: env.SEED !== '0',
  };
}

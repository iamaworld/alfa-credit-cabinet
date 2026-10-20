// Получение данных из внешних источников (в прототипе — моки в отдельных контейнерах).
// Таймаут, повтор, запасной вариант из кэша (последний удачный снимок) и признак degraded.
import { nowIso, json, parse } from '../db.js';
import { AppError } from '../util/errors.js';

const PATHS = {
  fns: (inn) => `/v1/companies/${inn}`,
  bki: (inn) => `/v1/credit-history/${inn}`,
  statement: (inn) => `/v1/statements/${inn}?months=12`,
};
export const SOURCE_TITLES = { fns: 'ЕГРЮЛ/ЕГРИП и «Прозрачный бизнес»', bki: 'Бюро кредитных историй', statement: 'Выписка по счёту' };

class NotFound extends Error {}

async function fetchOnce(url, timeoutMs, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (res.status === 404) throw new NotFound();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export function createEnrichment({ db, config, fetchImpl = fetch }) {
  const saveSnap = db.prepare('INSERT INTO enrichment_snapshots (application_id, inn, source, ok, degraded, payload, error, fetched_at) VALUES (?,?,?,?,?,?,?,?)');
  const lastGood = db.prepare('SELECT payload, fetched_at FROM enrichment_snapshots WHERE inn = ? AND source = ? AND ok = 1 ORDER BY id DESC LIMIT 1');

  async function loadSource(source, inn, applicationId) {
    const url = config.sources[source] + PATHS[source](inn);
    let lastErr;
    for (let attempt = 0; attempt <= config.enrichRetries; attempt++) {
      try {
        const payload = await fetchOnce(url, config.enrichTimeoutMs, fetchImpl);
        const at = nowIso();
        saveSnap.run(applicationId ?? null, inn, source, 1, 0, json(payload), null, at);
        return { payload, ok: true, degraded: false, fetchedAt: at };
      } catch (e) {
        if (e instanceof NotFound) {
          const at = nowIso();
          saveSnap.run(applicationId ?? null, inn, source, 1, 0, json({ notFound: true }), null, at);
          return { payload: null, ok: true, degraded: false, notFound: true, fetchedAt: at };
        }
        lastErr = e;
      }
    }
    const cached = lastGood.get(inn, source);
    const cachedPayload = parse(cached?.payload);
    const error = lastErr?.name === 'AbortError' ? 'timeout' : String(lastErr?.message || lastErr);
    saveSnap.run(applicationId ?? null, inn, source, 0, 1, null, error, nowIso());
    if (cachedPayload && !cachedPayload.notFound) {
      return { payload: cachedPayload, ok: true, degraded: true, fromCache: true, fetchedAt: cached.fetched_at, error };
    }
    return { payload: null, ok: false, degraded: true, error, fetchedAt: null };
  }

  /** Загружает все источники параллельно. Без данных ФНС расчёт невозможен. */
  async function loadAll(inn, applicationId = null) {
    const [fns, bki, statement] = await Promise.all(['fns', 'bki', 'statement'].map((s) => loadSource(s, inn, applicationId)));
    if (fns.notFound) throw new AppError(404, 'company_not_found', 'Организация или ИП с таким ИНН не найдены в реестре');
    if (!fns.ok) throw new AppError(503, 'registry_unavailable', 'Реестр временно недоступен. Попробуйте через минуту.');
    const meta = { fns, bki, statement };
    const clean = (m) => ({ ok: m.ok, degraded: m.degraded, fromCache: !!m.fromCache, notFound: !!m.notFound, fetchedAt: m.fetchedAt, error: m.error });
    return {
      data: { fns: fns.payload, bki: bki.payload, statement: statement.payload },
      meta: { fns: clean(fns), bki: clean(bki), statement: clean(statement) },
      degraded: [fns, bki, statement].some((m) => m.degraded),
    };
  }

  return { loadAll, loadSource };
}

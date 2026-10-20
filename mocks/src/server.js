// Три мок-сервиса внешних источников данных на чистом node:http, без зависимостей.
// Каждый сервис запускается как отдельный процесс/контейнер: node src/server.js <fns|bki|statement>
// Контракты намеренно упрощены (см. docs/api.md → «Смоделированные интеграции»),
// чтобы в промышленной версии их можно было заменить реальными адаптерами.
import http from 'node:http';
import { COMPANIES, CREDIT_HISTORY, buildStatement, monthsAgo } from './data.js';

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

const INN_RE = /^(\d{10}|\d{12})$/;

const handlers = {
  fns(url) {
    const m = url.pathname.match(/^\/v1\/companies\/([^/]+)$/);
    if (!m) return [404, { error: 'not_found' }];
    if (!INN_RE.test(m[1])) return [400, { error: 'bad_inn', message: 'ИНН должен содержать 10 или 12 цифр' }];
    const c = COMPANIES[m[1]];
    if (!c) return [404, { error: 'not_found', message: 'Организация не найдена в реестре (мок)' }];
    return [200, {
      inn: m[1], name: c.name, shortName: c.shortName, legalForm: c.legalForm,
      registrationDate: monthsAgo(c.regMonthsAgo), status: c.status, okved: c.okved,
      region: c.region, address: c.address,
      director: { fio: c.director.fio, since: monthsAgo(c.director.sinceMonthsAgo) },
      employees: c.employees, taxRegime: c.taxRegime, size: c.size,
      transparentBusiness: c.flags,
      source: 'ЕГРЮЛ/ЕГРИП + «Прозрачный бизнес» (мок)',
    }];
  },
  bki(url) {
    const m = url.pathname.match(/^\/v1\/credit-history\/([^/]+)$/);
    if (!m) return [404, { error: 'not_found' }];
    if (!INN_RE.test(m[1])) return [400, { error: 'bad_inn' }];
    const h = CREDIT_HISTORY[m[1]];
    if (!h) {
      return [200, { inn: m[1], rating: null, noHistory: true, closedWithDelays: 0, inquiries90d: 0, obligations: [], source: 'БКИ (мок)' }];
    }
    return [200, {
      inn: m[1], rating: h.rating, noHistory: h.noHistory, closedWithDelays: h.closedWithDelays,
      inquiries90d: h.inquiries90d, source: 'БКИ (мок)',
      obligations: h.obligations.map(({ openMonthsAgo, ...o }) => ({ ...o, openDate: monthsAgo(openMonthsAgo) })),
    }];
  },
  statement(url) {
    const m = url.pathname.match(/^\/v1\/statements\/([^/]+)$/);
    if (!m) return [404, { error: 'not_found' }];
    if (!INN_RE.test(m[1])) return [400, { error: 'bad_inn' }];
    const months = Number(url.searchParams.get('months') || 12);
    const rows = buildStatement(m[1], Math.min(Math.max(months, 1), 24));
    if (!rows) return [404, { error: 'no_accounts', message: 'Счета в подключённых банках не найдены (мок)' }];
    return [200, { inn: m[1], currency: 'RUB', months: rows, source: 'Выписка по счёту через открытый банкинг (мок)' }];
  },
};

export function createMock(kind, { port = 0 } = {}) {
  const handle = handlers[kind];
  if (!handle) throw new Error(`unknown mock: ${kind}`);
  const state = { down: false, latencyMs: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    if (url.pathname === '/health') return send(res, 200, { status: 'ok', kind, ...state });
    if (url.pathname === '/__control' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const body = JSON.parse(raw || '{}');
        if (typeof body.down === 'boolean') state.down = body.down;
        if (Number.isFinite(body.latencyMs)) state.latencyMs = Math.max(0, Math.min(body.latencyMs, 10000));
        return send(res, 200, { kind, ...state });
      } catch {
        return send(res, 400, { error: 'bad_json' });
      }
    }
    if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));
    if (state.down) return send(res, 503, { error: 'unavailable', message: 'Сервис временно недоступен (имитация сбоя)' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    const [code, body] = handle(url);
    send(res, code, body);
  });
  return {
    server,
    state,
    listen: () => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Запуск как процесса
if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = process.argv[2];
  const port = Number(process.env.PORT || 4000);
  const mock = createMock(kind, { port });
  mock.listen().then((p) => console.log(JSON.stringify({ level: 'info', msg: 'mock started', kind, port: p })));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => mock.close().then(() => process.exit(0)));
}

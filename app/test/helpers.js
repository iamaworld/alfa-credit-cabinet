import { createMock } from '../../mocks/src/server.js';
import { createApp } from '../src/app.js';

export async function startStack(overrides = {}) {
  const mocks = { fns: createMock('fns'), bki: createMock('bki'), statement: createMock('statement') };
  const ports = {};
  for (const [k, m] of Object.entries(mocks)) ports[k] = await m.listen(0);
  const stack = createApp({
    dbPath: ':memory:', stageDelayMs: 0, seed: true, secret: 'test-secret',
    sources: { fns: `http://127.0.0.1:${ports.fns}`, bki: `http://127.0.0.1:${ports.bki}`, statement: `http://127.0.0.1:${ports.statement}` },
    enrichTimeoutMs: 400, enrichRetries: 0, contextTtlMs: 0, ...overrides,
  });
  const server = await new Promise((res) => { const s = stack.app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(token, method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* пустой ответ */ }
    return { status: res.status, body: data, headers: res.headers };
  }
  async function login(loginName, password = 'demo1234') {
    const r = await call(null, 'POST', '/api/auth/login', { login: loginName, password });
    return r.body?.token;
  }
  async function close() {
    await stack.apps.idle();
    await new Promise((r) => server.close(r));
    for (const m of Object.values(mocks)) await m.close();
  }
  return { ...stack, mocks, base, call, login, close };
}

/** Заполняет черновик и отправляет заявку; возвращает итоговую карточку после конвейера. */
export async function applyFor(s, token, { inn, request, declaredRevenue }) {
  await s.call(token, 'POST', '/api/companies', { inn });
  const d = await s.call(token, 'POST', '/api/applications', { inn, request, purpose: 'working' });
  const id = d.body.application.id;
  for (const doc of d.body.application.documents) await s.call(token, 'PUT', `/api/applications/${id}/documents/${doc.kind}`, { fileName: `${doc.kind}.pdf` });
  const p = await s.call(token, 'PATCH', `/api/applications/${id}`, { version: undefined, form: { consents: { personalData: true } }, declaredRevenue });
  const sub = await s.call(token, 'POST', `/api/applications/${id}/submit`, {}, { 'Idempotency-Key': `k-${id}` });
  await s.apps.idle();
  const fin = await s.call(token, 'GET', `/api/applications/${id}`);
  return { id, draft: d.body.application, patch: p, submit: sub, app: fin.body.application };
}

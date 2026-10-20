import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, applyFor } from './helpers.js';

let s;
before(async () => { s = await startStack(); });
after(async () => { await s.close(); });

const WC = (amount, term = 24) => ({ product: 'working_capital', amount, term, collateral: false });

test('источник упал, но есть сохранённая копия: решение уходит человеку и помечено', async () => {
  const t = await s.login('client-a');
  await s.call(t, 'POST', '/api/companies', { inn: '7701234567' }); // прогрев копии
  s.mocks.bki.state.down = true;
  try {
    const r = await applyFor(s, t, { inn: '7701234567', request: WC(1_000_000, 24) });
    assert.equal(r.app.status, 'manual_review');
    const at = await s.login('analyst');
    const card = await s.call(at, 'GET', `/api/analyst/applications/${r.id}`);
    assert.equal(card.body.sources.bki.degraded, true);
    assert.match(card.body.decision.manualReasons.join(' '), /кэша/);
    s.mocks.bki.state.down = false;
    const rerun = await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'rerun' });
    assert.equal(rerun.status, 200);
    await s.apps.idle();
    const after = await s.call(t, 'GET', `/api/applications/${r.id}`);
    assert.equal(after.body.application.status, 'approved', 'после восстановления источника заявка решается автоматически');
  } finally { s.mocks.bki.state.down = false; }
});

test('реестр недоступен и копии нет: понятная ошибка, а не падение', async () => {
  const t = await s.login('client-d');
  s.mocks.fns.state.down = true;
  try {
    const r = await s.call(t, 'POST', '/api/companies', { inn: '7743987654' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'registry_unavailable');
  } finally { s.mocks.fns.state.down = false; }
});

test('неизвестный ИНН и неверный формат', async () => {
  const t = await s.login('client-a');
  assert.equal((await s.call(t, 'POST', '/api/companies', { inn: '1234567890' })).status, 404);
  assert.equal((await s.call(t, 'POST', '/api/companies', { inn: '12ab' })).status, 400);
});

test('предложение истекает, принять просроченное нельзя', async () => {
  const t = await s.login('client-a');
  const r = await applyFor(s, t, { inn: '7701234567', request: WC(800_000, 12) });
  assert.equal(r.app.status, 'approved');
  const d = s.db.prepare('SELECT id, payload FROM decisions WHERE application_id = ? ORDER BY id DESC LIMIT 1').get(r.id);
  const p = JSON.parse(d.payload); p.expiresAt = new Date(Date.now() - 1000).toISOString();
  s.db.prepare('UPDATE decisions SET payload = ? WHERE id = ?').run(JSON.stringify(p), d.id);
  const acc = await s.call(t, 'POST', `/api/applications/${r.id}/accept`, {});
  assert.equal(acc.status, 409);
  const v = await s.call(t, 'GET', `/api/applications/${r.id}`);
  assert.equal(v.body.application.status, 'expired');
});

test('аналитик не может одобрить заявку со стоп-фактором, но может отказать', async () => {
  const t = await s.login('client-d');
  const r = await applyFor(s, t, { inn: '7743987654', request: WC(4_000_000, 24) });
  assert.equal(r.app.status, 'manual_review');
  const at = await s.login('analyst');
  const approve = await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'approve', comment: 'Попытка обойти стоп-фактор.' });
  assert.equal(approve.status, 409);
  assert.equal(approve.body.error.code, 'hard_stop');
  const dec = await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'decline', comment: 'Подтверждаю отказ по текущей просрочке.' });
  assert.equal(dec.status, 200);
  const v = await s.call(t, 'GET', `/api/applications/${r.id}`);
  assert.equal(v.body.application.status, 'declined');
  assert.ok(v.body.application.decision.reasons.length > 0);
});

test('аналитик запрашивает данные, клиент отвечает, проверка продолжается', async () => {
  const t = await s.login('client-a');
  const r = await applyFor(s, t, { inn: '7701234567', request: WC(4_000_000, 24) });
  assert.equal(r.app.status, 'manual_review');
  const at = await s.login('analyst');
  const short = await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'request_info', comment: '?' });
  assert.equal(short.status, 400);
  await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'request_info', comment: 'Подтвердите источник поступлений в марте.' });
  const v = await s.call(t, 'GET', `/api/applications/${r.id}`);
  assert.equal(v.body.application.status, 'needs_info');
  const q = v.body.application.openInfo[0];
  assert.equal(q.kind, 'text');
  await s.call(t, 'POST', `/api/applications/${r.id}/info/${q.id}/answer`, { answer: 'Крупный контракт с ООО «Заказчик».' });
  await s.apps.idle();
  const after = await s.call(t, 'GET', `/api/applications/${r.id}`);
  assert.equal(after.body.application.status, 'manual_review');
  const evts = (await s.call(at, 'GET', `/api/analyst/applications/${r.id}`)).body.audit;
  assert.ok(evts.some((e) => e.actor === 'analyst:analyst'));
  assert.ok(evts.some((e) => e.internalText?.includes('Заказчик')));
});

test('после перезапуска незавершённая заявка продолжается', async () => {
  const t = await s.login('client-a');
  await s.call(t, 'POST', '/api/companies', { inn: '7701234567' });
  const d = await s.call(t, 'POST', '/api/applications', { inn: '7701234567', request: WC(600_000, 12) });
  const id = d.body.application.id;
  for (const doc of d.body.application.documents) await s.call(t, 'PUT', `/api/applications/${id}/documents/${doc.kind}`, { fileName: 'f.pdf' });
  await s.call(t, 'PATCH', `/api/applications/${id}`, { form: { consents: { personalData: true } } });
  s.db.prepare("UPDATE applications SET status = 'enrichment', submitted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  s.apps.recover();
  await s.apps.idle();
  const v = await s.call(t, 'GET', `/api/applications/${id}`);
  assert.equal(v.body.application.status, 'approved');
});

test('клиент не видит баллов и порогов ни в одном ответе', async () => {
  const t = await s.login('client-b');
  const r = await applyFor(s, t, { inn: '500100732259', request: { product: 'overdraft', amount: 1_500_000, term: 12, collateral: false } });
  const raw = JSON.stringify(r.app);
  for (const forbidden of ['"points"', '"threshold"', '"score"', '"margin"', 'evaluation']) assert.ok(!raw.includes(forbidden), `в ответе клиенту есть ${forbidden}`);
});

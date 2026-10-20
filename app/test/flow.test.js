import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, applyFor } from './helpers.js';

let s;
before(async () => { s = await startStack(); });
after(async () => { await s.close(); });

const WC = (amount, term = 24) => ({ product: 'working_capital', amount, term, collateral: false });

test('A: одобрение и выдача', async () => {
  const t = await s.login('client-a');
  const r = await applyFor(s, t, { inn: '7701234567', request: WC(2_500_000) });
  assert.equal(r.app.status, 'approved');
  assert.equal(r.app.decision.outcome, 'approve');
  assert.ok(r.app.decision.terms.payment > 0);
  assert.ok(r.app.decision.expiresAt);
  const acc = await s.call(t, 'POST', `/api/applications/${r.id}/accept`, {});
  assert.equal(acc.body.application.status, 'signing');
  const noConfirm = await s.call(t, 'POST', `/api/applications/${r.id}/sign`, {});
  assert.equal(noConfirm.status, 400);
  const sign = await s.call(t, 'POST', `/api/applications/${r.id}/sign`, { confirm: true });
  assert.equal(sign.body.application.status, 'disbursed');
  const n = await s.call(t, 'GET', '/api/notifications');
  assert.ok(n.body.items.length >= 2);
});

test('A: крупная сумма уходит аналитику, аналитик одобряет', async () => {
  const t = await s.login('client-a');
  const r = await applyFor(s, t, { inn: '7701234567', request: WC(5_000_000) });
  assert.equal(r.app.status, 'manual_review');
  assert.equal(r.app.decision, null, 'клиент не видит рекомендацию до решения аналитика');
  const at = await s.login('analyst');
  const q = await s.call(at, 'GET', '/api/analyst/queue');
  assert.ok(q.body.queue.some((x) => x.id === r.id));
  const card = await s.call(at, 'GET', `/api/analyst/applications/${r.id}`);
  assert.ok(card.body.decision.evaluation.factors.every((f) => typeof f.points === 'number'));
  const noComment = await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'approve' });
  assert.equal(noComment.status, 400);
  const ok = await s.call(at, 'POST', `/api/analyst/applications/${r.id}/decision`, { action: 'approve', comment: 'Обороты стабильны, нагрузка приемлемая.' });
  assert.equal(ok.status, 200);
  const view = await s.call(t, 'GET', `/api/applications/${r.id}`);
  assert.equal(view.body.application.status, 'approved');
  assert.ok(ok.body.audit.some((e) => e.actor === 'analyst:analyst'));
});

test('B: контр-оферта, принятие варианта', async () => {
  const t = await s.login('client-b');
  const r = await applyFor(s, t, { inn: '500100732259', request: { product: 'overdraft', amount: 1_500_000, term: 12, collateral: false } });
  assert.equal(r.app.status, 'counter_offer');
  const alts = r.app.decision.alternatives;
  assert.ok(alts.length >= 1);
  assert.ok(r.app.decision.reasons.length >= 1);
  assert.equal(r.app.decision.reasons[0].points, undefined, 'клиенту не отдаём баллы');
  const bad = await s.call(t, 'POST', `/api/applications/${r.id}/accept`, { altId: 'nope' });
  assert.equal(bad.status, 400);
  const acc = await s.call(t, 'POST', `/api/applications/${r.id}/accept`, { altId: alts[0].id });
  assert.equal(acc.body.application.status, 'signing');
  assert.equal(acc.body.application.acceptedTerms.amount, alts[0].amount);
});

test('C: нужна информация → ответ → решение', async () => {
  const t = await s.login('client-c');
  const r = await applyFor(s, t, { inn: '1650654321', request: { product: 'equipment', amount: 1_200_000, term: 36, collateral: false } });
  assert.equal(r.app.status, 'needs_info');
  assert.equal(r.app.openInfo[0].kind, 'revenue');
  const bad = await s.call(t, 'POST', `/api/applications/${r.id}/info/${r.app.openInfo[0].id}/answer`, { declaredRevenue: -5 });
  assert.equal(bad.status, 400);
  await s.call(t, 'POST', `/api/applications/${r.id}/info/${r.app.openInfo[0].id}/answer`, { declaredRevenue: 1_500_000 });
  await s.apps.idle();
  const v = await s.call(t, 'GET', `/api/applications/${r.id}`);
  assert.ok(['approved', 'counter_offer', 'declined', 'manual_review'].includes(v.body.application.status), v.body.application.status);
  assert.notEqual(v.body.application.status, 'needs_info');
});

test('D и E: отказ с причинами и планом, стоп-фактор нельзя обойти', async () => {
  const t = await s.login('client-d');
  const r = await applyFor(s, t, { inn: '7743987654', request: WC(800_000, 12) });
  assert.equal(r.app.status, 'declined');
  assert.ok(r.app.decision.reasons.length > 0);
  assert.ok(r.app.decision.plan.length > 0);
  const t2 = await s.login('client-e');
  const r2 = await applyFor(s, t2, { inn: '7700000001', request: WC(500_000, 12) });
  assert.equal(r2.app.status, 'declined');
});

test('идемпотентная отправка не создаёт дубль и не запускает проверку заново', async () => {
  const t = await s.login('client-a');
  await s.call(t, 'POST', '/api/companies', { inn: '7701234567' });
  const d = await s.call(t, 'POST', '/api/applications', { inn: '7701234567', request: WC(400_000, 12) });
  const id = d.body.application.id;
  for (const doc of d.body.application.documents) await s.call(t, 'PUT', `/api/applications/${id}/documents/${doc.kind}`, { fileName: 'f.pdf' });
  await s.call(t, 'PATCH', `/api/applications/${id}`, { form: { consents: { personalData: true } } });
  const h = { 'Idempotency-Key': 'same-key' };
  const a = await s.call(t, 'POST', `/api/applications/${id}/submit`, {}, h);
  const b = await s.call(t, 'POST', `/api/applications/${id}/submit`, {}, h);
  assert.equal(a.status, 202);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  const c = await s.call(t, 'POST', `/api/applications/${id}/submit`, {}, { 'Idempotency-Key': 'other-key' });
  assert.equal(c.body.replayed, true);
  await s.apps.idle();
  const ev = s.db.prepare("SELECT COUNT(*) n FROM application_events WHERE application_id = ? AND type = 'submitted'").get(id);
  assert.equal(ev.n, 1);
});

test('нельзя отправить неполную заявку', async () => {
  const t = await s.login('client-a');
  const d = await s.call(t, 'POST', '/api/applications', { inn: '7701234567', request: WC(400_000, 12) });
  const r = await s.call(t, 'POST', `/api/applications/${d.body.application.id}/submit`, {});
  assert.equal(r.status, 422);
  assert.ok(r.body.error.details.length >= 2);
});

test('доступ: чужая заявка, роли, без входа', async () => {
  const ta = await s.login('client-a');
  const tb = await s.login('client-b');
  const list = await s.call(ta, 'GET', '/api/applications');
  const foreign = list.body.applications[0].id;
  assert.equal((await s.call(tb, 'GET', `/api/applications/${foreign}`)).status, 404);
  assert.equal((await s.call(tb, 'POST', `/api/applications/${foreign}/cancel`)).status, 404);
  assert.equal((await s.call(ta, 'GET', '/api/analyst/queue')).status, 403);
  assert.equal((await s.call(null, 'GET', '/api/applications')).status, 401);
  assert.equal((await s.call(tb, 'GET', '/api/companies/7701234567/offers')).status, 403);
});

test('вход: неверный пароль и ограничение попыток', async () => {
  const r = await s.call(null, 'POST', '/api/auth/login', { login: 'client-e', password: 'x' });
  assert.equal(r.status, 401);
  let last;
  for (let i = 0; i < 10; i++) last = await s.call(null, 'POST', '/api/auth/login', { login: 'client-d', password: 'bad' });
  assert.equal(last.status, 429);
});

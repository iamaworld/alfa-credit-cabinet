import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, evaluate, maxApprovable } from '../src/engine/scoring.js';
import { decide } from '../src/engine/decision.js';
import { preview, preapprovedOffers } from '../src/engine/offer.js';
import { annuityPayment } from '../src/util/money.js';
import { buildStatement } from '../../mocks/src/data.js';

const fns = (over = {}) => ({ inn: '1', legalForm: 'ООО', status: 'ACTIVE', registrationDate: '2018-01-01', okved: { code: '49.41' }, transparentBusiness: {}, ...over });
const ctxOf = (data, extra) => buildContext({ fns: fns(), bki: { rating: 'A', obligations: [], closedWithDelays: 0 }, statement: { months: buildStatement('7701234567', 12) }, ...data }, extra);

test('аннуитет считается корректно', () => {
  assert.equal(annuityPayment(1_000_000, 12, 12), 88849);
  assert.equal(annuityPayment(120_000, 0, 12), 10_000);
});

test('движок детерминирован: один вход — один результат', () => {
  const c = ctxOf({});
  const q = { product: 'working_capital', amount: 1_000_000, term: 24, collateral: false };
  assert.deepEqual(evaluate(c, q), evaluate(c, q));
});

test('больше срок — ниже платёж, выше переплата', () => {
  const c = ctxOf({});
  const a = evaluate(c, { product: 'working_capital', amount: 2_000_000, term: 12, collateral: false });
  const b = evaluate(c, { product: 'working_capital', amount: 2_000_000, term: 36, collateral: false });
  assert.ok(b.metrics.payment < a.metrics.payment);
  assert.ok(b.metrics.overpayment > a.metrics.overpayment);
});

test('текущая просрочка — жёсткий стоп-фактор', () => {
  const c = ctxOf({ bki: { rating: 'A', obligations: [{ monthlyPayment: 1000, overdueDays: 20 }], closedWithDelays: 0 } });
  const d = decide(c, { product: 'working_capital', amount: 500_000, term: 12, collateral: false });
  assert.equal(d.outcome, 'decline');
  assert.equal(d.hardStop, true);
});

test('нет оборотов — нужна информация, с выручкой «со слов» учитывается дисконт', () => {
  const c = ctxOf({ statement: null });
  assert.equal(decide(c, { product: 'working_capital', amount: 500_000, term: 12 }).outcome, 'need_info');
  const c2 = ctxOf({ statement: null }, { declaredMonthlyRevenue: 1_000_000 });
  assert.equal(c2.turnover, 800_000);
});

test('maxApprovable действительно одобряется, а следующий шаг — нет', () => {
  const c = ctxOf({});
  const max = maxApprovable(c, { product: 'working_capital', term: 24, collateral: false });
  assert.ok(evaluate(c, { product: 'working_capital', amount: max, term: 24 }).approvable);
  assert.ok(!evaluate(c, { product: 'working_capital', amount: max + 10_000, term: 24 }).approvable);
});

test('предодобрение консервативнее максимума и сразу проходит решение', () => {
  const c = ctxOf({});
  for (const o of preapprovedOffers(c).filter((x) => x.available)) {
    const d = decide(c, { product: o.product, amount: o.amount, term: o.term, collateral: false });
    assert.equal(d.outcome, 'approve');
    assert.ok(o.amount <= maxApprovable(c, { product: o.product, term: o.term, collateral: false }));
  }
});

test('редактор объясняет, что изменилось', () => {
  const c = ctxOf({});
  const { result } = preview(c, { product: 'working_capital', amount: 2_000_000, term: 36 }, { product: 'working_capital', amount: 2_000_000, term: 12 });
  const kinds = result.changes.map((x) => x.kind);
  assert.ok(kinds.includes('term'));
  assert.match(result.changes.find((x) => x.kind === 'term').text, /снизился/);
});

test('клиентская оценка не содержит баллов и весов', () => {
  const c = ctxOf({});
  const { result } = preview(c, { product: 'working_capital', amount: 2_000_000, term: 24 });
  for (const f of result.factors) assert.equal(f.points, undefined);
  assert.equal(result.threshold, undefined);
});

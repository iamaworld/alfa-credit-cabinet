import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastCashflow } from '../src/engine/cashflow.js';

// Год выписки: +100 тыс. в месяц, в марте ежегодная страховка 900 тыс., в июле разовая покупка 500 тыс.
function statement() {
  const months = [];
  let balance = 300_000;
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2025, 9 + i, 1)); // окт 2025 … сен 2026
    const m = d.getUTCMonth() + 1;
    const events = [];
    if (m === 3) events.push({ label: 'Страховка', amount: 900_000, recurring: true });
    if (m === 7) events.push({ label: 'Покупка станка', amount: 500_000, recurring: false });
    const breakdown = { payroll: 400_000, rent: 100_000, suppliers: 400_000, taxes: 0, other: 0 };
    const outflow = 900_000 + events.reduce((s, e) => s + e.amount, 0);
    balance += 1_000_000 - outflow;
    months.push({ month: d.toISOString().slice(0, 7), inflow: 1_000_000, outflow, balance, breakdown, events });
  }
  return months;
}

test('без выписки прогноза нет', () => {
  assert.equal(forecastCashflow({ statement: null }), null);
  assert.equal(forecastCashflow({ statement: statement().slice(0, 1) }), null);
});

test('ежегодное событие повторяется, разовое — нет', () => {
  const cf = forecastCashflow({ statement: statement() });
  assert.equal(cf.forecast.length, 12);
  assert.equal(cf.forecast[0].month, '2026-10');
  const march = cf.forecast.find((f) => f.month === '2027-03');
  const july = cf.forecast.find((f) => f.month === '2027-07');
  assert.deepEqual(march.events.map((e) => e.label), ['Страховка']);
  assert.deepEqual(july.events, []);
});

test('месяц с минусом — разрыв, к нему подсказка овердрафта', () => {
  const cf = forecastCashflow({ statement: statement() });
  // старт 300+1200-900-500 = 100 тыс.; +100/мес до марта (600), в марте −800 → −200 тыс.
  assert.deepEqual(cf.gaps.map((g) => g.month), ['2027-03', '2027-04']);
  assert.equal(cf.minBalance, -200_000);
  assert.equal(cf.suggestion.product, 'overdraft');
  assert.ok(cf.suggestion.amount >= 230_000, 'с запасом 15 %');
  assert.match(cf.suggestion.reason, /марте/);
});

test('кредит на счёт закрывает разрыв, платёж учитывается со следующего месяца', () => {
  // к марту: +400 − 5 платежей по 20 = +300 тыс. поверх −200 → разрыва нет
  const cf = forecastCashflow({ statement: statement(), loan: { amount: 400_000, payment: 20_000, term: 12 } });
  assert.equal(cf.forecast[0].loanFlow, 400_000);
  assert.equal(cf.forecast[1].loanFlow, -20_000);
  assert.equal(cf.withLoan.closesGaps, true);
});

test('кредит на покупку не приносит денег на счёт и может создать разрыв', () => {
  const cf = forecastCashflow({ statement: statement(), loan: { amount: 3_000_000, payment: 150_000, term: 24, purchase: true } });
  assert.equal(cf.forecast[0].loanFlow, 0);
  assert.ok(cf.withLoan.minBalance < cf.minBalance);
});

test('овердрафт берётся только в разрыв и закрывает его, проценты — за использованную сумму', () => {
  const cf = forecastCashflow({ statement: statement(), loan: { amount: 250_000, payment: 0, term: 8, revolving: true, rate: 24 } });
  assert.equal(cf.forecast[0].loanFlow, 0, 'в первые месяцы лимит не нужен');
  assert.equal(cf.withLoan.closesGaps, true);
  assert.ok(cf.withLoan.drawnMax >= 200_000 && cf.withLoan.drawnMax <= 250_000);
  assert.ok(cf.withLoan.interest > 0 && cf.withLoan.interest < 20_000);
});

test('подсказка из календаря действительно закрывает разрыв', () => {
  const base = forecastCashflow({ statement: statement() });
  const s = base.suggestion;
  const cf = forecastCashflow({ statement: statement(), loan: { amount: s.amount, payment: 0, term: s.term, revolving: true, rate: 24 } });
  assert.equal(cf.withLoan.closesGaps, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAmounts, findTerms, parseByRules, createIntentService } from '../src/services/intent.js';

const llmOff = { chatJson: async () => ({ ok: false, error: 'disabled', ms: 0 }) };
const llmSays = (data) => ({ chatJson: async () => ({ ok: true, data, ms: 5 }) });

test('суммы: цифры, «млн», «тыс», «к», слова', () => {
  assert.deepEqual(findAmounts('нужно 1,5 млн').map((a) => a.value), [1_500_000]);
  assert.deepEqual(findAmounts('800 тыс на закупку').map((a) => a.value), [800_000]);
  assert.deepEqual(findAmounts('500к на зарплату').map((a) => a.value), [500_000]);
  assert.deepEqual(findAmounts('2 000 000 рублей').map((a) => a.value), [2_000_000]);
  assert.deepEqual(findAmounts('полтора миллиона').map((a) => a.value), [1_500_000]);
  assert.deepEqual(findAmounts('надо выкупить сейчас — миллиона два').map((a) => a.value), [2_000_000]);
  assert.deepEqual(findAmounts('клиенты платят через 60 дней, 3 сотрудника').map((a) => a.value), []);
});

test('сроки: месяцы, годы, полгода', () => {
  assert.deepEqual(findTerms('на 18 месяцев'), [18]);
  assert.deepEqual(findTerms('отдадим за 2 года'), [24]);
  assert.deepEqual(findTerms('на полгода'), [6]);
  assert.deepEqual(findTerms('кредит на год'), [12]);
  assert.deepEqual(findTerms('примерно 4 миллиона, лет на 5'), [60]);
  assert.deepEqual(findTerms('рассчитаться года за четыре'), [48]);
  assert.deepEqual(findTerms('отдавать года три'), [36]);
  assert.deepEqual(findTerms('выручка за 2 года 5 млн'), [24]);
  assert.deepEqual(findTerms('клиенты платят через 60 дней'), []);
});

test('правила: цель и нужная сумма после «нужно», а не оборот', () => {
  const r = parseByRules('Оборот 3 млн в месяц, нужно 1,5 млн на закупку товара к сезону на год');
  assert.equal(r.purpose, 'working');
  assert.equal(r.amount, 1_500_000);
  assert.equal(r.term, 12);
  assert.equal(parseByRules('хотим купить второй грузовик').purpose, 'equipment');
  assert.equal(parseByRules('хотим взять ещё одну фуру').purpose, 'equipment');
  assert.equal(parseByRules('открываем вторую кофейню').purpose, 'development');
  assert.equal(parseByRules('хочу расширить производство').purpose, 'development');
  assert.equal(parseByRules('клиенты платят через 60 дней, а зарплату платить сейчас').purpose, 'cash_gap');
});

test('без модели работает разбор по правилам', async () => {
  const svc = createIntentService({ llm: llmOff });
  const r = await svc.parse('нужно 2 млн на новый станок на 3 года');
  assert.equal(r.source, 'rules');
  assert.deepEqual(r.request, { product: 'equipment', amount: 2_000_000, term: 36, collateral: false });
});

test('сумму, которой нет в тексте, от модели не принимаем', async () => {
  const svc = createIntentService({ llm: llmSays({ purpose: 'equipment', amount_rub: 7_000_000, term_months: 0, collateral: false }) });
  const r = await svc.parse('хотим купить второй грузовик к сезону');
  assert.equal(r.source, 'llm');
  assert.notEqual(r.request.amount, 7_000_000);
  assert.ok(r.notes.some((n) => n.includes('нет в тексте')));
});

test('модель выбирает нужную сумму из нескольких в тексте', async () => {
  const svc = createIntentService({ llm: llmSays({ purpose: 'working', amount_rub: 900_000, term_months: 12, collateral: false }) });
  const r = await svc.parse('выручка 4 млн, под закупку сырья не хватает 900 тыс, вернём за 12 месяцев');
  assert.equal(r.request.amount, 900_000);
  assert.equal(r.request.term, 12);
  assert.equal(r.summary, 'Пополнить оборотные средства · 900 тыс. ₽ · на 12 мес.');
});

test('сумма вне лимитов продукта приводится к ближайшей с пояснением', async () => {
  const r = await createIntentService({ llm: llmOff }).parse('овердрафт на 50 млн');
  assert.equal(r.request.product, 'overdraft');
  assert.equal(r.request.amount, 5_000_000);
  assert.ok(r.notes.length);
});

test('модель не нашла сумму, но правила нашли её рядом с «нечем» — сумму сохраняем', async () => {
  const svc = createIntentService({ llm: llmSays({ purpose: 'cash_gap', amount_rub: 0, term_months: 0, collateral: false }) });
  const r = await svc.parse('на счету минус, аренду 350 тыс. платить нечем');
  assert.equal(r.request.amount, 350_000);
});

test('модель написала сумму в тысячах — сверяем по масштабу', async () => {
  const svc = createIntentService({ llm: llmSays({ purpose: 'cash_gap', amount_rub: 350, term_months: 0, collateral: false }) });
  assert.equal((await svc.parse('аренду 350 тыс. платить нечем')).request.amount, 350_000);
});

test('пустой текст отклоняется', async () => {
  await assert.rejects(() => createIntentService({ llm: llmOff }).parse('  '), /Опишите задачу/);
});

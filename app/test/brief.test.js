import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opinionFrom } from '../src/services/brief.js';

const f = (id, tone, text = id) => ({ id, source: 'тест', tone, text: `${text}.` });

test('сильная заявка без рисков: так и сказано, вопросов нет', () => {
  const o = opinionFrom([f('age', '+'), f('bki_history', '+'), f('load', '+'), f('manual', '0')], 'approve');
  assert.match(o.summary, /Сильная заявка/);
  assert.match(o.summary, /по правилам политики/);
  assert.deepEqual(o.attention, []);
  assert.deepEqual(o.questions, []);
});

test('стоп-фактор — первым и в выводе', () => {
  const o = opinionFrom([f('stability', '-'), f('stop_current_overdue', '-'), f('age', '+')], 'decline');
  assert.match(o.summary, /стоп-фактор/);
  assert.equal(o.attention[0].fact, 'stop_current_overdue');
});

test('«на что смотреть» — по серьёзности, вопросы клиенту — к фактам «против»', () => {
  const o = opinionFrom([f('stability', '-'), f('cash_gap', '-'), f('load', '-'), f('age', '+'), f('negative_days', '-')], 'counter_offer');
  assert.deepEqual(o.attention.map((x) => x.fact), ['cash_gap', 'load', 'stability']);
  assert.equal(o.questions.length, 2);
  assert.match(o.questions[0], /месяц, когда остаток уходит в минус/);
  assert.match(o.summary, /против — 4/);
});

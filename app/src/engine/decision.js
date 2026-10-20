// Кредитное решение. Отделено от скоринга: на вход получает результат оценки риска
// и применяет к нему политику банка (правила продукта, лимиты автоматического решения).
import { evaluate, maxApprovable } from './scoring.js';
import { PRODUCTS, ENGINE_VERSION } from './products.js';
import { fmtRub } from '../util/money.js';

export const DEFAULT_POLICY = {
  autoDecisionLimit: 3_000_000, // свыше этой суммы решение подтверждает сотрудник банка
  borderlineMargin: 4,          // «пограничное» одобрение отправляется на ручную проверку
};

const roundTo10k = (n) => Math.floor(n / 10_000) * 10_000;

function describeAlt(base, alt, ev) {
  const parts = [];
  if (alt.product !== base.product) parts.push(`другой продукт: ${PRODUCTS[alt.product].name}`);
  if (alt.amount < base.amount) parts.push(`сумма ${fmtRub(alt.amount)} вместо ${fmtRub(base.amount)}`);
  if (alt.term > base.term) parts.push(`срок ${alt.term} мес. вместо ${base.term}`);
  const load = ev.metrics.load != null ? `, нагрузка ${Math.round(ev.metrics.load * 100)}%` : '';
  return `${parts.join(', ')}. Платёж ${fmtRub(ev.metrics.payment)} в месяц${load}.`;
}

/** Ищет варианты, которые движок одобряет. Каждый вариант повторно проходит тот же скоринг. */
export function findAlternatives(ctx, req, limit = 3) {
  const out = [];
  const seen = new Set();
  const push = (product, term) => {
    const amount = maxApprovable(ctx, { product, term, collateral: req.collateral });
    if (!amount) return;
    // Не предлагаем сумму, заметно большую запрошенной
    const finalAmount = Math.min(amount, roundTo10k(req.amount));
    if (finalAmount < PRODUCTS[product].min) return;
    const key = `${product}-${term}-${finalAmount}`;
    if (seen.has(key)) return;
    const ev = evaluate(ctx, { product, amount: finalAmount, term, collateral: req.collateral });
    if (!ev.approvable) return;
    seen.add(key);
    out.push({
      id: key, product, amount: finalAmount, term,
      rate: ev.rate.value, payment: ev.metrics.payment, load: ev.metrics.load, score: ev.score,
      rationale: describeAlt(req, { product, amount: finalAmount, term }, ev),
    });
  };
  const p = PRODUCTS[req.product];
  push(req.product, Math.min(Math.max(req.term, p.minTerm), p.maxTerm));          // та же программа и срок, меньше сумма
  push(req.product, p.maxTerm >= 24 ? Math.min(p.maxTerm, Math.max(req.term, 24)) : p.maxTerm); // дольше срок
  push(req.product, p.maxTerm);
  for (const other of Object.values(PRODUCTS)) {
    if (other.id === req.product) continue;
    push(other.id, other.defaultTerm);
  }
  // Оставляем разные по сути варианты: сортируем по близости к запросу
  out.sort((a, b) => Math.abs(req.amount - a.amount) - Math.abs(req.amount - b.amount) || a.payment - b.payment);
  return out.slice(0, limit);
}

/** Причины и план действий для клиента: только факторы и направление, без весов и порогов. */
export function explainFor(ev) {
  const reasons = [
    ...ev.hardStops.map((h) => ({ id: h.id, title: h.title, message: h.message, direction: 'down', plan: h.plan })),
    ...ev.violations.map((v) => ({ id: v.id, title: 'Параметры заявки', message: v.message, direction: 'down' })),
    ...ev.factors.filter((f) => f.points < 0).sort((a, b) => a.points - b.points).map((f) => ({ id: f.id, title: f.title, message: f.message, direction: 'down' })),
  ];
  const strengths = ev.factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points).map((f) => ({ id: f.id, title: f.title, message: f.message, direction: 'up' }));
  const plan = [];
  for (const r of reasons) {
    if (r.plan) plan.push(r.plan);
    else if (r.id === 'company_age') plan.push('Вернитесь, когда бизнесу исполнится полгода: срок работы сильно влияет на решение.');
    else if (r.id === 'payment_load' || r.id === 'amount_vs_turnover' || r.id === 'above_turnover_cap') plan.push('Уменьшите сумму или увеличьте срок, чтобы платёж вписался в денежный поток.');
    else if (r.id === 'turnover_stability') plan.push('Направляйте больше регулярных платежей на счёт: стабильные обороты повышают шансы.');
    else if (r.id === 'cash_discipline') plan.push('Держите на счёте неснижаемый остаток, чтобы не уходить в минус.');
    else if (r.id === 'credit_history') plan.push('Закройте открытые просрочки и избегайте новых запросов в бюро кредитных историй.');
    else if (r.id === 'transparent_flags') plan.push('Подтвердите адрес компании документами или обновите сведения в ЕГРЮЛ.');
    else if (r.id === 'tax_debt') plan.push('Погасите налоговую задолженность.');
    else if (r.id === 'unverified_revenue') plan.push('Подтвердите выручку выпиской по счёту.');
  }
  return { reasons, strengths, plan: [...new Set(plan)].slice(0, 4) };
}

/**
 * Решение по заявке.
 * outcome: approve | counter_offer | need_info | decline
 * routing: auto | manual (+ причины ручной проверки)
 */
export function decide(ctx, req, policy = DEFAULT_POLICY) {
  const ev = evaluate(ctx, req);
  const base = {
    engineVersion: ENGINE_VERSION,
    request: ev.request,
    score: ev.score,
    threshold: ev.threshold,
    chance: ev.chance,
    policy: { ...policy },
  };
  const manualReasons = [];
  if (req.amount > policy.autoDecisionLimit) manualReasons.push(`Сумма больше ${fmtRub(policy.autoDecisionLimit)}: решение подтверждает сотрудник банка.`);

  if (ev.missing.length && !ev.hardStops.length) {
    return { ...base, outcome: 'need_info', missing: ev.missing, alternatives: [], explain: explainFor(ev), routing: 'auto', manualReasons: [], evaluation: ev };
  }
  if (ev.hardStops.length) {
    return { ...base, outcome: 'decline', hardStop: true, alternatives: [], explain: explainFor(ev), routing: manualReasons.length ? 'manual' : 'auto', manualReasons, recommendation: 'decline', evaluation: ev };
  }
  if (ev.approvable) {
    if (ev.margin < policy.borderlineMargin) manualReasons.push('Оценка близка к порогу одобрения: нужна проверка сотрудником.');
    return {
      ...base, outcome: 'approve', alternatives: [], explain: explainFor(ev),
      terms: { product: ev.request.product, amount: ev.request.amount, term: ev.request.term, rate: ev.rate.value, payment: ev.metrics.payment, overpayment: ev.metrics.overpayment },
      routing: manualReasons.length ? 'manual' : 'auto', manualReasons, recommendation: 'approve', evaluation: ev,
    };
  }
  const alternatives = findAlternatives(ctx, req);
  if (alternatives.length) {
    return { ...base, outcome: 'counter_offer', alternatives, explain: explainFor(ev), routing: manualReasons.length ? 'manual' : 'auto', manualReasons, recommendation: 'counter_offer', evaluation: ev };
  }
  manualReasons.push('Отказ без жёсткого стоп-фактора подтверждает сотрудник банка.');
  return { ...base, outcome: 'decline', hardStop: false, alternatives: [], explain: explainFor(ev), routing: 'manual', manualReasons, recommendation: 'decline', evaluation: ev };
}

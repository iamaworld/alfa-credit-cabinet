// Оффер для клиента: предодобренный лимит, пересчёт при изменении параметров,
// объяснение «что изменилось и почему», подсказки «что повысит шансы».
import { evaluate, maxApprovable, CHANCE_LABEL, chanceRank } from './scoring.js';
import { PRODUCTS, PURPOSES } from './products.js';
import { fmtRub } from '../util/money.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const OFFER_VALID_DAYS = 30;

function publicFactors(ev) {
  // Клиенту показываем факторы и направление влияния, но не веса и пороги.
  return ev.factors.map(({ id, source, title, value, direction, message }) => ({ id, source, title, value, direction, message }));
}

export function publicEvaluation(ev) {
  return {
    request: ev.request,
    chance: ev.chance,
    chanceLabel: ev.chance === 'unknown' ? 'Нужны данные' : CHANCE_LABEL[ev.chance],
    payment: ev.metrics.payment,
    overpayment: ev.metrics.overpayment,
    rate: { from: ev.rate.from, to: ev.rate.to, parts: ev.rate.components },
    load: ev.metrics.load,
    loadLabel: ev.metrics.load == null ? null : ev.metrics.load <= 0.35 ? 'в норме' : ev.metrics.load <= 0.5 ? 'у верхней границы' : 'выше допустимой',
    freeCashFlow: ev.metrics.freeCashFlow,
    existingMonthly: ev.metrics.existingMonthly,
    capByTurnover: ev.metrics.capByTurnover,
    factors: publicFactors(ev),
    blockers: [
      ...ev.hardStops.map((h) => ({ id: h.id, message: h.message })),
      ...ev.violations.map((v) => ({ id: v.id, message: v.message })),
    ],
    missing: ev.missing,
    approvable: ev.approvable,
    disclaimer: 'Условия предварительные. Итоговые определяются после проверки заявки.',
  };
}

/** Объяснение разницы между двумя расчётами простым языком. */
export function explainChanges(a, b) {
  const out = [];
  const A = a.request, B = b.request;
  const dp = b.metrics.payment - a.metrics.payment;
  if (A.product !== B.product) out.push({ kind: 'product', text: `Продукт сменился на «${PRODUCTS[B.product].name}»: у него свои ставка, срок и лимиты.` });
  if (B.term !== A.term) {
    out.push({ kind: 'term', text: B.term > A.term
      ? `Срок увеличен с ${A.term} до ${B.term} мес.: платёж ${dp < 0 ? 'снизился' : 'изменился'} на ${fmtRub(Math.abs(dp))}, но проценты вы платите дольше.`
      : `Срок сокращён с ${A.term} до ${B.term} мес.: платёж вырос на ${fmtRub(Math.abs(dp))}, зато переплата меньше.` });
  }
  if (B.amount !== A.amount) {
    out.push({ kind: 'amount', text: B.amount > A.amount
      ? `Сумма выросла на ${fmtRub(B.amount - A.amount)}: платёж стал выше на ${fmtRub(Math.abs(dp))}.`
      : `Сумма уменьшилась на ${fmtRub(A.amount - B.amount)}: платёж стал ниже на ${fmtRub(Math.abs(dp))}.` });
  }
  if (!!B.collateral !== !!A.collateral) out.push({ kind: 'collateral', text: B.collateral ? 'Залог указан: ставка и оценка рассчитаны с учётом обеспечения.' : 'Залог убран: ставка и оценка пересчитаны без обеспечения.' });
  const dr = Math.round((b.rate.value - a.rate.value) * 10) / 10;
  if (dr !== 0) {
    const why = [];
    const dt = Math.round((b.rate.components.term - a.rate.components.term) * 100) / 100;
    const dk = b.rate.components.risk - a.rate.components.risk;
    if (dt) why.push(dt > 0 ? 'срок длиннее' : 'срок короче');
    if (dk > 0) why.push('оценка риска ниже');
    if (dk < 0) why.push('оценка риска выше');
    if (b.rate.components.collateral !== a.rate.components.collateral) why.push('изменилось обеспечение');
    if (A.product !== B.product) why.push('другая базовая ставка продукта');
    out.push({ kind: 'rate', text: `Ставка ${dr > 0 ? 'выросла' : 'снизилась'} на ${Math.abs(dr).toFixed(1).replace('.', ',')} п.п.${why.length ? `: ${why.join(', ')}` : ''}.` });
  }
  if (a.metrics.load != null && b.metrics.load != null && Math.abs(b.metrics.load - a.metrics.load) >= 0.01) {
    out.push({ kind: 'load', text: `Платёжная нагрузка ${pct(a.metrics.load)} → ${pct(b.metrics.load)}: ${b.metrics.load <= 0.35 ? 'теперь в норме' : b.metrics.load <= 0.5 ? 'у верхней границы нормы' : 'выше допустимой'}.` });
  }
  if (a.chance !== b.chance && a.chance !== 'unknown' && b.chance !== 'unknown') {
    const better = chanceRank(b.chance) > chanceRank(a.chance);
    const byId = Object.fromEntries(a.factors.map((f) => [f.id, f.points]));
    const moved = b.factors.map((f) => ({ f, d: f.points - (byId[f.id] ?? 0) })).filter((x) => x.d !== 0).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
    out.push({ kind: 'chance', text: `Шанс одобрения: ${CHANCE_LABEL[a.chance].toLowerCase()} → ${CHANCE_LABEL[b.chance].toLowerCase()}${moved ? `. Главная причина: «${moved.f.title.toLowerCase()}» ${better ? 'стал сильнее' : 'стал слабее'}` : ''}.` });
  }
  return out;
}

/** «Что повысит шансы»: проверяем варианты тем же движком, показываем реальный эффект. */
export function improvements(ctx, req, current) {
  if (current.chance === 'high' || current.chance === 'unknown' || current.hardStops.length) return [];
  const product = PRODUCTS[req.product];
  const variants = [];
  for (const dTerm of [6, 12]) {
    const term = Math.min(product.maxTerm, req.term + dTerm);
    if (term > req.term) variants.push({ id: `term-${term}`, label: `Увеличить срок до ${term} мес.`, apply: { term } });
  }
  for (const k of [0.8, 0.6, 0.4]) {
    const amount = Math.max(product.min, Math.floor((req.amount * k) / 10_000) * 10_000);
    if (amount < req.amount) variants.push({ id: `amount-${amount}`, label: `Уменьшить сумму до ${fmtRub(amount)}`, apply: { amount } });
  }
  if (!req.collateral && !product.securedByPurchase) variants.push({ id: 'collateral', label: 'Добавить залог', apply: { collateral: true } });
  const scored = variants.map((v) => {
    const ev = evaluate(ctx, { ...req, ...v.apply });
    return { v, ev, gain: ev.margin - current.margin };
  }).filter((x) => x.gain > 0);
  scored.sort((a, b) => b.gain - a.gain);
  const picked = [];
  const usedKinds = new Set();
  for (const s of scored) {
    const kind = Object.keys(s.v.apply)[0];
    if (usedKinds.has(kind)) continue;
    usedKinds.add(kind);
    picked.push({
      id: s.v.id, label: s.v.label, apply: s.v.apply,
      effect: `Шанс: ${CHANCE_LABEL[current.chance].toLowerCase()} → ${CHANCE_LABEL[s.ev.chance].toLowerCase()}. Платёж ${fmtRub(s.ev.metrics.payment)} в месяц.`,
    });
    if (picked.length === 3) break;
  }
  return picked;
}

export function preview(ctx, req, compareTo) {
  const cur = evaluate(ctx, req);
  const result = publicEvaluation(cur);
  result.improvements = improvements(ctx, cur.request, cur);
  if (compareTo) {
    const prev = evaluate(ctx, compareTo);
    result.changes = explainChanges(prev, cur);
    result.previous = { payment: prev.metrics.payment, rate: prev.rate.value, load: prev.metrics.load, chance: prev.chance };
  }
  return { result, evaluation: cur };
}

export function productFit(ctx, purposeKey) {
  const preferred = PURPOSES[purposeKey]?.product || 'working_capital';
  const order = [preferred, ...Object.keys(PRODUCTS).filter((p) => p !== preferred)];
  return order.map((id, i) => ({
    product: id,
    recommended: i === 0,
    reason: i === 0
      ? ({ overdraft: 'Для кассового разрыва подходит возобновляемый лимит: деньги нужны на короткий срок.',
          equipment: 'Для покупки техники ставка ниже: оборудование становится залогом.',
          working_capital: 'Для текущих расходов и развития подходит кредит на срок до 3 лет без залога.' })[id]
      : PRODUCTS[id].short,
  }));
}

/** Предодобренные предложения по всем продуктам. */
export function preapprovedOffers(ctx, now = new Date()) {
  const expires = new Date(now.getTime() + OFFER_VALID_DAYS * 86400000);
  const offers = [];
  for (const p of Object.values(PRODUCTS)) {
    const term = p.defaultTerm;
    const amount = comfortableAmount(ctx, p, term);
    if (!amount) {
      offers.push({ product: p.id, available: false });
      continue;
    }
    const ev = evaluate(ctx, { product: p.id, amount, term, collateral: false });
    offers.push({
      product: p.id, available: true, amount, term, expiresAt: expires.toISOString(),
      payment: ev.metrics.payment, rate: { from: ev.rate.from, to: ev.rate.to }, load: ev.metrics.load,
      score: undefined,
      why: [
        ...ev.factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((f) => ({ ...pick(f), direction: 'up' })),
        ...ev.factors.filter((f) => f.points < 0).sort((a, b) => a.points - b.points).slice(0, 2).map((f) => ({ ...pick(f), direction: 'down' })),
      ],
      limitedBy: limitReason(ctx, p, amount, term),
    });
  }
  return offers;
}

const pick = ({ id, title, message, value }) => ({ id, title, message, value });

// Предодобренный лимит консервативнее максимума: одобряем с запасом по оценке
// и с платёжной нагрузкой не выше 40%, чтобы клиент не получил «обещание», которое потом отзовут.
const PREAPPROVED_MAX_LOAD = 0.4;
const PREAPPROVED_MIN_MARGIN = 8;

function comfortableAmount(ctx, p, term) {
  const hardMax = maxApprovable(ctx, { product: p.id, term, collateral: false });
  if (!hardMax) return 0;
  const ok = (amount) => {
    const ev = evaluate(ctx, { product: p.id, amount, term, collateral: false });
    return ev.approvable && ev.margin >= PREAPPROVED_MIN_MARGIN && (ev.metrics.load == null || ev.metrics.load <= PREAPPROVED_MAX_LOAD);
  };
  const step = 10_000;
  let lo = Math.ceil(p.min / step), hi = Math.floor(Math.min(hardMax, p.max) / step), best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid * step)) { best = mid * step; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function limitReason(ctx, p, amount, term) {
  const cap = ctx.turnover != null ? Math.floor(ctx.turnover * p.turnoverMultiple) : null;
  if (amount >= p.max - 10_000) return `Лимит продукта: ${fmtRub(p.max)}.`;
  if (cap != null && amount >= cap - 10_000) return `Ограничение по оборотам: не более ${p.turnoverMultiple} мес. оборота.`;
  return 'Ограничение по платёжной нагрузке: платежи не должны занимать слишком большую часть денежного потока.';
}

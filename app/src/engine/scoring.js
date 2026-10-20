// Единый движок факторов. Чистые функции без обращения к БД и сети.
// Им пользуются: предодобренный лимит, редактор оффера, скоринг заявки, причины решения, контр-оферта.
// Скоринг (оценка риска) и кредитное решение разделены: решение принимает decision.js.
import { PRODUCTS, MARGIN_BY_GROUP, okvedGroup, getProduct, ENGINE_VERSION } from './products.js';
import { annuityPayment, overpayment, fmtRub, round1, clamp, monthsBetween } from '../util/money.js';

export const BASE_SCORE = 40;
export const DECLARED_REVENUE_HAIRCUT = 0.8; // выручка «со слов клиента» учитывается с дисконтом

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

/**
 * Сводит данные трёх источников и введённые клиентом данные в контекст расчёта.
 * @param {{fns:object, bki:object, statement:object|null}} data  данные источников
 * @param {{declaredMonthlyRevenue?:number|null, now?:Date}} extra
 */
export function buildContext(data, extra = {}) {
  const now = extra.now || new Date();
  const fns = data.fns;
  const bki = data.bki || { obligations: [], noHistory: true, rating: null, closedWithDelays: 0 };
  const rows = data.statement?.months || [];
  const last6 = rows.slice(-6);

  let turnover = null;
  let turnoverSource = 'none';
  if (last6.length >= 3) {
    turnover = Math.round(mean(last6.map((m) => m.inflow)));
    turnoverSource = 'statement';
  } else if (extra.declaredMonthlyRevenue > 0) {
    turnover = Math.round(extra.declaredMonthlyRevenue * DECLARED_REVENUE_HAIRCUT);
    turnoverSource = 'declared';
  }
  const inflows = rows.map((m) => m.inflow);
  const cv = inflows.length >= 3 && mean(inflows) > 0 ? stdev(inflows) / mean(inflows) : null;
  const group = okvedGroup(fns.okved?.code);

  return {
    inn: fns.inn,
    legalForm: fns.legalForm,
    status: fns.status,
    flags: fns.transparentBusiness || {},
    ageMonths: monthsBetween(fns.registrationDate, now),
    okved: fns.okved,
    okvedGroup: group,
    margin: MARGIN_BY_GROUP[group],
    turnover,
    turnoverSource,
    turnoverCv: cv,
    avgNegativeDays: last6.length ? mean(last6.map((m) => m.negativeDays)) : null,
    statementMonths: rows.length,
    bki: {
      rating: bki.rating,
      noHistory: !!bki.noHistory,
      closedWithDelays: bki.closedWithDelays || 0,
      existingMonthly: (bki.obligations || []).reduce((s, o) => s + (o.monthlyPayment || 0), 0),
      currentOverdue: (bki.obligations || []).filter((o) => o.overdueDays > 0),
    },
  };
}

function termPremium(term) {
  return term > 12 ? ((term - 12) / 6) * 0.25 : 0;
}

export function rateComponents(product, term, score, collateral) {
  const risk = score >= 85 ? -1.0 : score >= 70 ? 0 : score >= 55 ? 1.5 : score >= 45 ? 3.0 : 5.0;
  const col = collateral || product.securedByPurchase ? -1.5 : 0;
  return { base: product.baseRate, term: round1(termPremium(term)), risk, collateral: col };
}
const sumRate = (c) => round1(c.base + c.term + c.risk + c.collateral);

function chanceFor(margin) {
  if (margin >= 15) return 'high';
  if (margin >= 0) return 'medium';
  if (margin >= -12) return 'low';
  return 'very_low';
}
export const CHANCE_LABEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий', very_low: 'Очень низкий' };
const CHANCE_RANK = { very_low: 0, low: 1, medium: 2, high: 3 };
export const chanceRank = (c) => CHANCE_RANK[c] ?? 0;

function scoreFactors(ctx, req, product, rate) {
  const f = [];
  const add = (id, source, title, value, points, message, extra = {}) =>
    f.push({ id, source, title, value, points, direction: points > 0 ? 'up' : points < 0 ? 'down' : 'neutral', message, ...extra });

  // 1. Срок работы (ФНС / ЕГРЮЛ)
  const age = ctx.ageMonths;
  const years = Math.floor(age / 12), y10 = years % 10, y100 = years % 100;
  const yWord = y10 === 1 && y100 !== 11 ? 'год' : y10 >= 2 && y10 <= 4 && (y100 < 12 || y100 > 14) ? 'года' : 'лет';
  const ageText = age >= 24 ? `${years} ${yWord}` : `${age} мес.`;
  if (age < 6) add('company_age', 'ФНС', 'Срок работы бизнеса', ageText, -15, `Бизнес работает меньше полугода (${ageText}): банк осторожнее с такими заявками.`);
  else if (age < 12) add('company_age', 'ФНС', 'Срок работы бизнеса', ageText, -4, `Бизнес работает ${ageText}: история пока короткая.`);
  else if (age < 36) add('company_age', 'ФНС', 'Срок работы бизнеса', ageText, 6, `Бизнес работает ${ageText}: этого достаточно для оценки.`);
  else add('company_age', 'ФНС', 'Срок работы бизнеса', ageText, 12, `Бизнес работает ${ageText}: давняя история помогает.`);

  // 2. Устойчивость оборотов (выписка)
  if (ctx.turnoverSource === 'statement' && ctx.turnoverCv != null) {
    const cv = ctx.turnoverCv;
    const v = `колебания ±${Math.round(cv * 100)}%`;
    if (cv <= 0.12) add('turnover_stability', 'Выписка', 'Устойчивость оборотов', v, 10, 'Обороты стабильны из месяца в месяц.');
    else if (cv <= 0.25) add('turnover_stability', 'Выписка', 'Устойчивость оборотов', v, 0, 'Обороты заметно колеблются, но в разумных пределах.');
    else if (cv <= 0.4) add('turnover_stability', 'Выписка', 'Устойчивость оборотов', v, -6, 'Обороты сильно меняются от месяца к месяцу.');
    else add('turnover_stability', 'Выписка', 'Устойчивость оборотов', v, -10, 'Обороты нестабильны: сложно оценить регулярность поступлений.');
  } else if (ctx.turnoverSource === 'declared') {
    add('unverified_revenue', 'Клиент', 'Подтверждение выручки', 'со слов клиента', -6, 'Выручка указана вами и не подтверждена выпиской: учитываем её с дисконтом.');
  }

  // 3. Платёжная дисциплина по счёту (выписка)
  if (ctx.avgNegativeDays != null && ctx.turnoverSource === 'statement') {
    const d = ctx.avgNegativeDays;
    const v = `${Math.round(d)} дн. в минусе в месяц`;
    if (d < 0.5) add('cash_discipline', 'Выписка', 'Остатки на счёте', v, 5, 'На счёте нет дней с отрицательным остатком.');
    else if (d <= 3) add('cash_discipline', 'Выписка', 'Остатки на счёте', v, 0, 'Изредка бывают дни с нулевым или отрицательным остатком.');
    else if (d <= 7) add('cash_discipline', 'Выписка', 'Остатки на счёте', v, -6, 'Остаток на счёте часто уходит в минус.');
    else add('cash_discipline', 'Выписка', 'Остатки на счёте', v, -10, 'На счёте много дней с отрицательным остатком.');
  }

  // 4. Кредитная история (БКИ)
  {
    let pts = 0;
    const parts = [];
    const rating = ctx.bki.rating;
    const ratingPts = { A: 15, B: 8, C: 0, D: -8, E: -12 };
    if (ctx.bki.noHistory || !rating) { pts += -3; parts.push('кредитной истории нет'); }
    else { pts += ratingPts[rating] ?? 0; parts.push(`рейтинг ${rating}`); }
    if (ctx.bki.closedWithDelays > 0) { pts -= Math.min(10, 5 * ctx.bki.closedWithDelays); parts.push(`закрытых кредитов с просрочками: ${ctx.bki.closedWithDelays}`); }
    const msg = pts > 5 ? 'Кредиты платились вовремя.' : pts >= 0 ? 'Кредитная история нейтральная.' : ctx.bki.noHistory ? 'Кредитной истории нет, оценить платёжную дисциплину сложнее.' : 'В кредитной истории есть отметки о просрочках или слабый рейтинг.';
    add('credit_history', 'БКИ', 'Кредитная история', parts.join(', '), pts, msg);
  }

  // 5. Платёжная нагрузка и масштаб суммы (по оборотам)
  if (ctx.turnover != null) {
    const fcf = ctx.turnover * ctx.margin;
    const payment = annuityPayment(req.amount, rate, req.term);
    const load = (ctx.bki.existingMonthly + payment) / fcf;
    const v = `${Math.round(load * 100)}% от свободного денежного потока`;
    if (load <= 0.35) add('payment_load', 'Расчёт', 'Платёжная нагрузка', v, 12, `Платежи (с учётом текущих кредитов) занимают около ${Math.round(load * 100)}% свободного денежного потока: нагрузка в норме.`, { improvable: false });
    else if (load <= 0.5) add('payment_load', 'Расчёт', 'Платёжная нагрузка', v, 4, `Платежи занимают около ${Math.round(load * 100)}% свободного денежного потока: нагрузка у верхней границы нормы.`, { improvable: true });
    else if (load <= 0.7) add('payment_load', 'Расчёт', 'Платёжная нагрузка', v, -12, `Платежи занимают около ${Math.round(load * 100)}% свободного денежного потока: нагрузка выше допустимой.`, { improvable: true });
    else add('payment_load', 'Расчёт', 'Платёжная нагрузка', v, -28, `Платежи занимают около ${Math.round(load * 100)}% свободного денежного потока: нагрузка слишком высока.`, { improvable: true });

    const mult = req.amount / ctx.turnover;
    const mv = `${mult.toFixed(1).replace('.', ',')} месячных оборота`;
    if (mult <= 1) add('amount_vs_turnover', 'Расчёт', 'Сумма относительно оборотов', mv, 4, 'Запрошенная сумма небольшая по сравнению с оборотами.');
    else if (mult <= 2) add('amount_vs_turnover', 'Расчёт', 'Сумма относительно оборотов', mv, 0, 'Сумма соразмерна оборотам бизнеса.');
    else if (mult <= 3) add('amount_vs_turnover', 'Расчёт', 'Сумма относительно оборотов', mv, -8, 'Сумма велика по сравнению с оборотами.');
    else add('amount_vs_turnover', 'Расчёт', 'Сумма относительно оборотов', mv, -18, 'Сумма сильно превышает обороты бизнеса.');
  }

  // 6. Залог
  if (req.collateral || product.securedByPurchase) {
    add('collateral', 'Заявка', 'Обеспечение', product.securedByPurchase ? 'приобретаемое оборудование' : 'залог указан', 6, product.securedByPurchase ? 'Приобретаемое оборудование становится залогом.' : 'Вы предложили залог: это снижает риск банка.');
  }

  // 7. Отметки «Прозрачного бизнеса»
  if (ctx.flags.massAddress) add('transparent_flags', 'ФНС', 'Сведения о компании', 'адрес массовой регистрации', -8, 'Адрес компании числится как адрес массовой регистрации.');
  if (ctx.flags.taxDebt) add('tax_debt', 'ФНС', 'Налоги', 'есть задолженность', -12, 'Есть задолженность по налогам.');
  if (ctx.flags.unreliableData) add('unreliable', 'ФНС', 'Достоверность сведений', 'отметка о недостоверности', -15, 'В реестре есть отметка о недостоверности сведений.');

  return f;
}

function hardStopsFor(ctx) {
  const stops = [];
  if (ctx.status !== 'ACTIVE') stops.push({ id: 'company_status', title: 'Статус организации', message: 'Организация находится в процессе ликвидации или прекратила деятельность.', plan: 'Кредитование недоступно, пока организация не вернётся к обычному статусу.' });
  if (ctx.bki.currentOverdue.length) {
    const o = ctx.bki.currentOverdue[0];
    stops.push({ id: 'current_overdue', title: 'Текущая просрочка', message: `По действующему обязательству («${o.type}») есть просрочка ${o.overdueDays} дн.`, plan: 'Погасите просрочку, вернитесь после её закрытия.' });
  }
  if (ctx.flags.disqualifiedPerson) stops.push({ id: 'disqualified', title: 'Руководитель', message: 'Руководитель числится дисквалифицированным лицом.', plan: 'Смените руководителя в реестре и подайте заявку снова.' });
  return stops;
}

/**
 * Оценивает запрос (продукт, сумма, срок, залог) для контекста компании.
 * Возвращает метрики, факторы, оценку и признак «проходит ли по правилам продукта».
 */
export function evaluate(ctx, req) {
  const product = getProduct(req.product);
  const violations = [];
  if (req.amount < product.min) violations.push({ id: 'amount_min', message: `Минимальная сумма — ${fmtRub(product.min)}.` });
  if (req.amount > product.max) violations.push({ id: 'amount_max', message: `Максимальная сумма — ${fmtRub(product.max)}.` });
  if (req.term < product.minTerm || req.term > product.maxTerm) violations.push({ id: 'term', message: `Срок — от ${product.minTerm} до ${product.maxTerm} мес.` });

  const hardStops = hardStopsFor(ctx);
  const missing = [];
  if (ctx.turnover == null) {
    missing.push({ id: 'monthly_revenue', label: 'Среднемесячная выручка за последние 6 месяцев, ₽', type: 'number', reason: 'Не нашли обороты по вашим счетам в подключённых источниках.' });
  }

  const amount = clamp(req.amount, 1, product.max * 10);
  const term = clamp(req.term, 1, 120);
  const r0 = { ...req, amount, term };

  // Фиксированная точка «ставка ↔ оценка ↔ нагрузка»: до 4 итераций
  let rate = sumRate(rateComponents(product, term, 55, req.collateral));
  let factors = [];
  let score = BASE_SCORE;
  for (let i = 0; i < 4; i++) {
    factors = scoreFactors(ctx, r0, product, rate);
    score = clamp(BASE_SCORE + factors.reduce((s, x) => s + x.points, 0), 0, 100);
    const next = sumRate(rateComponents(product, term, score, req.collateral));
    if (Math.abs(next - rate) < 0.05) { rate = next; break; }
    rate = next;
  }
  const comps = rateComponents(product, term, score, req.collateral);
  rate = sumRate(comps);

  const payment = annuityPayment(amount, rate, term);
  const fcf = ctx.turnover != null ? ctx.turnover * ctx.margin : null;
  const load = fcf ? (ctx.bki.existingMonthly + payment) / fcf : null;
  const capByTurnover = ctx.turnover != null ? Math.floor(ctx.turnover * product.turnoverMultiple) : null;
  if (capByTurnover != null && amount > capByTurnover) {
    violations.push({ id: 'above_turnover_cap', message: `Для вашего оборота по этому продукту доступно не более ${fmtRub(capByTurnover)}.` });
  }

  const margin = score - product.approveThreshold;
  const chance = missing.length ? 'unknown' : hardStops.length ? 'very_low' : chanceFor(margin);
  return {
    engineVersion: ENGINE_VERSION,
    request: { product: product.id, amount, term, collateral: !!req.collateral },
    score,
    threshold: product.approveThreshold,
    margin,
    chance,
    factors,
    hardStops,
    missing,
    violations,
    rate: { value: rate, from: round1(rate - 0.5), to: round1(rate + 1.0), components: comps },
    metrics: {
      payment,
      overpayment: overpayment(amount, payment, term),
      load: load == null ? null : Math.round(load * 1000) / 1000,
      freeCashFlow: fcf == null ? null : Math.round(fcf),
      turnover: ctx.turnover,
      turnoverSource: ctx.turnoverSource,
      existingMonthly: ctx.bki.existingMonthly,
      capByTurnover,
    },
    approvable: !hardStops.length && !missing.length && !violations.length && margin >= 0,
  };
}

/** Максимальная сумма, которую движок готов одобрить при заданных продукте и сроке (шаг 10 000 ₽). */
export function maxApprovable(ctx, { product: productId, term, collateral }) {
  const product = getProduct(productId);
  const step = 10_000;
  let lo = Math.ceil(product.min / step);
  const cap = Math.min(product.max, ctx.turnover != null ? Math.floor(ctx.turnover * product.turnoverMultiple) : product.max);
  let hi = Math.floor(cap / step);
  const ok = (units) => evaluate(ctx, { product: productId, amount: units * step, term, collateral }).approvable;
  if (hi < lo || !ok(lo)) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid - 1;
  }
  return lo * step;
}

export { PRODUCTS };

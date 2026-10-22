// Справка аналитику по заявке: факты с источниками и вывод по правилам.
// Факты собирает код из данных заявки — у каждого факта есть источник, справка всегда верна и мгновенна.
// Языковую модель для справки пробовали (Qwen3-1.7B): она путала факты «за» и «против» и отвечала 16–40 с,
// поэтому вывод и вопросы строятся по правилам. ИИ остаётся там, где он точен, — в разборе задачи клиента.
// Решение принимает аналитик; справка — подсказка, а не заключение.
import { PRODUCTS, PURPOSES } from '../engine/products.js';
import { forecastCashflow, monthIn } from '../engine/cashflow.js';

const rub = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const mln = (n) => (Math.abs(n) >= 1_000_000 ? `${String(+(n / 1_000_000).toFixed(2)).replace('.', ',')} млн ₽` : `${Math.round(n / 1000).toLocaleString('ru-RU')} тыс. ₽`);
const years = (m) => (m >= 24 ? `${Math.floor(m / 12)} лет` : `${m} мес.`);

/** Факты по заявке из представления аналитика. tone: '+' помогает, '-' мешает, '0' нейтрально. */
export function buildFacts(view) {
  const f = [];
  const add = (id, source, tone, text) => f.push({ id, source, tone, text });
  const a = view.application, req = a.request, dec = view.decision, ev = dec?.evaluation, ctx = view.context, fns = view.company;
  const product = PRODUCTS[req.product];

  add('request', 'Заявка', '0', `${product.name}: ${mln(req.amount)} на ${req.term} мес${a.purpose ? `, цель — ${PURPOSES[a.purpose]?.label.toLowerCase()}` : ''}${req.collateral ? ', с залогом' : ''}.`);

  if (fns) {
    if (fns.status !== 'ACTIVE') add('status', 'ЕГРЮЛ', '-', 'Компания в процессе ликвидации или прекратила деятельность.');
    if (ctx) add('age', 'ЕГРЮЛ', ctx.ageMonths >= 12 ? '+' : '-', `Компания работает ${years(ctx.ageMonths)}, ОКВЭД ${fns.okved?.code} — ${fns.okved?.title?.toLowerCase()}.`);
    const flags = fns.transparentBusiness || {};
    if (flags.massAddress) add('mass_address', 'Прозрачный бизнес', '-', 'Адрес массовой регистрации.');
    if (flags.taxDebt) add('tax_debt', 'Прозрачный бизнес', '-', 'Есть задолженность по налогам.');
    if (flags.unreliableData) add('unreliable', 'Прозрачный бизнес', '-', 'Отметка о недостоверности сведений в реестре.');
  }

  const bki = view.credit;
  if (bki) {
    const overdue = (bki.obligations || []).filter((o) => o.overdueDays > 0);
    if (overdue.length) add('bki_overdue', 'БКИ', '-', `Текущая просрочка ${overdue[0].overdueDays} дн. по обязательству «${overdue[0].type}».`);
    if (bki.noHistory) add('bki_history', 'БКИ', '0', 'Кредитной истории нет.');
    else add('bki_history', 'БКИ', ['A', 'B'].includes(bki.rating) ? '+' : '-', `Рейтинг ${bki.rating}${bki.closedWithDelays ? `, закрытых кредитов с просрочками: ${bki.closedWithDelays}` : ', закрытые кредиты без просрочек'}.`);
    if (ctx?.existingMonthly) add('bki_load', 'БКИ', '0', `Платежи по действующим кредитам — ${rub(ctx.existingMonthly)} в месяц.`);
  }

  if (ctx?.turnover) {
    const declared = ctx.turnoverSource === 'declared';
    add('turnover', declared ? 'Клиент' : 'Выписка', declared ? '-' : '0', declared
      ? `Оборот ${mln(ctx.turnover)} в месяц — со слов клиента, выпиской не подтверждён (учтён с дисконтом).`
      : `Средний оборот по счёту за 6 месяцев — ${mln(ctx.turnover)} в месяц.`);
    if (ctx.cv != null) add('stability', 'Выписка', ctx.cv <= 0.12 ? '+' : ctx.cv > 0.25 ? '-' : '0', `Колебания поступлений ±${Math.round(ctx.cv * 100)} % от месяца к месяцу.`);
  } else add('turnover', 'Выписка', '-', 'Обороты по счёту не видны: выписки нет.');
  const months = view.statement?.months || [];
  if (months.length) {
    const neg = months.slice(-6).reduce((s, m) => s + (m.negativeDays || 0), 0) / Math.min(6, months.length);
    if (neg >= 1) add('negative_days', 'Выписка', '-', `В среднем ${Math.round(neg)} дн. в месяц с отрицательным остатком.`);
  }

  if (ev) {
    if (ev.metrics.load != null) add('load', 'Движок', ev.metrics.load <= 0.5 ? '+' : '-', `Платёж ${rub(ev.metrics.payment)} в месяц — ${Math.round(ev.metrics.load * 100)} % свободного денежного потока.`);
    add('score', 'Движок', ev.margin >= 0 ? '+' : '-', `Оценка ${ev.score} при пороге ${ev.threshold} (запас ${ev.margin >= 0 ? '+' : ''}${ev.margin}).`);
    for (const h of ev.hardStops || []) add(`stop_${h.id}`, 'Политика', '-', `Стоп-фактор: ${h.message}`);
  }
  if (dec?.manualReasons?.length) add('manual', 'Политика', '0', `На ручной проверке: ${dec.manualReasons.join(' ')}`);
  if (dec?.degraded) add('degraded', 'Источники', '-', 'Часть данных взята из сохранённой копии: источник был недоступен.');

  // Денежный календарь по выписке заявки: как запрошенный кредит ляжет на остаток, в том числе при падении выручки
  if (ev && months.length) {
    const loan = { amount: req.amount, payment: ev.metrics.payment, term: req.term, purchase: product.securedByPurchase, revolving: req.product === 'overdraft', rate: ev.rate?.value };
    const cf = forecastCashflow({ statement: months, loan });
    if (cf?.withLoan) {
      const w = cf.withLoan;
      if (w.gaps.length) add('cash_gap', 'Календарь', '-', `С этим кредитом остаток уходит в минус ${monthIn(w.gaps[0].month)}: до ${mln(Math.abs(w.minBalance))}.`);
      else add('cash_gap', 'Календарь', '+', `С этим кредитом остаток весь год в плюсе, минимум ${mln(w.minBalance)} ${monthIn(w.minMonth)}.`);
      if (w.closesGaps) add('cash_closes', 'Календарь', '+', 'Без кредита в прогнозе есть разрыв — кредит его закрывает.');
      const stress = forecastCashflow({ statement: months, loan, inflowFactor: 0.8 });
      if (stress?.withLoan) add('stress', 'Календарь', stress.withLoan.gaps.length ? '-' : '+', stress.withLoan.gaps.length
        ? `Если выручка упадёт на 20 %, остаток с кредитом уйдёт в минус ${monthIn(stress.withLoan.gaps[0].month)}.`
        : 'Даже при падении выручки на 20 % остаток с кредитом остаётся в плюсе.');
    }
  }

  for (const q of view.infoRequests || []) if (q.status === 'answered') add(`answer_${q.id}`, 'Клиент', '0', `Ответ клиента на запрос банка: ${q.answer}`);
  return f;
}

// Серьёзность фактов «против»: что аналитику смотреть первым
const SEVERITY = ['stop_', 'status', 'bki_overdue', 'cash_gap', 'stress', 'load', 'score', 'tax_debt', 'unreliable', 'turnover', 'bki_history', 'stability', 'negative_days', 'mass_address', 'degraded'];
const rank = (id) => { const i = SEVERITY.findIndex((p) => id === p || id.startsWith(p)); return i < 0 ? SEVERITY.length : i; };

// Что спросить клиента, чтобы снять сомнение по факту
const QUESTIONS = {
  cash_gap: 'Как вы планируете пройти месяц, когда остаток уходит в минус: есть ли поступления, которых нет в выписке?',
  stress: 'Что будет с выручкой, если крупный покупатель задержит оплату или уйдёт?',
  load: 'Есть ли поступления помимо расчётного счёта, из которых вы будете платить по кредиту?',
  bki_overdue: 'Когда и из каких денег будет погашена текущая просрочка?',
  bki_history: 'Почему по прошлым кредитам были просрочки и что изменилось с тех пор?',
  turnover: 'Можете подключить выписку по счёту, чтобы подтвердить выручку?',
  stability: 'Почему выручка сильно меняется от месяца к месяцу: сезонность или разовые сделки?',
  negative_days: 'Почему на счёте бывают дни с отрицательным остатком?',
  tax_debt: 'Когда будет погашена задолженность по налогам?',
  mass_address: 'Подтвердите фактический адрес компании: договор аренды или собственность.',
  unreliable: 'Подайте актуальные сведения в реестр: отметка о недостоверности мешает решению.',
};
const WHY = {
  cash_gap: 'Кредит не помещается в денежный поток бизнеса в этот месяц.',
  stress: 'Запаса прочности мало: небольшое падение выручки — и платить будет нечем.',
  load: 'Платёж забирает большую часть свободных денег.',
  score: 'Оценка ниже порога: одобрение будет исключением из политики.',
  bki_overdue: 'Текущая просрочка — стоп-фактор по политике.',
  bki_history: 'Платёжная дисциплина в прошлом была слабой.',
  turnover: 'Выручка не подтверждена данными банка.',
  stability: 'Поступления нестабильны — сложнее оценить, хватит ли на платёж.',
  negative_days: 'Счёт регулярно уходит в минус — признак кассовых разрывов.',
  degraded: 'Решение опирается на устаревшие данные — стоит повторить проверку.',
};

const REC = { approve: 'одобрить', counter_offer: 'предложить другие условия', decline: 'отказать', need_info: 'запросить данные' };

/** Вывод, на что смотреть и вопросы клиенту — по правилам из фактов. */
export function opinionFrom(facts, recommendation) {
  const minus = facts.filter((x) => x.tone === '-').sort((a, b) => rank(a.id) - rank(b.id));
  const plus = facts.filter((x) => x.tone === '+');
  const manual = facts.find((x) => x.id === 'manual');
  const hard = minus.find((x) => x.id.startsWith('stop_') || x.id === 'status');
  let summary;
  if (hard) summary = `Есть стоп-фактор — одобрение по политике невозможно. Движок рекомендует ${REC[recommendation] || 'отказать'}.`;
  else if (!minus.length) summary = `Сильная заявка: все ключевые факторы за (${plus.length}).${manual ? ' На ручной проверке только по правилам политики, а не из-за рисков.' : ''} Движок рекомендует ${REC[recommendation] || '—'}.`;
  else summary = `Факторов за — ${plus.length}, против — ${minus.length}. Главное сомнение: ${minus[0].text.charAt(0).toLowerCase()}${minus[0].text.slice(1)} Движок рекомендует ${REC[recommendation] || '—'}.`;
  return {
    summary,
    attention: minus.slice(0, 3).map((x) => ({ fact: x.id, why: WHY[x.id.startsWith('stop_') ? 'bki_overdue' : x.id] || 'Фактор против одобрения — проверьте его в первую очередь.' })),
    questions: [...new Set(minus.map((x) => QUESTIONS[x.id]).filter(Boolean))].slice(0, 2),
  };
}

export function briefFor(view) {
  const facts = buildFacts(view);
  const recommendation = view.decision?.recommendation || view.decision?.outcome;
  return { facts, recommendation, opinion: opinionFrom(facts, recommendation) };
}

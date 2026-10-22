// Денежный календарь: прогноз остатка на счёте на 12 месяцев по выписке.
// Чистые функции без обращения к БД и сети. Прогноз повторяет то, что повторяется:
// постоянные расходы (зарплата, аренда, прочее), долю поставщиков от выручки, налоги по месяцам года
// и ежегодные события прошлого года. Разовые траты прошлого года в прогноз не переносятся.
// Это учебная модель: она показывает форму денежного потока, а не обещает точную сумму.

const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const monthIn = (ym) => `в ${MONTH_IN[Number(ym.slice(5, 7)) - 1]}`;
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const monthUntil = (ym) => `до ${MONTH_GEN[Number(ym.slice(5, 7)) - 1]}`;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const r1000 = (n) => Math.round(n / 1000) * 1000;
const nextMonth = (ym, k) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1)); return d.toISOString().slice(0, 7); };

/**
 * @param {object} args
 * @param {Array} args.statement  месяцы выписки: { month, inflow, outflow, balance, breakdown?, events? }
 * @param {object} [args.loan]    { amount, payment, term, purchase, revolving, rate }
 *   purchase  — деньги сразу уходят на покупку (оборудование), на счёт не приходят;
 *   revolving — овердрафт: лимит берётся, только когда остаток уходит в минус, проценты (rate, % годовых)
 *               платятся за использованную сумму, долг гасится поступлениями
 * @param {number} [args.horizon] сколько месяцев прогнозировать
 * @param {number} [args.inflowFactor] стресс-сценарий: поступления × коэффициент (0.8 — выручка на 20 % ниже)
 * @returns {null | { history, forecast, gaps, minBalance, suggestion, withLoan }}
 */
export function forecastCashflow({ statement, loan = null, horizon = 12, inflowFactor = 1 }) {
  const hist = (statement || []).filter((m) => Number.isFinite(m.balance));
  if (hist.length < 2) return null;
  const last6 = hist.slice(-6), last3 = hist.slice(-3);
  const inflow = r1000(mean(last6.map((m) => m.inflow)) * inflowFactor);
  const part = (key) => r1000(mean(last3.map((m) => m.breakdown?.[key] ?? 0)));
  const structured = hist.every((m) => m.breakdown);
  // Без разбивки списаний — простая модель: средняя доля списаний от поступлений
  const fixed = structured ? { payroll: part('payroll'), rent: part('rent'), other: part('other') } : null;
  const supplierShare = structured ? mean(last6.map((m) => m.breakdown.suppliers / m.inflow)) : mean(last6.map((m) => m.outflow / m.inflow));
  const ownerShare = structured ? mean(last6.map((m) => (m.breakdown.owner || 0) / m.inflow)) : 0;
  const byMonthOfYear = (ym) => hist.find((m) => m.month.slice(5, 7) === ym.slice(5, 7));

  let balance = hist[hist.length - 1].balance;
  let withLoanBalance = balance;
  let interestPaid = 0, drawnMax = 0; // для овердрафта
  const forecast = [];
  for (let k = 1; k <= horizon; k++) {
    const month = nextMonth(hist[hist.length - 1].month, k);
    const prev = byMonthOfYear(month); // тот же месяц прошлого года
    const items = [];
    if (fixed) {
      items.push({ label: 'Зарплата', amount: fixed.payroll }, { label: 'Аренда', amount: fixed.rent });
      if (fixed.other) items.push({ label: 'Прочие расходы', amount: fixed.other });
    }
    items.push({ label: fixed ? 'Поставщики' : 'Обычные расходы', amount: r1000(inflow * supplierShare) });
    const owner = r1000(inflow * ownerShare);
    if (owner) items.push({ label: 'Вывод собственнику', amount: owner });
    if (prev?.breakdown?.taxes) items.push({ label: 'Налог за квартал', amount: prev.breakdown.taxes, kind: 'tax' });
    for (const e of prev?.events || []) if (e.recurring) items.push({ label: e.label, amount: e.amount, kind: 'event' });
    const outflow = items.reduce((s, x) => s + x.amount, 0);
    balance += inflow - outflow;

    let loanFlow = 0;
    if (loan?.revolving) {
      // Сколько не хватает с учётом уже уплаченных процентов — столько и берём из лимита (в пределах срока)
      const own = balance - interestPaid;
      const drawn = k <= loan.term ? Math.min(loan.amount, Math.max(0, -own)) : 0;
      const interest = r1000((drawn * (loan.rate || 0)) / 1200); // спишется со счёта в следующем месяце
      drawnMax = Math.max(drawnMax, drawn);
      loanFlow = drawn;
      withLoanBalance = own + drawn;
      interestPaid += interest;
    } else {
      if (loan) {
        if (k === 1 && !loan.purchase) loanFlow += loan.amount; // деньги пришли на счёт
        if (k >= 2 && k - 1 <= loan.term) loanFlow -= loan.payment; // платежи со следующего месяца
      }
      withLoanBalance += inflow - outflow + loanFlow;
    }
    forecast.push({
      month, inflow, outflow, owner, balance: r1000(balance),
      events: items.filter((x) => x.kind).map(({ label, amount }) => ({ label, amount })),
      ...(loan ? { loanFlow: r1000(loanFlow), balanceWithLoan: r1000(withLoanBalance) } : {}),
    });
  }

  const gapsOf = (key) => forecast.filter((f) => f[key] < 0).map((f) => ({ month: f.month, balance: f[key], events: f.events }));
  const gaps = gapsOf('balance');
  const min = forecast.reduce((a, f) => (f.balance < a.balance ? f : a), forecast[0]);

  // Подсказка: закрыть разрыв овердрафтом с запасом 15 % и на срок до восстановления остатка
  let suggestion = null;
  if (gaps.length) {
    const lastGapIdx = forecast.findIndex((f) => f.month === gaps[gaps.length - 1].month);
    const amount = Math.min(5_000_000, Math.max(100_000, Math.ceil((-min.balance * 1.15) / 50_000) * 50_000));
    // первая буква строчная, аббревиатуры (УСН, ТО) — как есть
    const cause = min.events.length ? min.events.map((e) => e.label[0].toLowerCase() + e.label.slice(1)).join(', ') : 'расходы больше поступлений';
    suggestion = {
      product: 'overdraft', amount, term: Math.min(12, Math.max(3, lastGapIdx + 2)), purpose: 'cash_gap', // до конца последнего разрыва и месяц запаса на проценты
      reason: `${monthIn(min.month)[0].toUpperCase()}${monthIn(min.month).slice(1)} остаток может уйти в минус примерно на ${Math.round(-min.balance / 1000).toLocaleString('ru-RU')} тыс. ₽: ${cause}.`,
    };
  }

  let withLoan = null;
  if (loan) {
    const g = gapsOf('balanceWithLoan');
    const minL = forecast.reduce((a, f) => (f.balanceWithLoan < a.balanceWithLoan ? f : a), forecast[0]);
    withLoan = { gaps: g, minBalance: minL.balanceWithLoan, minMonth: minL.month, closesGaps: gaps.length > 0 && g.length === 0, createsGaps: gaps.length === 0 && g.length > 0,
      ...(loan.revolving ? { revolving: true, drawnMax: r1000(drawnMax), interest: r1000(interestPaid) } : {}) };
  }

  return {
    history: hist.slice(-6).map(({ month, inflow: i, outflow: o, balance: b, events }) => ({ month, inflow: i, outflow: o, balance: b, events: (events || []).map(({ label, amount }) => ({ label, amount })) })),
    forecast, gaps, minBalance: min.balance, minMonth: min.month, suggestion, withLoan,
    method: structured ? 'structured' : 'average',
  };
}

// ---------- Автопилот денег: копилка под крупный платёж и автозащита от разрыва ----------
// Копилка не создаёт денег: она откладывает часть поступлений из вывода собственнику в месяцы до разрыва,
// поэтому денег на счёте к нужному месяцу больше. Защита — резервный лимит: берётся, только когда
// остаток уходит в минус, гасится поступлениями, проценты — за использованную сумму со следующего месяца.

/**
 * @param {object} cf  результат forecastCashflow без кредита
 * @param {{reserveShare?: number, protectionLimit?: number, rate?: number}} opts
 */
export function simulateAutopilot(cf, { reserveShare = 0, protectionLimit = 0, rate = 0 } = {}) {
  const lastGap = cf.forecast.map((f) => f.balance < 0).lastIndexOf(true); // копим, пока впереди есть разрыв
  let reserved = 0, interest = 0, drawnMax = 0, reserveMonths = 0, reserveUntil = null;
  const months = cf.forecast.map((f, i) => {
    const r = reserveShare > 0 && i < lastGap ? Math.min(r1000(f.inflow * reserveShare), f.owner || 0) : 0;
    if (r) reserveUntil = cf.forecast[i + 1].month;
    if (r) reserveMonths++;
    reserved += r;
    const own = f.balance + reserved - interest;
    const drawn = protectionLimit > 0 ? Math.min(protectionLimit, Math.max(0, -own)) : 0;
    drawnMax = Math.max(drawnMax, drawn);
    const balanceAuto = own + drawn;
    interest += r1000((drawn * rate) / 1200); // проценты спишутся в следующем месяце
    return { month: f.month, reserve: r, protection: drawn, balanceAuto: r1000(balanceAuto) };
  });
  const gapsLeft = months.filter((m) => m.balanceAuto < 0).map((m) => m.month);
  return {
    months, reserveTotal: reserved, reserveMonths, reserveUntil,
    protectionMax: r1000(drawnMax), interest: r1000(interest), gapsLeft,
    minBalance: Math.min(...months.map((m) => m.balanceAuto)),
  };
}

/** Подбор: минимальный процент копилки (не больше доли вывода собственнику), который закрывает разрывы, и лимит защиты на остаток. */
export function suggestAutopilot(cf) {
  if (!cf?.gaps.length) return null;
  const ownerShare = Math.max(0, ...cf.forecast.map((f) => (f.owner || 0) / f.inflow));
  const maxShare = Math.min(0.2, Math.ceil(ownerShare * 100) / 100); // больше, чем выводится, отложить нельзя
  let share = 0;
  for (let s = 0.01; s <= maxShare + 1e-9; s += 0.01) {
    share = Math.round(s * 100) / 100;
    if (!simulateAutopilot(cf, { reserveShare: share }).gapsLeft.length) break;
  }
  const sim = simulateAutopilot(cf, { reserveShare: share });
  const reserveShare = sim.reserveTotal > 0 ? share : 0;
  const residual = sim.gapsLeft.length ? -sim.minBalance : 0;
  return {
    reserveShare,
    reserveCloses: reserveShare > 0 && !sim.gapsLeft.length,
    protectionLimit: residual > 0 ? Math.min(5_000_000, Math.max(100_000, Math.ceil((residual * 1.15) / 50_000) * 50_000)) : 0,
  };
}

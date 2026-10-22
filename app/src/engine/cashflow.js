// Денежный календарь: прогноз остатка на счёте на 12 месяцев по выписке.
// Чистые функции без обращения к БД и сети. Прогноз повторяет то, что повторяется:
// постоянные расходы (зарплата, аренда, прочее), долю поставщиков от выручки, налоги по месяцам года
// и ежегодные события прошлого года. Разовые траты прошлого года в прогноз не переносятся.
// Это учебная модель: она показывает форму денежного потока, а не обещает точную сумму.

const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const monthIn = (ym) => `в ${MONTH_IN[Number(ym.slice(5, 7)) - 1]}`;
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
 * @returns {null | { history, forecast, gaps, minBalance, suggestion, withLoan }}
 */
export function forecastCashflow({ statement, loan = null, horizon = 12 }) {
  const hist = (statement || []).filter((m) => Number.isFinite(m.balance));
  if (hist.length < 2) return null;
  const last6 = hist.slice(-6), last3 = hist.slice(-3);
  const inflow = r1000(mean(last6.map((m) => m.inflow)));
  const part = (key) => r1000(mean(last3.map((m) => m.breakdown?.[key] ?? 0)));
  const structured = hist.every((m) => m.breakdown);
  // Без разбивки списаний — простая модель: средняя доля списаний от поступлений
  const fixed = structured ? { payroll: part('payroll'), rent: part('rent'), other: part('other') } : null;
  const supplierShare = structured ? mean(last6.map((m) => m.breakdown.suppliers / m.inflow)) : mean(last6.map((m) => m.outflow / m.inflow));
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
      month, inflow, outflow, balance: r1000(balance),
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

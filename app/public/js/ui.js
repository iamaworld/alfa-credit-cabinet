import { icon } from './icons.js';

// Небольшие помощники для построения интерфейса без сборки. Текст всегда вставляется как text node: XSS исключён.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const rub = (n) => (n == null ? '—' : `${nf.format(Math.round(n))} ₽`);
export const num = (n) => nf.format(Math.round(n));
export const pct1 = (n) => `${String(Math.round(n * 10) / 10).replace('.', ',')} %`;
export const rateRange = ({ from, to }) => (from === to ? pct1(from) : `${String(from).replace('.', ',')}–${pct1(to)}`);
export const pct0 = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}
export const months = (n) => {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'месяц' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'месяца' : 'месяцев';
  return `${n} ${w}`;
};
export const date = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export function age(months) {
  if (months == null) return '';
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} ${y === 1 ? 'год' : y < 5 ? 'года' : 'лет'}` : '', m ? `${m} мес.` : ''].filter(Boolean).join(' ') || 'меньше месяца';
}

export function toast(message, bad = false) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, message);
  box.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}

export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

export function meter(value, max, tone = '') {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return h('div', { class: `meter ${tone}`, role: 'img', 'aria-label': `${Math.round(w)}%` }, h('i', { style: { width: `${w}%` } }));
}

export function badge(text, tone = '') {
  return h('span', { class: `badge ${tone}` }, tone === 'progress' ? h('span', { class: 'dot' }) : null, text);
}

export function factorList(items) {
  return h('ul', { class: 'plain' }, items.map((f) =>
    h('li', { class: 'factor' },
      h('span', { class: `arrow ${f.direction === 'up' ? 'up' : f.direction === 'down' ? 'down' : 'flat'}` }, icon(f.direction === 'up' ? 'arrowUp' : f.direction === 'down' ? 'arrowDown' : 'minus', 16)),
      h('div', null, h('b', null, f.title), f.message ? h('span', null, f.message) : null))));
}

export function skeleton(lines = 3) {
  return h('div', { class: 'stack' }, Array.from({ length: lines }, () => h('div', { class: 'skeleton' })));
}

export { icon };
export const PRODUCT_ICON = { working_capital: 'О', equipment: 'Т', overdraft: 'Р' };
export function newKey() { return crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`; }

// Поле суммы в рублях: показывает разряды пробелами («1 500 000»), отдаёт число через .getValue().
export function moneyInput(attrs = {}, onValue = () => {}) {
  const el = h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', ...attrs });
  const parse = () => { const d = el.value.replace(/\D/g, ''); return d ? Number(d) : null; };
  const show = (n) => { el.value = n == null ? '' : num(n); };
  el.addEventListener('input', () => {
    const fromEnd = el.value.length - (el.selectionStart ?? el.value.length);
    const v = parse();
    show(v);
    const pos = Math.max(0, el.value.length - fromEnd);
    try { el.setSelectionRange(pos, pos); } catch { /* поле не в фокусе */ }
    onValue(v);
  });
  el.getValue = parse;
  el.setValue = show;
  if (attrs.value !== undefined && attrs.value !== null && attrs.value !== '') show(Number(attrs.value));
  return el;
}

// Аннуитетный график: та же формула, что и на сервере (util/money.js).
export function paymentSchedule({ amount, rate, term, payment }, start = new Date()) {
  const r = rate / 1200;
  let balance = amount;
  const rows = [];
  for (let i = 1; i <= term; i++) {
    const interest = Math.round(balance * r);
    let principal = payment - interest;
    if (i === term || principal > balance) principal = balance;
    balance -= principal;
    const d = new Date(start.getFullYear(), start.getMonth() + i, Math.min(start.getDate(), 28));
    rows.push({ n: i, date: d, payment: principal + interest, principal, interest, balance });
  }
  return rows;
}

export function scheduleBlock(terms, open = false) {
  if (!terms?.payment || !terms.term) return null;
  const rows = paymentSchedule(terms);
  // Итог берём как на сервере (платёж × срок), чтобы цифры на странице не расходились из-за округления
  const total = terms.payment * terms.term;
  const fmt = (d) => d.toLocaleDateString('ru-RU');
  return h('details', { class: 'why', open },
    h('summary', null, `График платежей · ${plural(rows.length, 'платёж', 'платежа', 'платежей')}`),
    h('p', { class: 'hint', style: { 'margin-top': '8px' } }, `Всего к возврату ${rub(total)}. Платежи равными суммами, даты ориентировочные.`),
    h('div', { class: 'scroll-x', style: { 'max-height': '320px', 'overflow-y': 'auto' } }, h('table', { class: 'tbl sched' },
      h('thead', null, h('tr', null, ['№', 'Дата', 'Платёж', 'Основной долг', 'Проценты', 'Остаток'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((x) => h('tr', null,
        h('td', null, x.n), h('td', { style: { 'white-space': 'nowrap' } }, fmt(x.date)), h('td', { class: 'num' }, rub(x.payment)),
        h('td', { class: 'num' }, rub(x.principal)), h('td', { class: 'num' }, rub(x.interest)), h('td', { class: 'num' }, rub(x.balance))))))));
}

// Иконки продуктов из набора Альфа-Банка (icons.js)
const PRODUCT_GLYPH = { working_capital: 'wallet', equipment: 'tools', overdraft: 'arrowsCw' };
export function productIcon(id) {
  return h('span', { class: 'p-ico' }, icon(PRODUCT_GLYPH[id] || 'wallet', 26));
}

// Заливка дорожки ползунка до текущего значения
export function paintRange(el) {
  const min = Number(el.min) || 0, max = Number(el.max) || 100;
  el.style.setProperty('--p', `${((Number(el.value) - min) / (max - min || 1)) * 100}%`);
}

// Крупная иконка итога (успех / внимание / отказ), как на экранах результата
export function resultIcon(kind) {
  return h('div', { class: `result-ico ${kind}` }, icon(kind === 'ok' ? 'check' : kind === 'bad' ? 'cross' : 'exclamation', 32));
}

// На телефоне строки таблицы показываются карточками: каждой ячейке нужна подпись её колонки
export function stackable(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
  for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { td.dataset.label = heads[i] || ''; });
  table.classList.add('stackable');
  return table;
}

// ---------- Денежный календарь: график остатка на счёте ----------
// Серии проверены валидатором палитры (CVD ΔE ≥ 14): синий — без кредита, пурпурный — с кредитом.
// Красный — только статус «разрыв» (зона ниже нуля), для серий не используется.
const SERIES = { base: '#2A77EF', loan: '#B5459B' };
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const monthShort = (ym) => MON[Number(ym.slice(5, 7)) - 1];
export const monthName = (ym) => `${MON_FULL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const compactRub = (n) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1_000_000) return `${s}${String(+(a / 1_000_000).toFixed(1)).replace('.', ',')} млн`;
  if (a >= 1_000) return `${s}${Math.round(a / 1_000)} тыс`;
  return a ? `${s}${a}` : '0';
};
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}
function niceStep(range) {
  const raw = range / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * @param {{history: Array, forecast: Array}} cf  ответ /cashflow или поле cashflow из пересчёта
 * @param {{withLoan?: boolean, height?: number, caption: string}} opts
 */
export function cashChart(cf, { withLoan = false, height = 240, caption }) {
  const points = [...cf.history.map((p) => ({ ...p, actual: true })), ...cf.forecast.map((p) => ({ ...p, actual: false }))];
  const wrap = h('div', { class: 'cash-chart' });
  const tip = h('div', { class: 'cash-tip', hidden: true, role: 'status' });
  const plot = h('div', { class: 'cash-plot', role: 'img', 'aria-label': caption });
  const legend = withLoan ? h('div', { class: 'cash-legend' },
    h('span', null, h('i', { style: { background: SERIES.base } }), 'Без кредита'),
    h('span', null, h('i', { style: { background: SERIES.loan } }), 'С кредитом'),
    h('span', null, h('i', { class: 'dash' }), 'Пунктир — прогноз')) : h('div', { class: 'cash-legend' }, h('span', null, h('i', { class: 'solid' }), 'Факт'), h('span', null, h('i', { class: 'dash' }), 'Прогноз'));

  function draw() {
    const W = Math.max(300, plot.clientWidth || 640), H = height, padL = 56, padR = 12, padT = 12, padB = 26;
    const vals = points.flatMap((p) => [p.balance, withLoan ? p.balanceWithLoan : null]).filter((v) => v != null);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const step = niceStep(hi - lo || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = (i) => padL + (i * (W - padL - padR)) / (points.length - 1);
    const y = (v) => padT + ((hi - v) * (H - padT - padB)) / (hi - lo || 1);
    const g = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    // разрыв: всё ниже нуля — светлая статусная заливка
    if (lo < 0) g.append(svg('rect', { x: padL, y: y(0), width: W - padL - padR, height: y(lo) - y(0), class: 'cash-neg' }));
    for (let v = lo; v <= hi + 1; v += step) {
      g.append(svg('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? 'cash-zero' : 'cash-grid' }));
      g.append(svg('text', { x: padL - 8, y: y(v) + 4, class: 'cash-axis', 'text-anchor': 'end' }, compactRub(v)));
    }
    const todayI = cf.history.length - 1;
    g.append(svg('line', { x1: x(todayI), x2: x(todayI), y1: padT, y2: H - padB, class: 'cash-today' }));
    g.append(svg('text', { x: x(todayI) + 6, y: padT + 10, class: 'cash-axis' }, 'сейчас'));
    points.forEach((p, i) => { if (i % (W < 520 ? 3 : 2) === 0 || i === points.length - 1) g.append(svg('text', { x: x(i), y: H - 8, class: 'cash-axis', 'text-anchor': 'middle' }, monthShort(p.month))); });
    const path = (key, from, to) => points.slice(from, to + 1).map((p, j) => `${j ? 'L' : 'M'}${x(from + j).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    g.append(svg('path', { d: path('balance', 0, todayI), class: 'cash-line', stroke: SERIES.base }));
    g.append(svg('path', { d: path('balance', todayI, points.length - 1), class: 'cash-line dashed', stroke: SERIES.base }));
    if (withLoan) {
      const lp = points.map((p, i) => (i < todayI ? null : `${i === todayI ? 'M' : 'L'}${x(i).toFixed(1)},${y(i === todayI ? p.balance : p.balanceWithLoan).toFixed(1)}`)).filter(Boolean).join('');
      g.append(svg('path', { d: lp, class: 'cash-line dashed', stroke: SERIES.loan }));
    }
    // маркеры разрывов: точка с кольцом цвета фона
    points.forEach((p, i) => {
      const v = withLoan && !p.actual ? p.balanceWithLoan : p.balance;
      if (!p.actual && v < 0) g.append(svg('circle', { cx: x(i), cy: y(v), r: 5, class: 'cash-gap-dot' }));
    });
    // слой наведения: полоса на каждый месяц шире точки
    const cross = svg('line', { y1: padT, y2: H - padB, class: 'cash-cross', visibility: 'hidden' });
    g.append(cross);
    points.forEach((p, i) => {
      const band = (W - padL - padR) / (points.length - 1);
      const r = svg('rect', { x: x(i) - band / 2, y: 0, width: band, height: H, fill: 'transparent', tabindex: 0, 'aria-label': `${monthName(p.month)}: ${compactRub(p.balance)} ₽` });
      const show = () => {
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        clear(tip).append(...[
          h('b', null, `${monthName(p.month)}${p.actual ? '' : ' · прогноз'}`),
          h('div', { class: 'row between' }, h('span', null, withLoan ? 'Без кредита' : 'Остаток'), h('b', { class: p.balance < 0 ? 'neg' : '' }, `${compactRub(p.balance)} ₽`)),
          withLoan && !p.actual ? h('div', { class: 'row between' }, h('span', null, 'С кредитом'), h('b', { class: p.balanceWithLoan < 0 ? 'neg' : '' }, `${compactRub(p.balanceWithLoan)} ₽`)) : null,
          h('div', { class: 'row between muted' }, h('span', null, 'Поступления'), h('span', null, `+${compactRub(p.inflow)}`)),
          h('div', { class: 'row between muted' }, h('span', null, 'Списания'), h('span', null, `−${compactRub(p.outflow)}`)),
          ...(p.events || []).map((e) => h('div', { class: 'small' }, `• ${e.label}: ${compactRub(e.amount)} ₽`))].filter(Boolean));
        tip.hidden = false;
        const left = Math.min(Math.max(x(i) + 12, 0), W - 230);
        tip.style.left = `${x(i) > W - 250 ? x(i) - 232 : left}px`;
      };
      const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
      r.addEventListener('mouseenter', show); r.addEventListener('focus', show);
      r.addEventListener('mouseleave', hide); r.addEventListener('blur', hide);
      g.append(r);
    });
    clear(plot).append(g);
  }

  const table = h('details', { class: 'why cash-table' }, h('summary', null, 'Таблица по месяцам'),
    h('div', { class: 'scroll-x' }, h('table', { class: 'tbl sched' },
      h('thead', null, h('tr', null, ['Месяц', 'Поступления', 'Списания', withLoan ? 'Остаток без кредита' : 'Остаток', withLoan ? 'С кредитом' : null, 'События'].filter(Boolean).map((t) => h('th', null, t)))),
      h('tbody', null, points.map((p) => h('tr', null,
        h('td', null, `${monthName(p.month)}${p.actual ? '' : ' (прогноз)'}`), h('td', { class: 'num' }, rub(p.inflow)), h('td', { class: 'num' }, rub(p.outflow)),
        h('td', { class: 'num' }, rub(p.balance)), withLoan ? h('td', { class: 'num' }, p.actual ? '—' : rub(p.balanceWithLoan)) : null,
        h('td', null, (p.events || []).map((e) => e.label).join(', ') || '—')))))));

  wrap.append(legend, h('div', { class: 'cash-stage' }, plot, tip), table);
  setTimeout(draw, 0);
  const onResize = debounce(() => { if (document.body.contains(wrap)) draw(); else window.removeEventListener('resize', onResize); }, 120);
  window.addEventListener('resize', onResize);
  return wrap;
}

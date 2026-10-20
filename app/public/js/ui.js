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
    h('div', { class: 'scroll-x', style: { 'max-height': '320px', 'overflow-y': 'auto' } }, h('table', { class: 'tbl' },
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

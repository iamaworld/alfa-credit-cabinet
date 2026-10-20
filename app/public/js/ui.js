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
export const pct0 = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
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
      h('span', { class: `arrow ${f.direction === 'up' ? 'up' : f.direction === 'down' ? 'down' : 'flat'}`, 'aria-hidden': 'true' }, f.direction === 'up' ? '↑' : f.direction === 'down' ? '↓' : '•'),
      h('div', null, h('b', null, f.title), f.message ? h('span', null, f.message) : null))));
}

export function skeleton(lines = 3) {
  return h('div', { class: 'stack' }, Array.from({ length: lines }, () => h('div', { class: 'skeleton' })));
}

export const PRODUCT_ICON = { working_capital: 'О', equipment: 'Т', overdraft: 'Р' };
export function newKey() { return crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`; }

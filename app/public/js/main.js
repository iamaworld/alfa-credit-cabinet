import { h, clear, toast, icon } from './ui.js';
import { get, post, setUnauthorizedHandler, ApiError } from './api.js';
import { loginPage } from './pages/login.js';
import { homePage } from './pages/home.js';
import { offerPage } from './pages/offer.js';
import { applicationsPage, applicationPage } from './pages/application.js';
import { analystQueuePage, analystCasePage } from './pages/analyst.js';
import { bellWidget } from './pages/bell.js';
import { session, go } from './nav.js';

const root = document.getElementById('app');
let cleanup = null;


function shell(content, active) {
  const u = session.user;
  const analyst = u.role === 'analyst';
  document.documentElement.dataset.role = u.role;
  const links = analyst ? [['#/analyst', 'Очередь']] : [['#/', 'Главная'], ['#/applications', 'Заявки']];
  return h('div', null,
    h('header', { class: 'top' }, h('div', { class: 'top-in' },
      h('a', { class: 'brand', href: analyst ? '#/analyst' : '#/' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'К'),
        h('span', null, 'Кредитный кабинет', h('small', null, analyst ? 'Кабинет аналитика' : 'Для предпринимателей · прототип'))),
      h('nav', { class: 'nav', 'aria-label': 'Разделы' }, links.map(([href, text]) => h('a', { href, 'aria-current': active === href ? 'page' : null }, text))),
      h('div', { class: 'top-right' },
        analyst ? null : bellWidget(),
        h('div', { class: 'who' }, h('b', null, u.name), h('span', null, analyst ? 'Аналитик' : 'Клиент')),
        h('button', { class: 'btn ghost small logout', onclick: logout, 'aria-label': 'Выйти' }, icon('door', 20), h('span', { class: 'lbl' }, 'Выйти'))))),
    h('main', { class: 'page', id: 'main' }, content),
    // На телефоне верхняя навигация не помещается: дублируем разделы нижней панелью
    links.length > 1 ? h('nav', { class: 'tabbar', 'aria-label': 'Разделы' }, links.map(([href, text]) => h('a', { href, 'aria-current': active === href ? 'page' : null }, icon(href === '#/' ? 'house' : 'document', 22), h('span', null, text)))) : null);
}

async function logout() {
  try { await post('/auth/logout'); } catch { /* уже вышли */ }
  session.user = null;
  go('#/login');
}

const ROUTES = [
  [/^#\/login$/, () => ({ guest: true, run: loginPage })],
  [/^#\/?$/, () => ({ role: 'client', active: '#/', run: homePage })],
  [/^#\/offer\/(\d+)(?:\?(.*))?$/, (m) => ({ role: 'client', active: '#/', run: (el) => offerPage(el, m[1], new URLSearchParams(m[2] || '')) })],
  [/^#\/applications$/, () => ({ role: 'client', active: '#/applications', run: applicationsPage })],
  [/^#\/applications\/(\d+)$/, (m) => ({ role: 'client', active: '#/applications', run: (el) => applicationPage(el, Number(m[1])) })],
  [/^#\/analyst$/, () => ({ role: 'analyst', active: '#/analyst', run: analystQueuePage })],
  [/^#\/analyst\/(\d+)$/, (m) => ({ role: 'analyst', active: '#/analyst', run: (el) => analystCasePage(el, Number(m[1])) })],
];

export async function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const hash = location.hash || '#/';
  if (!session.user) {
    try { session.user = (await get('/auth/me')).user; } catch { /* не вошли */ }
  }
  let match = null;
  for (const [re, make] of ROUTES) { const m = hash.match(re); if (m) { match = make(m); break; } }
  if (!match) return go(session.user ? (session.user.role === 'analyst' ? '#/analyst' : '#/') : '#/login');
  if (match.guest) {
    if (session.user) return go(session.user.role === 'analyst' ? '#/analyst' : '#/');
    document.documentElement.dataset.role = 'client';
    clear(root);
    cleanup = await match.run(root);
    return undefined;
  }
  if (!session.user) return go('#/login');
  if (match.role !== session.user.role) return go(session.user.role === 'analyst' ? '#/analyst' : '#/');
  const slot = h('div', null);
  clear(root).append(shell(slot, match.active));
  document.title = 'Кредитный кабинет предпринимателя';
  try {
    cleanup = await match.run(slot);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return undefined;
    clear(slot).append(h('div', { class: 'card' }, h('h2', null, 'Не получилось загрузить страницу'), h('p', { class: 'muted' }, e.message || 'Попробуйте обновить страницу.'), h('p', null, h('button', { class: 'btn', onclick: () => route() }, 'Повторить'))));
  }
  window.scrollTo(0, 0);
  return undefined;
}

setUnauthorizedHandler(() => { if (!session.user) return; session.user = null; toast('Сессия закончилась. Войдите снова.', true); go('#/login'); });
window.addEventListener('hashchange', route);
route();

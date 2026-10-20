import { h, toast } from '../ui.js';
import { get, post } from '../api.js';
import { session, go } from '../nav.js';

export async function loginPage(root) {
  const demo = await get('/demo/accounts').catch(() => ({ enabled: false, accounts: [] }));
  const login = h('input', { class: 'input', id: 'login', name: 'login', autocomplete: 'username', required: true });
  const pass = h('input', { class: 'input', id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'err', role: 'alert' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Войти');
  async function signIn() {
    err.textContent = '';
    submit.disabled = true;
    try {
      const r = await post('/auth/login', { login: login.value, password: pass.value });
      session.user = r.user;
      go(r.user.role === 'analyst' ? '#/analyst' : '#/');
    } catch (x) { err.textContent = x.message; } finally { submit.disabled = false; }
  }
  const form = h('form', { class: 'card stack', novalidate: true,
    onsubmit: (e) => { e.preventDefault(); signIn(); } },
    h('h2', null, 'Вход в кабинет'),
    h('div', { class: 'field' }, h('label', { for: 'login' }, 'Логин'), login),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Пароль'), pass),
    err, submit);

  const accounts = demo.enabled ? h('div', { class: 'stack' },
    h('div', null, h('h3', null, 'Тестовые аккаунты'), h('p', { class: 'hint' }, `Нажмите на карточку, чтобы сразу войти. Пароль у всех: ${demo.password}. Все данные вымышлены.`)),
    demo.accounts.map((a) => h('button', { class: 'acc', type: 'button', onclick: () => { login.value = a.login; pass.value = demo.password; signIn(); } },
      h('b', null, `${a.scenario} · ${a.company || a.name}`), h('small', null, `Логин ${a.login}. ${a.hint}`)))) : null;

  root.append(h('div', { class: 'login' },
    h('section', { class: 'login-l' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'К'), h('span', null, 'Кредитный кабинет')),
      h('div', { class: 'stack' },
        h('h1', null, 'Кредит для бизнеса: ', h('em', null, 'понятно'), ' до заявки и после неё'),
        h('p', { class: 'muted' }, 'Предодобренный лимит, условия, которые можно менять и сразу видеть почему, и статус заявки без звонков. Учебный прототип: данные синтетические.')),
      h('p', { class: 'hint' }, 'Прототип хакатона. Не является банковским сервисом.')),
    h('section', { class: 'login-r' }, form, accounts)));
  return undefined;
}

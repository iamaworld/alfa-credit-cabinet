import { h, clear, rub, pct1, months, date, age, badge, meter, factorList, skeleton, toast, productIcon, rateRange, icon } from '../ui.js';
import { get, post, products } from '../api.js';
import { session, go } from '../nav.js';

export async function homePage(root) {
  root.append(skeleton(4));
  const { companies } = await get('/companies');
  clear(root);
  if (!companies.length) return connectStep(root);
  const selected = companies.find((c) => c.inn === sessionStorageSafe('inn')) || companies[0];
  await renderCompany(root, selected, companies);
  return undefined;
}

function sessionStorageSafe(k, v) {
  try { if (v !== undefined) sessionStorage.setItem(k, v); return sessionStorage.getItem(k); } catch { return null; }
}

async function connectStep(root) {
  const demo = await get('/demo/accounts').catch(() => ({ accounts: [] }));
  const me = demo.accounts.find((a) => a.login === session.user.login);
  const inn = h('input', { class: 'input', id: 'inn', inputmode: 'numeric', autocomplete: 'off', maxlength: 12, placeholder: '10 цифр для организации, 12 для ИП', value: '' });
  const err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Подключить компанию');
  root.append(h('div', { class: 'split' },
    h('form', { class: 'card stack', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try { const r = await post('/companies', { inn: inn.value.replace(/\s/g, '') }); sessionStorageSafe('inn', r.company.inn); go('#/'); }
        catch (x) { err.textContent = x.message; inn.setAttribute('aria-invalid', 'true'); } finally { btn.disabled = false; }
      } },
      h('h1', null, 'Введите ИНН. Остальное мы подставим'),
      h('p', { class: 'muted' }, 'Название, адрес, вид деятельности и руководителя берём из реестра. Данные для расчёта лимита получаем из подключённых источников.'),
      h('div', { class: 'field' }, h('label', { for: 'inn' }, 'ИНН'), inn, err),
      btn),
    h('aside', { class: 'card stack' },
      h('h3', null, 'Как это работает'),
      h('ul', { class: 'plain' },
        ['Находим компанию в реестре', 'Смотрим кредитную историю и обороты по счёту', 'Показываем лимит, который уже одобрен заранее, и почему он такой'].map((t) => h('li', { class: 'factor' }, h('span', { class: 'arrow up' }, icon('check', 16)), h('div', null, h('span', { style: { color: 'var(--ink)' } }, t))))),
      me?.inn ? h('div', { class: 'banner info' }, h('div', null, h('b', null, 'Для теста: '), `ИНН ${me.inn} (${me.company}).`, ' ', h('button', { class: 'link', type: 'button', onclick: () => { inn.value = me.inn; inn.focus(); } }, 'Подставить'))) : null)));
}

async function renderCompany(root, company, all) {
  const inn = company.inn;
  const [info, offers, feed, apps, prods] = await Promise.all([
    get(`/companies/${inn}`), get(`/companies/${inn}/offers`), get(`/companies/${inn}/feed`), get('/applications'), products(),
  ]);
  const pname = Object.fromEntries(prods.products.map((p) => [p.id, p.name]));
  const avail = offers.offers.filter((o) => o.available);
  const best = avail.slice().sort((a, b) => b.amount - a.amount)[0];
  const myApps = apps.applications.filter((a) => a.inn === inn);

  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'crumbs' }, `ИНН ${company.inn} · ${company.okved?.title || ''}`),
      h('h1', null, company.shortName || company.name)),
    h('div', { class: 'row' },
      all.length > 1 ? h('select', { class: 'input', 'aria-label': 'Компания', onchange: (e) => { sessionStorageSafe('inn', e.target.value); go('#/'); } }, all.map((c) => h('option', { value: c.inn, selected: c.inn === inn }, c.shortName || c.inn))) : null,
      h('span', { class: 'badge' }, `Работает ${age(info.summary.ageMonths)}`),
      company.status !== 'ACTIVE' ? badge('Компания не действует', 'danger') : null));

  const degraded = info.degraded ? h('div', { class: 'banner' }, h('div', null, h('b', null, 'Часть данных из сохранённой копии. '), 'Один из источников сейчас недоступен. Лимит предварительный, решение по заявке подтвердит сотрудник банка.')) : null;

  let hero;
  if (best) {
    hero = h('section', { class: 'card hero promo' },
      h('span', { class: 'eyebrow' }, 'Предодобренное предложение'),
      h('div', { class: 'big-num' }, h('span', { class: 'pre' }, 'до '), h('span', { class: 'nowrap' }, rub(best.amount))),
      h('p', null, `${pname[best.product]} на ${months(best.term)}, платёж около ${rub(best.payment)} в месяц`),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: `#/offer/${inn}?product=${best.product}&amount=${best.amount}&term=${best.term}` }, 'Настроить условия'),
        h('a', { class: 'btn ghost', href: `#/offer/${inn}` }, 'Подобрать под задачу')),
      h('div', { class: 'hero-meta' },
        h('span', { class: 'meta-i' }, icon('calendar', 18), `Действует до ${date(best.expiresAt)}`),
        h('span', { class: 'meta-i' }, icon('lightning', 18), 'Решение онлайн, без визита в банк'),
        h('span', null, 'Условия ориентировочные, итог — после проверки заявки.')));
  } else {
    const inactive = company.status !== 'ACTIVE';
    hero = h('section', { class: 'card hero stack' },
      h('h2', null, inactive ? 'Кредит для этой компании недоступен' : 'Предодобренного лимита пока нет'),
      h('p', { class: 'muted' }, inactive ? 'По данным реестра компания в процессе ликвидации или прекратила деятельность. Банк не выдаёт кредиты таким компаниям, поэтому расчёт условий здесь не поможет.'
        : info.summary.hasCurrentOverdue ? 'Есть текущая просрочка по кредиту: пока она не закрыта, лимит недоступен. После погашения лимит пересчитается автоматически.'
          : 'По имеющимся данным лимит рассчитать не удалось. Можно подобрать условия самостоятельно: банк проверит заявку.'),
      inactive ? h('p', { class: 'hint' }, 'Если статус в реестре изменится, предложения появятся здесь сами.')
        : h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/offer/${inn}` }, 'Рассчитать условия самому')));
  }

  const productCards = company.status !== 'ACTIVE' ? null : h('div', { class: 'grid cols-3' }, offers.offers.map((o) => productCard(o, pname[o.product], inn)));

  const attention = myApps.filter((a) => ['needs_info', 'counter_offer', 'approved', 'signing'].includes(a.status));
  const appStrip = myApps.length ? h('section', { class: 'card stack' },
    h('div', { class: 'row between' }, h('h2', null, 'Ваши заявки'), h('a', { class: 'link', href: '#/applications' }, 'Все заявки')),
    h('div', { class: 'stack' }, myApps.slice(0, 3).map((a) => h('a', { class: 'row between card tight', style: { 'background': 'var(--bg)', 'text-decoration': 'none' }, href: `#/applications/${a.id}` },
      h('div', null, h('b', null, `${a.number} · ${a.productName}`), h('div', { class: 'small muted' }, `${rub(a.amount)}, ${months(a.term)}`)),
      badge(a.statusTitle, a.tone === 'success' ? 'success' : a.tone === 'danger' ? 'danger' : a.tone === 'action' ? 'action' : a.tone === 'progress' ? 'progress' : ''))))) : null;

  const quest = feed.items.find((i) => i.kind === 'quest');
  const rest = feed.items.filter((i) => i.kind !== 'quest');

  const attentionBox = attention.length ? h('div', { class: 'banner info' }, h('div', { style: { display: 'grid', gap: '6px' } }, h('b', null, 'Нужно ваше действие'),
    attention.map((a) => h('a', { class: 'link', href: `#/applications/${a.id}` }, `${a.number}: ${a.statusTitle.toLowerCase()}`)))) : null;

  root.append(...[head, attentionBox, degraded, hero,
    h('div', { class: 'stack' },
      productCards ? h('h2', null, 'Предложения по продуктам') : null,
      productCards,
      appStrip,
      h('div', { class: 'split-even split' },
        quest ? questCard(quest) : null,
        h('section', { class: 'card stack' }, h('h2', null, 'Для вашего бизнеса'), h('p', { class: 'hint' }, 'Подборка зависит от вашей отрасли, региона и данных компании. Содержимое демонстрационное.'),
          rest.map(feedItem))))].filter(Boolean));
}

function productCard(o, name, inn) {
  if (!o.available) {
    return h('article', { class: 'card product off' }, productIcon(o.product), h('h3', null, name), h('p', { class: 'muted' }, 'Предодобренного лимита нет. Посмотрите блок «Готовность к кредиту» ниже или рассчитайте условия сами.'),
      h('a', { class: 'btn line small', href: `#/offer/${inn}?product=${o.product}` }, 'Рассчитать самому'));
  }
  return h('article', { class: 'card product' },
    productIcon(o.product),
    h('h3', null, name),
    h('div', { class: 'amount' }, 'до ', rub(o.amount)),
    h('div', { class: 'small muted' }, `${months(o.term)} · ставка ${rateRange(o.rate)} · платёж ~${rub(o.payment)}`),
    h('a', { class: 'btn small ghost', href: `#/offer/${inn}?product=${o.product}&amount=${o.amount}&term=${o.term}` }, 'Настроить'),
    h('details', { class: 'why' }, h('summary', null, 'Почему такой лимит'),
      h('div', { class: 'stack', style: { 'margin-top': '12px' } },
        factorList(o.why.map((f) => ({ title: f.title, message: f.message, direction: f.direction }))),
        h('p', { class: 'hint' }, o.limitedBy))));
}

function questCard(q) {
  const { done, total } = q.progress;
  return h('section', { class: 'card stack' },
    h('div', { class: 'row between' }, h('h2', null, q.title), h('b', { class: 'num' }, `${done} из ${total}`)),
    meter(done, total, done === total ? 'ok' : 'mid'),
    h('ul', { class: 'plain' }, q.checklist.map((c) => h('li', { class: 'factor' },
      h('span', { class: `arrow ${c.done ? 'up' : 'flat'}` }, icon(c.done ? 'check' : 'minus', 16)),
      h('div', null, h('b', null, c.label), !c.done && c.hint ? h('span', null, c.hint) : null)))));
}

function feedItem(i) {
  return h('article', { class: 'stack feed-item' },
    h('div', { class: 'row' }, h('b', null, i.title), i.kind === 'support' ? badge('Возможно подойдёт', 'blue') : null),
    h('p', { class: 'muted small' }, i.text),
    i.note ? h('p', { class: 'hint' }, i.note) : null,
    i.link ? h('a', { class: 'link', href: i.link }, 'Открыть') : null);
}

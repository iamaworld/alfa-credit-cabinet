import { h, clear, rub, pct1, months, date, age, badge, meter, factorList, skeleton, toast, productIcon, rateRange, icon, cashChart, monthName, compactRub } from '../ui.js';
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
  const [info, offers, feed, apps, prods, cash] = await Promise.all([
    get(`/companies/${inn}`), get(`/companies/${inn}/offers`), get(`/companies/${inn}/feed`), get('/applications'), products(),
    get(`/companies/${inn}/cashflow`).catch(() => ({ available: false })),
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
      h('span', { class: 'eyebrow' }, 'Вам предодобрено'),
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

  root.append(...[head, attentionBox, degraded, company.status === 'ACTIVE' ? cashCard(inn, cash, info.summary.hasCurrentOverdue) : null, company.status === 'ACTIVE' ? assistantCard(inn) : null, hero,
    h('div', { class: 'stack' },
      productCards ? h('h2', null, 'Предложения по продуктам') : null,
      productCards,
      appStrip,
      // Оба блока на всю ширину: рядом они давали пустоту под коротким чек-листом
      quest ? questCard(quest) : null,
      rest.length ? h('section', { class: 'card stack' }, h('h2', null, 'Для вашего бизнеса'), h('p', { class: 'hint' }, 'Подборка зависит от вашей отрасли, региона и данных компании. Содержимое демонстрационное.'),
        h('div', { class: 'feed-grid' }, rest.map(feedItem))) : null)].filter(Boolean));
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
    h('ul', { class: 'plain checklist' }, q.checklist.map((c) => h('li', { class: 'factor' },
      h('span', { class: `arrow ${c.done ? 'up' : 'flat'}` }, icon(c.done ? 'check' : 'minus', 16)),
      h('div', null, h('b', null, c.label), !c.done && c.hint ? h('span', null, c.hint) : null)))));
}

function feedItem(i) {
  const tag = i.kind === 'alert' ? badge('Важно', 'danger') : i.kind === 'event' ? badge('Скоро', 'blue') : i.kind === 'calm' ? badge('Всё спокойно', 'success') : i.kind === 'support' ? badge('Возможно подойдёт', 'blue') : null;
  return h('article', { class: 'stack feed-item' },
    tag ? h('div', null, tag) : null,
    h('b', null, i.title),
    h('p', { class: 'muted small' }, i.text),
    i.note ? h('p', { class: 'hint' }, i.note) : null,
    i.link ? h('a', { class: i.kind === 'alert' ? 'btn small' : 'link', href: i.link }, i.linkText || 'Открыть') : null);
}

// «Опишите задачу своими словами»: локальная модель превращает фразу в цель, сумму и срок,
// а условия считает тот же движок. Если модель недоступна, сервер разбирает текст по правилам.
const EXAMPLES = [
  'Клиенты платят через 60 дней, а зарплату 800 тысяч нужно платить сейчас',
  'Хотим купить второй грузовик к сезону, примерно 4 млн, лет на 5',
  'Перед новым годом закупаем товар, не хватает 1,5 млн, вернём за год',
];
function assistantCard(inn) {
  const text = h('textarea', { class: 'input', id: 'need', rows: 2, maxlength: 600, placeholder: 'Например: клиенты платят через 60 дней, а зарплату нужно платить сейчас' });
  const err = h('p', { class: 'err', role: 'alert' });
  const notTask = h('div', { class: 'banner info', hidden: true, role: 'status' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Подобрать условия');
  const status = h('p', { class: 'hint assistant-status' });
  get('/assistant/status').then((s) => {
    status.textContent = s.ready ? 'Разбирает локальная модель с открытыми весами: текст не уходит за пределы банка.'
      : s.enabled ? 'Модель загружается — пока разберём по ключевым словам.' : 'Разберём по ключевым словам.';
  }).catch(() => {});
  const submit = async (e) => {
    e?.preventDefault();
    err.textContent = ''; notTask.hidden = true;
    if (text.value.trim().length < 5) { err.textContent = 'Опишите задачу хотя бы парой слов.'; text.focus(); return; }
    btn.disabled = true; btn.textContent = 'Разбираем задачу…';
    try {
      const r = await post('/assistant/parse', { text: text.value });
      if (!r.understood) {
        clear(notTask).append(h('div', null, r.message));
        notTask.hidden = false; btn.disabled = false; btn.textContent = 'Подобрать условия'; text.focus();
        return;
      }
      try { sessionStorage.setItem('assistant', JSON.stringify({ text: text.value.trim(), ...r })); } catch { /* не критично */ }
      const q = new URLSearchParams({ product: r.request.product, amount: r.request.amount, term: r.request.term, purpose: r.purpose, from: 'assistant' });
      go(`#/offer/${inn}?${q}`);
    } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Подобрать условия'; }
  };
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); });
  return h('form', { class: 'card stack assistant', onsubmit: submit },
    h('div', null, h('h2', null, 'На что нужны деньги?'), h('p', { class: 'muted' }, 'Опишите задачу своими словами — подберём продукт, сумму и срок. Продукты банка знать не нужно.')),
    h('div', { class: 'assistant-row' }, text, btn), err, notTask,
    h('div', { class: 'chips wrap' }, EXAMPLES.map((x) => h('button', { class: 'chip', type: 'button', onclick: () => { text.value = x; text.focus(); } }, x))),
    status);
}

// Денежный календарь: прогноз остатка на год по выписке; разрывы видны заранее, их можно закрыть в один клик
function cashCard(inn, cf, blocked = false) {
  if (!cf.available) {
    return h('section', { class: 'card stack' }, h('h2', null, 'Денежный календарь'),
      h('p', { class: 'muted' }, cf.reason === 'no_statement'
        ? 'Банк пока не видит ваш расчётный счёт. Когда выписка подключена, здесь появится прогноз денег на год: в какие месяцы может не хватить и чем закрыть разрыв заранее.'
        : 'Истории по счёту пока мало для прогноза: нужно хотя бы два месяца операций.'));
  }
  const gap = cf.gaps[0];
  const s = cf.suggestion;
  return h('section', { class: 'card stack' },
    h('div', { class: 'cash-head' },
      h('div', null, h('h2', null, 'Деньги на счёте: прогноз на год'),
        h('p', { class: 'muted' }, 'По вашей выписке: зарплата, аренда, поставщики, налоги и то, что повторяется каждый год.')),
      gap ? h('span', { class: 'badge danger' }, icon('warn', 16), `Разрыв: ${monthName(gap.month).toLowerCase()}`)
        : h('span', { class: 'badge success' }, icon('check', 16), 'Разрывов не видно')),
    cashChart(cf, { caption: `Прогноз остатка на счёте на 12 месяцев. Минимум ${compactRub(cf.minBalance)} ₽, ${monthName(cf.minMonth).toLowerCase()}.` }),
    s && blocked ? h('div', { class: 'cash-cta' }, h('p', null, h('b', null, s.reason), ' Пока есть просрочка по кредиту, новый кредит недоступен: заложите эти расходы заранее или сдвиньте крупные платежи.'))
    : s ? h('div', { class: 'cash-cta' },
      h('p', null, h('b', null, s.reason), ' Овердрафт закроет разрыв заранее: проценты — только за дни, когда деньги нужны.'),
      h('a', { class: 'btn', href: `#/offer/${inn}?product=${s.product}&amount=${s.amount}&term=${s.term}&purpose=${s.purpose}&from=calendar` }, 'Закрыть разрыв'))
      : h('p', { class: 'hint' }, `Минимальный остаток по прогнозу — ${compactRub(cf.minBalance)} ₽ (${monthName(cf.minMonth).toLowerCase()}). Учебная модель: показывает форму денежного потока, а не точную сумму.`));
}

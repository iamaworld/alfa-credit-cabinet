import { h, clear, rub, pct1, pct0, months, dateTime, date, badge, meter, factorList, debounce, toast, skeleton, newKey } from '../ui.js';
import { get, post, patch, put, products } from '../api.js';
import { go } from '../nav.js';

const TONE = { success: 'success', danger: 'danger', action: 'action', progress: 'progress', neutral: '' };
const PN = {};
const PIPELINE = new Set(['submitted', 'checking', 'enrichment', 'scoring', 'manual_review']);

export async function applicationsPage(root) {
  root.append(skeleton(3));
  const { applications } = await get('/applications');
  clear(root).append(
    h('div', { class: 'page-head' }, h('h1', null, 'Заявки')),
    applications.length ? h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Номер', 'Продукт', 'Сумма', 'Срок', 'Статус', 'Обновлена'].map((t) => h('th', null, t)))),
      h('tbody', null, applications.map((a) => h('tr', { class: 'click', tabindex: 0, onclick: () => go(`#/applications/${a.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`#/applications/${a.id}`); } },
        h('td', null, h('b', null, a.number)), h('td', null, a.productName), h('td', { class: 'num' }, rub(a.amount)), h('td', null, months(a.term)),
        h('td', null, badge(a.statusTitle, TONE[a.tone])), h('td', { class: 'muted small' }, dateTime(a.updatedAt))))))) :
      h('div', { class: 'card stack' }, h('h2', null, 'Заявок пока нет'), h('p', { class: 'muted' }, 'Подберите условия на главной и оформите первую заявку.'), h('a', { class: 'btn', href: '#/' }, 'Перейти на главную')));
  return undefined;
}

export async function applicationPage(root, id) {
  root.append(skeleton(4));
  const cat = await products();
  for (const p of cat.products) PN[p.id] = p.name;
  let app = (await get(`/applications/${id}`)).application;
  let timer = null, disposed = false;
  const stable = h('div', null);
  clear(root).append(stable);

  function stamp(a) { return `${a.status}|${a.version}|${a.timeline.length}|${a.openInfo.length}`; }
  let drawnStamp = null;

  async function poll() {
    if (disposed) return;
    try {
      const fresh = (await get(`/applications/${id}`)).application;
      if (stamp(fresh) !== drawnStamp) { app = fresh; draw(); }
    } catch { /* повторим на следующем тике */ }
  }
  function schedulePolling() {
    clearInterval(timer);
    if (PIPELINE.has(app.status)) timer = setInterval(poll, app.status === 'manual_review' ? 3000 : 1200);
  }

  function setApp(a) { app = a; draw(); }

  function draw() {
    drawnStamp = stamp(app);
    const panels = {
      draft: () => draftPanel(app, setApp),
      needs_info: () => infoPanel(app, setApp),
      counter_offer: () => counterPanel(app, setApp),
      approved: () => approvedPanel(app, setApp),
      signing: () => signingPanel(app, setApp),
      disbursed: () => donePanel(app),
      declined: () => declinedPanel(app),
      expired: () => endedPanel(app),
      cancelled: () => endedPanel(app),
    };
    const main = (panels[app.status] || (() => progressPanel(app)))();
    clear(stable).append(
      h('div', { class: 'crumbs' }, h('a', { href: '#/applications' }, '← Все заявки')),
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, `Заявка ${app.number}`), h('p', { class: 'muted' }, `${app.request.productName}, ${rub(app.request.amount)}, ${months(app.request.term)}`)),
        badge(app.statusTitle, TONE[app.tone])),
      stepper(app),
      h('div', { class: 'split', style: { 'margin-top': '16px' } },
        h('div', { class: 'stack' }, main),
        h('aside', { class: 'stack' }, summaryCard(app), timelineCard(app))));
    schedulePolling();
  }

  draw();
  return () => { disposed = true; clearInterval(timer); };
}

function stepper(app) {
  const stop = ['declined', 'cancelled', 'expired'].includes(app.status);
  return h('div', { class: 'card tight' }, h('div', { class: 'steps', role: 'list', 'aria-label': 'Этапы заявки' }, app.stages.map((s, i) =>
    h('div', { class: `step ${i < app.stage || (app.status === 'disbursed') ? 'done' : i === app.stage ? (stop && app.status !== 'declined' ? 'stop' : 'now') : ''}`, role: 'listitem', 'aria-current': i === app.stage ? 'step' : null }, h('i'), h('span', null, s)))));
}

function summaryCard(app) {
  const t = app.acceptedTerms;
  return h('section', { class: 'card stack' }, h('h3', null, t ? 'Условия договора' : 'Параметры заявки'),
    h('div', { class: 'kv-row' },
      h('div', { class: 'kv' }, h('b', null, rub((t || app.request).amount)), h('span', null, 'сумма')),
      h('div', { class: 'kv' }, h('b', null, months((t || app.request).term)), h('span', null, 'срок')),
      t ? h('div', { class: 'kv' }, h('b', null, pct1(t.rate)), h('span', null, 'ставка')) : null,
      t ? h('div', { class: 'kv' }, h('b', null, rub(t.payment)), h('span', null, 'платёж в месяц')) : null),
    h('p', { class: 'hint' }, `Подана: ${app.submittedAt ? dateTime(app.submittedAt) : 'ещё не отправлена'}`));
}

function timelineCard(app) {
  return h('section', { class: 'card stack' }, h('h3', null, 'Что происходило'),
    h('ol', { class: 'timeline' }, app.timeline.slice().reverse().map((e) => h('li', null, h('time', null, dateTime(e.ts)), e.text))));
}

// ---------- панели ----------
function progressPanel(app) {
  const review = app.status === 'manual_review';
  return h('section', { class: 'card stack' },
    h('h2', null, app.statusTitle), h('p', null, app.statusText),
    h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Идёт проверка' }, h('i', { style: { width: `${Math.min(95, 15 + app.stage * 30 + (review ? 25 : 0))}%` } })),
    h('p', { class: 'muted' }, app.nextStep),
    h('p', { class: 'hint' }, 'Страница обновляется сама. Никаких звонков и писем: ответ придёт сюда и в уведомления.'));
}

function infoPanel(app, setApp) {
  return h('section', { class: 'card stack' }, h('h2', null, 'Банку нужна информация'), h('p', { class: 'muted' }, app.nextStep),
    app.openInfo.map((q) => {
      const input = q.kind === 'revenue'
        ? h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 1, id: `q${q.id}`, placeholder: 'Например, 1 500 000' })
        : h('textarea', { class: 'input', id: `q${q.id}`, maxlength: 2000 });
      const err = h('p', { class: 'err', role: 'alert' });
      const btn = h('button', { class: 'btn', type: 'button' }, 'Отправить ответ');
      btn.addEventListener('click', async () => {
        err.textContent = ''; btn.disabled = true;
        try {
          const body = q.kind === 'revenue' ? { declaredRevenue: Number(input.value) } : { answer: input.value };
          setApp((await post(`/applications/${app.id}/info/${q.id}/answer`, body)).application);
          toast('Ответ отправлен. Продолжаем проверку.');
        } catch (e) { err.textContent = e.message; btn.disabled = false; }
      });
      return h('div', { class: 'card tight stack', style: { background: 'var(--bg)' } },
        h('label', { for: `q${q.id}` }, h('b', null, q.question)), input, err, btn);
    }));
}

function reasonsBlock(title, items, hint) {
  if (!items?.length) return null;
  return h('div', { class: 'stack' }, h('h3', null, title), hint ? h('p', { class: 'hint' }, hint) : null, factorList(items));
}

function twoStepButton(label, confirmLabel, cls, action) {
  let armed = false, t;
  const b = h('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', async () => {
    if (!armed) { armed = true; b.textContent = confirmLabel; t = setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    clearTimeout(t); b.disabled = true;
    try { await action(); } catch (e) { toast(e.message, true); b.disabled = false; armed = false; b.textContent = label; }
  });
  return b;
}

function counterPanel(app, setApp) {
  const d = app.decision;
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', null, 'Есть другое предложение'), h('p', { class: 'muted' }, 'Запрошенные условия не проходят. Вот варианты, которые мы готовы одобрить, они проверены тем же расчётом.'),
      d.expiresAt ? h('p', { class: 'hint' }, `Предложение действует до ${date(d.expiresAt)}`) : null,
      d.alternatives.map((a) => {
        const btn = h('button', { class: 'btn', type: 'button' }, 'Выбрать этот вариант');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try { setApp((await post(`/applications/${app.id}/accept`, { altId: a.id }, { 'Idempotency-Key': `acc-${app.id}-${a.id}` })).application); }
          catch (e) { toast(e.message, true); btn.disabled = false; }
        });
        return h('article', { class: 'card tight stack', style: { background: 'var(--bg)' } },
          h('div', { class: 'row between' }, h('h3', null, PN[a.product] || 'Вариант'), h('b', { class: 'num' }, rub(a.amount))),
          h('ul', { class: 'plain small muted' }, diffs(app.request, a).map((t) => h('li', null, t))),
          h('div', { class: 'kv-row' },
            h('div', { class: 'kv' }, h('b', null, rub(a.payment)), h('span', null, 'платёж в месяц')),
            h('div', { class: 'kv' }, h('b', null, pct1(a.rate)), h('span', null, 'ставка')),
            h('div', { class: 'kv' }, h('b', null, months(a.term)), h('span', null, 'срок')),
            h('div', { class: 'kv' }, h('b', null, pct0(a.load)), h('span', null, 'нагрузка'))),
          btn);
      }),
      twoStepButton('Отказаться от предложения', 'Точно отказаться?', 'btn line', async () => setApp((await post(`/applications/${app.id}/cancel`)).application))),
    h('section', { class: 'card stack' },
      reasonsBlock('Почему не получилось на запрошенных условиях', d.reasons, 'Показываем факторы без внутренних порогов.'),
      reasonsBlock('Что сработало в вашу пользу', d.strengths)));
}

function diffs(req, a) {
  const out = [];
  if (a.product !== req.product) out.push(`Другой продукт вместо «${req.productName}»`);
  if (a.amount < req.amount) out.push(`Сумма ${rub(a.amount)} вместо ${rub(req.amount)}`);
  if (a.term !== req.term) out.push(`Срок ${months(a.term)} вместо ${months(req.term)}`);
  return out.length ? out : ['Те же параметры, другая оценка'];
}

function approvedPanel(app, setApp) {
  const d = app.decision, t = d.terms;
  const btn = h('button', { class: 'btn', type: 'button' }, 'Принять условия');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { setApp((await post(`/applications/${app.id}/accept`, {}, { 'Idempotency-Key': `acc-${app.id}` })).application); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  });
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', null, 'Заявка одобрена'),
      h('div', { class: 'kv-row' },
        h('div', { class: 'kv' }, h('b', null, rub(t.amount)), h('span', null, 'сумма')),
        h('div', { class: 'kv' }, h('b', null, rub(t.payment)), h('span', null, 'платёж в месяц')),
        h('div', { class: 'kv' }, h('b', null, pct1(t.rate)), h('span', null, 'ставка')),
        h('div', { class: 'kv' }, h('b', null, rub(t.overpayment)), h('span', null, 'переплата'))),
      d.expiresAt ? h('p', { class: 'hint' }, `Условия действуют до ${date(d.expiresAt)}`) : null,
      h('div', { class: 'row' }, btn, twoStepButton('Отказаться', 'Точно отказаться?', 'btn line', async () => setApp((await post(`/applications/${app.id}/cancel`)).application)))),
    d.strengths?.length ? h('section', { class: 'card' }, reasonsBlock('Что сработало в вашу пользу', d.strengths)) : null);
}

function signingPanel(app, setApp) {
  const t = app.acceptedTerms;
  const ok = h('input', { type: 'checkbox', id: 'ok' });
  const btn = h('button', { class: 'btn', type: 'button', disabled: true }, 'Подписать договор');
  ok.addEventListener('change', () => { btn.disabled = !ok.checked; });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { setApp((await post(`/applications/${app.id}/sign`, { confirm: true }, { 'Idempotency-Key': `sign-${app.id}` })).application); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  });
  return h('section', { class: 'card stack' }, h('h2', null, 'Подпишите договор'),
    h('p', { class: 'muted' }, 'Договор сформирован по принятым условиям. В прототипе подпись и выдача имитируются.'),
    t ? h('div', { class: 'kv-row' },
      h('div', { class: 'kv' }, h('b', null, rub(t.amount)), h('span', null, 'сумма')), h('div', { class: 'kv' }, h('b', null, months(t.term)), h('span', null, 'срок')),
      h('div', { class: 'kv' }, h('b', null, pct1(t.rate)), h('span', null, 'ставка')), h('div', { class: 'kv' }, h('b', null, rub(t.payment)), h('span', null, 'платёж'))) : null,
    h('label', { class: 'check', for: 'ok' }, ok, h('span', null, 'Я ознакомился с условиями договора и график платежей мне понятен')), btn);
}

function donePanel(app) {
  const t = app.acceptedTerms;
  return h('section', { class: 'card stack' }, h('h2', null, 'Деньги на счёте'),
    h('p', null, `${rub(t.amount)} зачислены на расчётный счёт (имитация). Первый платёж: ${rub(t.payment)}.`),
    h('div', { class: 'kv-row' },
      h('div', { class: 'kv' }, h('b', null, rub(t.payment)), h('span', null, 'платёж в месяц')),
      h('div', { class: 'kv' }, h('b', null, rub(t.payment * t.term)), h('span', null, 'всего к возврату')),
      h('div', { class: 'kv' }, h('b', null, rub(t.overpayment)), h('span', null, 'переплата'))),
    h('a', { class: 'btn ghost', href: '#/' }, 'На главную'));
}

function declinedPanel(app) {
  const d = app.decision;
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' }, h('h2', null, 'Одобрить заявку сейчас не можем'),
      h('p', { class: 'muted' }, 'Ниже причины и шаги, которые могут изменить решение. Мы не раскрываем внутренние пороги, но показываем, на что влияют ваши данные.'),
      reasonsBlock('Что повлияло на решение', d.reasons),
      d.plan?.length ? h('div', { class: 'stack' }, h('h3', null, 'Что можно сделать'), h('ul', { class: 'plain' }, d.plan.map((p) => h('li', { class: 'change' }, p)))) : null,
      h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/offer/${app.inn}` }, 'Рассчитать другие условия'), h('a', { class: 'btn ghost', href: '#/' }, 'На главную'))),
    d.strengths?.length ? h('section', { class: 'card' }, reasonsBlock('Что у вас в порядке', d.strengths)) : null);
}

function endedPanel(app) {
  return h('section', { class: 'card stack' }, h('h2', null, app.statusTitle), h('p', { class: 'muted' }, app.statusText),
    h('a', { class: 'btn', href: `#/offer/${app.inn}` }, 'Подобрать условия заново'));
}

// ---------- черновик ----------
function draftPanel(app, setApp) {
  let version = app.version;
  let docs = app.documents, readiness = app.readiness;
  const state = { employees: app.form.employees ?? '', address: app.form.address ?? '', comment: app.form.comment ?? '', revenue: app.declaredRevenue ?? '', consent: !!app.form.consents?.personalData };
  const saved = h('span', { class: 'hint', 'aria-live': 'polite' }, 'Изменения сохраняются автоматически');
  let saving = Promise.resolve();

  const save = () => {
    saving = saving.then(async () => {
      saved.textContent = 'Сохраняем…';
      try {
        const r = await patch(`/applications/${app.id}`, {
          version, declaredRevenue: state.revenue === '' ? null : Number(state.revenue),
          form: { employees: state.employees === '' ? undefined : Number(state.employees), address: state.address, comment: state.comment, consents: { personalData: state.consent } },
        });
        version = r.application.version; readiness = r.application.readiness;
        saved.textContent = 'Сохранено';
        drawReadiness();
      } catch (e) {
        saved.textContent = e.code === 'version_conflict' ? 'Заявка изменилась в другом окне. Обновите страницу.' : `Не сохранено: ${e.message}`;
      }
    });
  };
  const autosave = debounce(save, 700);

  const field = (label, id, el, hint) => h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('p', { class: 'hint' }, hint) : null);
  const employees = h('input', { class: 'input', id: 'emp', type: 'number', min: 0, value: state.employees, oninput: (e) => { state.employees = e.target.value; autosave(); } });
  const address = h('input', { class: 'input', id: 'addr', value: state.address, maxlength: 300, oninput: (e) => { state.address = e.target.value; autosave(); } });
  const comment = h('textarea', { class: 'input', id: 'cm', maxlength: 1000, oninput: (e) => { state.comment = e.target.value; autosave(); } }, state.comment);
  const revenue = h('input', { class: 'input', id: 'rv', type: 'number', min: 0, value: state.revenue, oninput: (e) => { state.revenue = e.target.value; autosave(); } });
  const consent = h('input', { type: 'checkbox', id: 'cs', checked: state.consent, onchange: (e) => { state.consent = e.target.checked; autosave.cancel(); save(); } });

  const docsBox = h('ul', { class: 'plain' });
  function drawDocs() {
    clear(docsBox).append(...docs.map((d) => {
      const done = d.status === 'provided';
      let control;
      if (done) control = badge(d.fileName, 'success');
      else if (d.kind === 'bki_consent') {
        control = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: async (e) => { if (e.target.checked) await attach(d.kind, 'Электронное согласие'); } }), h('span', null, 'Согласен'));
      } else {
        control = h('label', { class: 'btn line small' }, 'Приложить файл', h('input', { class: 'sr', type: 'file', 'aria-label': `Приложить: ${d.title}`, onchange: async (e) => { const f = e.target.files[0]; if (f) await attach(d.kind, f.name); } }));
      }
      return h('li', { class: 'row between card tight', style: { background: 'var(--bg)' } }, h('div', null, h('b', null, d.title), h('div', { class: 'small muted' }, done ? 'Приложено' : 'Нужно приложить')), control);
    }));
  }
  async function attach(kind, name) {
    try {
      const r = (await put(`/applications/${app.id}/documents/${kind}`, { fileName: name })).application;
      docs = r.documents; readiness = r.readiness; version = r.version; drawDocs(); drawReadiness();
    } catch (e) { toast(e.message, true); }
  }

  const readyBox = h('div', { class: 'stack' });
  const submit = h('button', { class: 'btn', type: 'button' }, 'Отправить заявку');
  function drawReadiness() {
    clear(readyBox);
    if (readiness.length) readyBox.append(h('div', { class: 'banner' }, h('div', null, h('b', null, 'Перед отправкой: '), h('ul', { class: 'plain' }, readiness.map((p) => h('li', null, p.message))))));
    submit.disabled = readiness.length > 0;
  }
  submit.addEventListener('click', async () => {
    autosave.cancel(); submit.disabled = true;
    try {
      await save(); await saving;
      const keyName = `idem-${app.id}`;
      let key; try { key = sessionStorage.getItem(keyName) || newKey(); sessionStorage.setItem(keyName, key); } catch { key = newKey(); }
      const r = await post(`/applications/${app.id}/submit`, {}, { 'Idempotency-Key': key });
      try { sessionStorage.removeItem(keyName); } catch { /* не критично */ }
      toast('Заявка отправлена');
      setApp(r.application);
    } catch (e) {
      toast(e.message, true);
      if (e.details) readiness = e.details;
      drawReadiness();
    }
  });

  drawDocs(); drawReadiness();
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, 'Условия'), h('a', { class: 'btn ghost small', href: `#/offer/${app.inn}?draft=${app.id}` }, 'Изменить условия')),
      h('p', { class: 'muted' }, `${app.request.productName}, ${rub(app.request.amount)} на ${months(app.request.term)}${app.request.collateral ? ', с залогом' : ''}.`)),
    h('section', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, 'Данные компании'), saved),
      h('p', { class: 'hint' }, `Название, ИНН и вид деятельности подставлены из реестра: ${app.form.companyName}, руководитель ${app.form.director}.`),
      field('Адрес', 'addr', address),
      field('Число сотрудников', 'emp', employees),
      field('Среднемесячная выручка, ₽ (необязательно)', 'rv', revenue, 'Нужна, если банк не видит обороты по вашему счёту.'),
      field('Комментарий для банка', 'cm', comment)),
    h('section', { class: 'card stack' }, h('h2', null, 'Документы и согласия'), docsBox,
      h('label', { class: 'check', for: 'cs' }, consent, h('span', null, 'Согласен на обработку персональных данных и проверку компании'))),
    h('section', { class: 'card stack' }, readyBox, submit,
      h('p', { class: 'hint' }, 'Повторное нажатие не создаст вторую заявку.')));
}

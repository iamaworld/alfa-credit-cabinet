import { h, clear, rub, pct1, pct0, months, dateTime, age, badge, meter, skeleton, toast, stackable } from '../ui.js';
import { get, post } from '../api.js';
import { go } from '../nav.js';

const OUTCOME = { approve: ['Одобрить', 'success'], counter_offer: ['Другие условия', 'action'], need_info: ['Запросить данные', 'progress'], decline: ['Отказать', 'danger'], pending: ['Нет данных', ''] };
const outcomeBadge = (o) => { const [t, tone] = OUTCOME[o] || [o, '']; return badge(t, tone); };
const TYPE = { enrichment: 'Получение данных', enrichment_failed: 'Сбой получения данных', check: 'Проверка комплекта', document: 'Документ', info_answered: 'Ответ клиента', scored: 'Оценка', decision: 'Решение', accepted: 'Клиент принял условия', rerun: 'Повторная проверка' };
const waiting = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return mins < 1 ? 'только что' : mins < 60 ? `${mins} мин.` : mins < 1440 ? `${Math.round(mins / 60)} ч.` : `${Math.round(mins / 1440)} дн.`;
};

export async function analystQueuePage(root) {
  let timer;
  const holder = h('div', { class: 'stack' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Очередь на проверку'), h('p', { class: 'muted' }, 'Заявки, где решение подтверждает человек: крупная сумма, пограничная оценка, отказ без стоп-фактора, неполные данные.'))), holder);
  async function load() {
    const d = await get('/analyst/queue');
    clear(holder).append(
      h('section', { class: 'card scroll-x' },
        d.queue.length ? table(d.queue, true) : h('div', { class: 'stack' }, h('h3', null, 'Очередь пуста'), h('p', { class: 'muted' }, 'Новые заявки на ручную проверку появятся здесь. Попробуйте войти как client-a и подать заявку на 5 000 000 ₽.'))),
      h('section', { class: 'card scroll-x stack' }, h('h2', null, 'Последние заявки'), d.recent.length ? table(d.recent, false) : h('p', { class: 'muted' }, 'Заявок пока нет.')));
  }
  function table(rows, inQueue) {
    return stackable(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Заявка', 'Клиент', 'Продукт', 'Рекомендация движка', inQueue ? 'Почему у человека' : 'Статус', inQueue ? 'Ждёт' : 'Обновлена'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', { class: 'click', tabindex: 0, onclick: () => go(`#/analyst/${r.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`#/analyst/${r.id}`); } },
        h('td', { class: 'nowrap' }, h('b', null, r.number), h('div', { class: 'small muted' }, `ИНН ${r.inn}`)),
        h('td', { class: 'nowrap' }, r.client),
        h('td', { class: 'nowrap' }, r.productName, h('div', { class: 'small muted num' }, `${rub(r.amount)}, ${months(r.term)}`)),
        h('td', { style: { 'min-width': '150px' } },
          h('div', { class: 'row', style: { gap: '8px' } }, r.recommendation ? outcomeBadge(r.recommendation) : '—', r.score != null ? h('span', { class: 'small muted num nowrap' }, `${r.score} / ${r.threshold}`) : null),
          r.score != null ? h('div', { style: { 'margin-top': '8px' } }, meter(r.score, 100, r.score >= r.threshold ? 'ok' : 'bad')) : null,
          r.degraded ? h('div', { class: 'small muted' }, 'данные из кэша') : null),
        h('td', { class: 'small', style: { 'min-width': inQueue ? '200px' : '140px' } }, inQueue ? (r.reasons[0] || '—') : r.statusTitle),
        h('td', { class: 'small muted nowrap' }, inQueue ? waiting(r.submittedAt || r.updatedAt) : dateTime(r.updatedAt)))))));
  }
  await load();
  timer = setInterval(() => load().catch(() => {}), 5000);
  return () => clearInterval(timer);
}

export async function analystCasePage(root, id) {
  root.append(skeleton(5));
  let d = await get(`/analyst/applications/${id}`);
  const slot = h('div', null);
  clear(root).append(slot);
  const draw = () => clear(slot).append(caseView(d, async (body) => {
    try { d = await post(`/analyst/applications/${id}/decision`, body); toast('Решение записано в журнал'); draw(); window.scrollTo(0, 0); }
    catch (e) { toast(e.message, true); }
  }));
  draw();
  return undefined;
}

function caseView(d, act) {
  const a = d.application, dec = d.decision, ev = dec?.evaluation, ctx = d.context;
  const head = h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: '#/analyst' }, '← Очередь')),
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, a.number), h('p', { class: 'muted' }, `${a.client} · ИНН ${a.inn}${d.company ? ` · ${d.company.name}` : ''}`)),
      h('div', { class: 'row' }, badge(a.statusTitle, a.tone === 'success' ? 'success' : a.tone === 'danger' ? 'danger' : a.tone === 'action' ? 'action' : 'blue'), dec ? outcomeBadge(dec.outcome) : null)));

  const request = h('section', { class: 'card stack' }, h('h2', null, 'Запрос'),
    h('div', { class: 'kv-row' },
      h('div', { class: 'kv' }, h('b', null, a.request.productName), h('span', null, 'продукт')),
      h('div', { class: 'kv' }, h('b', null, rub(a.request.amount)), h('span', null, 'сумма')),
      h('div', { class: 'kv' }, h('b', null, months(a.request.term)), h('span', null, 'срок')),
      h('div', { class: 'kv' }, h('b', null, a.request.collateral ? 'да' : 'нет'), h('span', null, 'залог'))),
    a.form.comment ? h('p', null, h('b', null, 'Комментарий клиента: '), a.form.comment) : null,
    a.declaredRevenue ? h('p', null, h('b', null, 'Выручка со слов клиента: '), rub(a.declaredRevenue), ' (учитывается с дисконтом)') : null);

  const engine = dec && ev ? h('section', { class: 'card stack' },
    h('div', { class: 'row between' }, h('h2', null, 'Расчёт движка'), h('span', { class: 'hint' }, `Версия движка ${d.decisions.length ? d.decisions[d.decisions.length - 1].engineVersion : ''}`)),
    h('div', { class: 'row' },
      h('div', { class: 'kv' }, h('b', { class: 'num' }, `${ev.score} из 100`), h('span', null, `порог ${ev.threshold}, запас ${ev.margin >= 0 ? '+' : ''}${ev.margin}`)),
      h('div', { style: { flex: '1', 'min-width': '180px' } }, meter(ev.score, 100, ev.margin >= 4 ? 'ok' : ev.margin >= 0 ? 'mid' : 'bad'))),
    dec.manualReasons?.length ? h('div', { class: 'banner info' }, h('div', null, h('b', null, 'Почему заявка у человека: '), dec.manualReasons.join(' '))) : null,
    ev.hardStops?.length ? h('div', { class: 'banner bad' }, h('div', null, h('b', null, 'Жёсткие стоп-факторы: '), ev.hardStops.map((x) => x.message).join(' '))) : null,
    ev.violations?.length ? h('div', { class: 'banner' }, h('div', null, ev.violations.map((v) => h('div', null, v.message)))) : null,
    h('div', { class: 'stack' }, h('h3', null, 'Факторы и баллы'), ev.factors.map(factorRow)),
    h('div', { class: 'kv-row' },
      h('div', { class: 'kv' }, h('b', null, rub(ev.metrics.payment)), h('span', null, 'платёж')),
      h('div', { class: 'kv' }, h('b', null, pct1(ev.rate.value)), h('span', null, `ставка: база ${ev.rate.components.base}, срок +${ev.rate.components.term}, риск ${ev.rate.components.risk >= 0 ? '+' : ''}${ev.rate.components.risk}, залог ${ev.rate.components.collateral}`)),
      h('div', { class: 'kv' }, h('b', null, pct0(ev.metrics.load)), h('span', null, 'нагрузка')),
      h('div', { class: 'kv' }, h('b', null, rub(ev.metrics.freeCashFlow)), h('span', null, 'свободный поток в месяц'))),
    dec.alternatives?.length ? h('div', { class: 'stack' }, h('h3', null, 'Варианты, которые проходят'), dec.alternatives.map((x) => h('div', { class: 'change' }, `${rub(x.amount)} на ${months(x.term)}, ставка ${pct1(x.rate)}, платёж ${rub(x.payment)}, нагрузка ${pct0(x.load)}. ${x.rationale}`))) : null,
    h('p', { class: 'hint' }, 'Скоринг оценивает риск. Решение принимает политика: она учитывает продукт, сумму и стоп-факторы.')) : null;

  const sources = h('section', { class: 'card stack' }, h('h2', null, 'Данные и источники'),
    h('div', { class: 'row' }, Object.values(d.sources).filter(Boolean).map((s) => badge(`${s.title}: ${s.empty ? 'данных нет' : s.degraded ? 'кэш / сбой' : 'получено'}`, s.degraded ? 'action' : s.empty ? '' : 'success'))),
    ctx ? h('div', { class: 'kv-row' },
      h('div', { class: 'kv' }, h('b', null, ctx.turnover ? rub(ctx.turnover) : '—'), h('span', null, `оборот в месяц (${ctx.turnoverSource === 'statement' ? 'выписка' : ctx.turnoverSource === 'declared' ? 'со слов' : 'нет'})`)),
      h('div', { class: 'kv' }, h('b', null, age(ctx.ageMonths)), h('span', null, 'срок работы')),
      h('div', { class: 'kv' }, h('b', null, ctx.bkiRating || '—'), h('span', null, 'рейтинг БКИ')),
      h('div', { class: 'kv' }, h('b', null, rub(ctx.existingMonthly)), h('span', null, 'текущие платежи по кредитам'))) : null,
    d.statement?.months?.length ? h('div', { class: 'stack' }, h('div', { class: 'label' }, 'Поступления на счёт по месяцам'),
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Поступления по месяцам' }, (() => { const max = Math.max(...d.statement.months.map((m) => m.inflow)); return d.statement.months.map((m) => h('div', { class: m.negativeDays > 5 ? 'neg' : '', title: `${m.month}: ${rub(m.inflow)}`, style: { height: `${Math.max(3, (m.inflow / max) * 100)}%` } })); })()),
      h('p', { class: 'hint' }, 'Красные столбцы: больше 5 дней с отрицательным остатком.')) : h('p', { class: 'muted' }, 'Выписки по счёту нет.'),
    d.credit?.obligations?.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Обязательство', 'Платёж', 'Остаток', 'Просрочка'].map((t) => h('th', null, t)))),
      h('tbody', null, d.credit.obligations.map((o) => h('tr', null, h('td', null, o.type), h('td', { class: 'num' }, rub(o.monthlyPayment)), h('td', { class: 'num' }, rub(o.remainingBalance)), h('td', null, o.overdueDays ? badge(`${o.overdueDays} дн.`, 'danger') : 'нет')))))) : null);

  const infos = d.infoRequests?.length ? h('section', { class: 'card stack' }, h('h2', null, 'Вопросы клиенту'),
    d.infoRequests.map((q) => h('div', { class: 'change' }, h('b', null, q.question), h('div', { class: 'small muted' }, q.status === 'answered' ? `Ответ: ${q.answer}` : q.status === 'open' ? 'Ждём ответа' : 'Закрыт')))) : null;

  const audit = h('section', { class: 'card stack' }, h('h3', null, 'Журнал'),
    h('ol', { class: 'timeline audit' }, d.audit.slice().reverse().map((e) => h('li', null,
      h('time', null, dateTime(e.ts), h('span', { class: 'who-tag' }, e.actor)),
      e.publicText || TYPE[e.type] || e.type, e.internalText ? h('div', { class: 'internal' }, e.internalText) : null))));

  // Справа залипает только панель решения; длинный журнал — слева под данными, иначе его низ не прокрутить
  return h('div', null, head,
    h('div', { class: 'app-grid' },
      h('div', { class: 'stack app-main' }, request, engine, sources, infos),
      h('aside', { class: 'app-side' }, h('div', { class: 'sticky' }, d.canAct ? actionPanel(d, act)
        : h('section', { class: 'card stack' }, h('h3', null, 'Решение не требуется'), h('p', { class: 'muted' }, `Статус: ${a.statusTitle.toLowerCase()}. Действия аналитика доступны, когда заявка на ручной проверке.`)))),
      h('div', { class: 'app-timeline' }, audit)));
}

function factorRow(f) {
  const w = Math.min(50, Math.abs(f.points) * 1.6);
  return h('div', { class: 'pts' },
    h('div', null, h('b', null, f.title), h('div', { class: 'small muted' }, f.message)),
    h('div', null, h('b', { class: 'num' }, `${f.points > 0 ? '+' : ''}${f.points}`), h('div', { class: 'bar' }, h('i', { class: f.points >= 0 ? 'pos' : 'neg', style: { width: `${w}%` } }))));
}

function actionPanel(d, act) {
  const dec = d.decision;
  const hardStop = !!dec?.hardStop || dec?.evaluation?.hardStops?.length;
  const noData = !!dec?.noData;
  let action = noData ? 'rerun' : dec?.recommendation === 'counter_offer' ? 'counter_offer' : dec?.recommendation === 'decline' ? 'decline' : 'approve';
  const comment = h('textarea', { class: 'input', id: 'comment', maxlength: 1000, placeholder: 'Обоснование: попадёт в журнал и в карточку заявки' });
  const hint = h('p', { class: 'hint' });
  const altSel = h('select', { class: 'input', 'aria-label': 'Вариант' }, h('option', { value: '' }, 'Все подходящие варианты'), (dec?.alternatives || []).map((x) => h('option', { value: x.id }, `${rub(x.amount)}, ${months(x.term)}`)));
  const altBox = h('div', { class: 'field', hidden: true }, h('label', null, 'Что предложить клиенту'), altSel);
  const submit = h('button', { class: 'btn', type: 'button' }, 'Записать решение');
  const tabs = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Действие' });
  const opts = [['approve', 'Одобрить'], ['counter_offer', 'Другие условия'], ['request_info', 'Запросить данные'], ['decline', 'Отказать'], ['rerun', 'Повторить проверку']];
  const hints = {
    approve: hardStop ? 'Есть жёсткий стоп-фактор: одобрение недоступно.' : (dec?.evaluation?.margin ?? 0) < 0 ? 'Оценка ниже порога: это исключение из политики, оно будет помечено в журнале.' : 'Условия будут рассчитаны движком по запрошенным параметрам.',
    counter_offer: 'Клиент увидит варианты, которые прошли расчёт. Другие значения вводить нельзя.',
    request_info: 'Напишите вопрос клиенту. Он ответит в карточке заявки, проверка продолжится сама.',
    decline: 'Клиент увидит причины и план действий из расчёта. Ваш комментарий останется во внутреннем журнале.',
    rerun: 'Данные запрашиваются заново. Используйте после сбоя источника.',
  };
  function paint() {
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.a === action));
    hint.textContent = hints[action];
    altBox.hidden = action !== 'counter_offer' || !(dec?.alternatives || []).length;
    submit.disabled = (action === 'approve' && hardStop) || (noData && !['rerun', 'decline', 'request_info'].includes(action));
  }
  for (const [a, t] of opts) tabs.append(h('button', { class: 'chip', type: 'button', 'data-a': a, onclick: () => { action = a; paint(); } }, t));
  submit.addEventListener('click', async () => { submit.disabled = true; await act({ action, comment: comment.value, altId: altSel.value || undefined }); paint(); });
  paint();
  return h('section', { class: 'card stack' }, h('h3', null, 'Решение аналитика'),
    dec ? h('p', { class: 'small muted' }, `Рекомендация движка: ${(OUTCOME[dec.recommendation] || [dec.recommendation])[0]}`) : null,
    tabs, hint, altBox, h('div', { class: 'field' }, h('label', { for: 'comment' }, 'Комментарий'), comment), submit);
}

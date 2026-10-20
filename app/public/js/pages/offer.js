import { h, clear, rub, pct1, pct0, months, meter, factorList, debounce, toast, skeleton, moneyInput, paintRange, rateRange } from '../ui.js';
import { get, post, patch, products } from '../api.js';
import { go } from '../nav.js';

const PURPOSE_HINT = { cash_gap: 'Закрыть кассовый разрыв', working: 'Пополнить оборотные средства', equipment: 'Купить оборудование или технику', development: 'Развитие: запуск нового направления' };

export async function offerPage(root, inn, params) {
  root.append(skeleton(4));
  const [cat, company] = await Promise.all([products(), get(`/companies/${inn}`)]);
  const draftId = params.get('draft') ? Number(params.get('draft')) : null;
  const draft = draftId ? (await get(`/applications/${draftId}`)).application : null;
  const byId = Object.fromEntries(cat.products.map((p) => [p.id, p]));
  const start = draft ? draft.request : {
    product: byId[params.get('product')] ? params.get('product') : 'working_capital',
    amount: Number(params.get('amount')) || null, term: Number(params.get('term')) || null, collateral: false,
  };
  const st = {
    product: start.product, collateral: !!start.collateral,
    amount: start.amount || Math.min(byId[start.product].max, Math.max(byId[start.product].min, 1_000_000)),
    term: start.term || byId[start.product].defaultTerm,
    purpose: draft?.purpose || null,
    declaredRevenue: draft?.declaredRevenue || null,
  };
  clamp();
  let seq = 0, shown = null, lastResult = null;

  function clamp() {
    const p = byId[st.product];
    st.amount = Math.min(p.max, Math.max(p.min, Math.round(st.amount / 10000) * 10000));
    st.term = Math.min(p.maxTerm, Math.max(p.minTerm, st.term));
  }

  // ----- управление -----
  const amountOut = h('output', { class: 'big-num', style: { 'font-size': '36px' } });
  const termOut = h('output', { class: 'big-num', style: { 'font-size': '36px' } });
  const amountRange = h('input', { class: 'range', type: 'range', id: 'amount', 'aria-label': 'Сумма', step: 10000 });
  const termRange = h('input', { class: 'range', type: 'range', id: 'term', 'aria-label': 'Срок', step: 1 });
  const amountNum = moneyInput({ id: 'amountNum' });
  const collateral = h('input', { type: 'checkbox', id: 'collateral' });
  const collateralRow = h('label', { class: 'check', for: 'collateral' }, collateral, h('span', null, h('b', null, 'Есть залог'), h('div', { class: 'hint' }, 'С обеспечением ставка ниже, а оценка выше.')));
  const revenue = moneyInput({ id: 'rev', placeholder: 'Например, 1 500 000' }, (v) => { st.declaredRevenue = v; schedule(); });
  const revenueBox = h('div', { class: 'card tight stack', hidden: true },
    h('div', { class: 'field' }, h('label', { for: 'rev' }, 'Среднемесячная выручка за 6 месяцев, ₽'), revenue,
      h('p', { class: 'hint' }, 'Оборотов по счёту банк не видит. Выручка со слов учитывается с дисконтом, пока вы не подключите выписку.')));
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Продукт' });
  const purposeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Цель' });
  const fitNote = h('p', { class: 'hint' });
  const rangeLabels = h('div', { class: 'row between hint' });

  function syncControls() {
    const p = byId[st.product];
    amountRange.min = p.min; amountRange.max = p.max; amountRange.value = st.amount;
    termRange.min = p.minTerm; termRange.max = p.maxTerm; termRange.value = st.term;
    paintRange(amountRange); paintRange(termRange);
    amountNum.setValue(st.amount);
    amountOut.textContent = rub(st.amount);
    termOut.textContent = months(st.term);
    collateral.checked = st.collateral;
    collateralRow.hidden = p.securedByPurchase;
    clear(rangeLabels).append(h('span', null, `${rub(p.min)} – ${rub(p.max)}`), h('span', null, `${months(p.minTerm)} – ${months(p.maxTerm)}`));
    for (const t of tabs.children) t.setAttribute('aria-selected', String(t.dataset.id === st.product));
    for (const c of purposeChips.children) c.setAttribute('aria-pressed', String(c.dataset.id === st.purpose));
  }

  for (const p of cat.products) {
    tabs.append(h('button', { class: 'tab', role: 'tab', 'data-id': p.id, onclick: () => { st.product = p.id; st.term = p.defaultTerm; st.collateral = false; clamp(); syncControls(); schedule(); } }, p.name));
  }
  for (const [id, label] of Object.entries(PURPOSE_HINT)) {
    purposeChips.append(h('button', { class: 'chip', 'data-id': id, 'aria-pressed': 'false', onclick: () => {
      st.purpose = id;
      const prod = cat.purposes[id].product;
      st.product = prod; st.term = byId[prod].defaultTerm; st.collateral = false; clamp(); syncControls(); schedule();
    } }, label));
  }

  for (const r of [amountRange, termRange]) r.addEventListener('input', () => paintRange(r));
  amountRange.addEventListener('input', () => { st.amount = Number(amountRange.value); amountNum.setValue(st.amount); amountOut.textContent = rub(st.amount); schedule(); });
  amountNum.addEventListener('change', () => { st.amount = amountNum.getValue() || st.amount; clamp(); syncControls(); schedule(); });
  amountNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') amountNum.dispatchEvent(new Event('change')); });
  termRange.addEventListener('input', () => { st.term = Number(termRange.value); termOut.textContent = months(st.term); schedule(); });
  collateral.addEventListener('change', () => { st.collateral = collateral.checked; schedule(); });
  if (st.declaredRevenue) revenue.setValue(st.declaredRevenue);

  // ----- результат -----
  const result = h('div', { class: 'stack', 'aria-live': 'polite' });
  // На телефоне итог расчёта уезжает под ползунки: держим платёж на виду отдельной плашкой
  const miniPay = h('b', { class: 'num' });
  const miniChance = h('span', { class: 'small muted' });
  const mini = h('div', { class: 'mini-pay', 'aria-hidden': 'true' },
    h('div', null, h('div', { class: 'small muted' }, 'Платёж в месяц'), miniPay), miniChance);
  const cta = h('button', { class: 'btn', type: 'button' }, draft ? 'Сохранить условия в заявке' : 'Оформить заявку');
  cta.addEventListener('click', async () => {
    cta.disabled = true;
    try {
      const request = { product: st.product, amount: st.amount, term: st.term, collateral: st.collateral };
      if (draft) {
        await patch(`/applications/${draftId}`, { version: draft.version, request, purpose: st.purpose, declaredRevenue: st.declaredRevenue });
        go(`#/applications/${draftId}`);
      } else {
        const r = await post('/applications', { inn, request, purpose: st.purpose });
        if (st.declaredRevenue) await patch(`/applications/${r.application.id}`, { version: r.application.version, declaredRevenue: st.declaredRevenue });
        go(`#/applications/${r.application.id}`);
      }
    } catch (e) { toast(e.message, true); cta.disabled = false; }
  });

  const schedule = debounce(refresh, 180);

  async function refresh() {
    const my = ++seq;
    const request = { product: st.product, amount: st.amount, term: st.term, collateral: st.collateral };
    try {
      const r = await post('/offers/preview', { inn, request, compareTo: shown, declaredRevenue: st.declaredRevenue, purpose: st.purpose });
      if (my !== seq) return;
      shown = request; lastResult = r;
      revenueBox.hidden = !(r.missing?.length || st.declaredRevenue);
      drawResult(r);
    } catch (e) {
      if (my !== seq) return;
      clear(result).append(h('div', { class: 'banner bad' }, h('div', null, e.message)));
    }
  }

  function drawResult(r) {
    const loadTone = r.load == null ? '' : r.load <= 0.35 ? 'ok' : r.load <= 0.5 ? 'mid' : 'bad';
    const fit = r.fit?.find((f) => f.recommended);
    fitNote.textContent = fit && st.purpose ? fit.reason : '';
    miniPay.textContent = rub(r.payment);
    miniChance.textContent = `Шанс: ${r.chanceLabel.toLowerCase()}`;
    clear(result).append(...[
      h('section', { class: 'card stack' },
        h('div', null, h('div', { class: 'label' }, 'Платёж в месяц'), h('div', { class: 'big-num pay' }, rub(r.payment))),
        h('div', { class: 'kv-row' },
          h('div', { class: 'kv' }, h('b', null, rateRange(r.rate)), h('span', null, 'ставка (диапазон до проверки)')),
          h('div', { class: 'kv' }, h('b', null, rub(r.overpayment)), h('span', null, 'переплата за весь срок'))),
        h('div', null,
          h('div', { class: 'row between' }, h('span', { class: 'label' }, 'Нагрузка на денежный поток'), h('b', null, r.load == null ? 'нет данных' : `${pct0(r.load)} · ${r.loadLabel}`)),
          r.load == null ? null : meter(Math.min(r.load, 1), 1, loadTone)),
        h('div', { class: 'row' }, h('span', { class: `chance ${r.chance}` }, `Шанс одобрения: ${r.chanceLabel.toLowerCase()}`)),
        r.blockers.length ? h('div', { class: 'banner bad' }, h('div', null, r.blockers.map((b) => h('div', null, b.message)))) : null,
        r.missing?.length ? h('div', { class: 'banner info' }, h('div', null, r.missing.map((m) => h('div', null, h('b', null, 'Нужны данные: '), m.label, '. ', m.reason)))) : null,
        r.degraded ? h('div', { class: 'banner' }, h('div', null, 'Часть данных из сохранённой копии: источник недоступен.')) : null,
        cat.autoDecisionLimit && st.amount > cat.autoDecisionLimit ? h('div', { class: 'banner info' }, h('div', null, h('b', null, 'Решение примет специалист. '), `Заявки больше ${rub(cat.autoDecisionLimit)} проверяет сотрудник банка, поэтому ответ придёт чуть позже. До ${rub(cat.autoDecisionLimit)} решение автоматическое, за пару минут.`)) : null,
        cta,
        h('p', { class: 'hint' }, r.disclaimer)),
      r.changes?.length ? h('section', { class: 'card stack' }, h('h3', null, 'Что изменилось и почему'),
        h('ul', { class: 'plain' }, r.changes.map((c) => h('li', { class: 'change' }, c.text)))) : null,
      r.improvements?.length ? h('section', { class: 'card stack' }, h('h3', null, 'Что повысит шансы'),
        r.improvements.map((i) => h('div', { class: 'row between' },
          h('div', null, h('b', null, i.label), h('div', { class: 'small muted' }, i.effect)),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { Object.assign(st, i.apply); clamp(); syncControls(); schedule(); } }, 'Применить')))) : null,
      r.factors.length ? h('section', { class: 'card stack' }, h('h3', null, 'Из чего складывается оценка'),
        h('p', { class: 'hint' }, 'Показываем, что помогает и что мешает. Точные пороги банк не раскрывает.'),
        factorList(r.factors)) : null].filter(Boolean));
  }

  clear(root).append(
    h('div', { class: 'crumbs' }, h('a', { href: draft ? `#/applications/${draftId}` : '#/' }, draft ? '← Вернуться к заявке' : '← Главная')),
    h('div', { class: 'page-head' }, h('h1', null, draft ? 'Изменить условия' : 'Подберите условия')),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('section', { class: 'card stack' },
          h('h3', null, 'Для чего нужны деньги'), purposeChips, fitNote,
          h('div', { class: 'label' }, 'Продукт'), tabs),
        h('section', { class: 'card stack' },
          h('div', { class: 'row between' }, h('label', { class: 'label', for: 'amount' }, 'Сумма'), amountOut), amountRange,
          h('div', { class: 'field' }, h('label', { class: 'label', for: 'amountNum' }, 'Точная сумма, ₽'), amountNum),
          h('div', { class: 'row between' }, h('label', { class: 'label', for: 'term' }, 'Срок'), termOut), termRange,
          rangeLabels, collateralRow),
        revenueBox),
      h('div', { class: 'sticky' }, result)),
    mini);
  syncControls();
  await refresh();
  // Плашка не нужна, когда основной блок с платежом уже на экране
  const toggleMini = () => { const r = result.getBoundingClientRect(); mini.hidden = r.top < window.innerHeight - 160 && r.bottom > 0; };
  window.addEventListener('scroll', toggleMini, { passive: true });
  window.addEventListener('resize', toggleMini);
  toggleMini();
  return () => { schedule.cancel(); seq++; window.removeEventListener('scroll', toggleMini); window.removeEventListener('resize', toggleMini); };
}

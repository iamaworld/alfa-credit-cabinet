// Лента для клиента: подсказки, примеры мер поддержки и «готовность к кредиту».
// Содержимое синтетическое. Меры поддержки — гипотеза продукта, а не справочник реальных программ.
import { PRODUCTS } from '../engine/products.js';
import { monthIn, monthUntil } from '../engine/cashflow.js';

const TIPS = {
  trade: { title: 'Торговля: считайте оборот по месяцам', text: 'Сезонные провалы выручки снижают оценку стабильности. Равномерные поступления на счёт повышают шансы.' },
  production: { title: 'Производство: оборудование дешевле в кредит под залог покупки', text: 'Кредит на оборудование стоит дешевле оборотного, потому что покупка становится залогом.' },
  transport: { title: 'Транспорт: топливо и ремонт — типичный кассовый разрыв', text: 'Для коротких разрывов подходит овердрафт: платите проценты только за дни, когда лимит используется.' },
  food_service: { title: 'Общепит: держите остаток на счёте', text: 'Дни с отрицательным остатком снижают оценку дисциплины. Неснижаемый остаток помогает.' },
  services: { title: 'Услуги: подтверждайте выручку выпиской', text: 'Когда обороты видны по счёту, банк учитывает их полностью. Выручка «со слов» учитывается с дисконтом.' },
  other: { title: 'Подключите выписку по счёту', text: 'Обороты по счёту — главный источник для предварительного лимита.' },
};

const PROGRAMS = [
  { id: 'msp-guarantee', title: 'Региональное поручительство для малого бизнеса', text: 'Поручительство региональной гарантийной организации может заменить залог.', when: (c) => ['Москва', 'Республика Татарстан'].includes(c.region) },
  { id: 'equipment-subsidy', title: 'Субсидирование ставки при покупке оборудования', text: 'Для производственных компаний часть процентов может компенсироваться из бюджета.', when: (c) => c.group === 'production' },
  { id: 'young-business', title: 'Поддержка начинающих предпринимателей', text: 'Для бизнеса младше года действуют отдельные программы микрозаймов.', when: (c) => c.ageMonths < 12 },
];

const k = (n) => `${Math.round(Math.abs(n) / 1000).toLocaleString('ru-RU')} тыс. ₽`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// События из денежного календаря: лента у каждого клиента своя, потому что строится из прогноза его денег
function cashflowItems(cf, inn, creditBlocked, ap) {
  if (!cf) return [{ kind: 'tip', id: 'cf-none', title: 'Денежный календарь появится после подключения счёта', text: 'По выписке мы заранее покажем месяцы, когда денег может не хватить, и предложим, чем закрыть разрыв.' }];
  const items = [];
  const on = ap && (ap.settings.reserveShare > 0 || ap.settings.protectionLimit > 0);
  const pct = (x) => `${Math.round(x * 100)} %`;
  if (cf.suggestion && on && !ap.result.gapsLeft.length) {
    // Автопилот включён и закрывает разрыв — говорим, что он сделает, кредит не предлагаем
    const parts = [];
    if (ap.result.reserveTotal) parts.push(`откладывает ${pct(ap.settings.reserveShare)} поступлений ${monthUntil(ap.result.reserveUntil)} — накопится около ${k(ap.result.reserveTotal)}`);
    if (ap.result.protectionMax) parts.push(`защита возьмёт до ${k(ap.result.protectionMax)}, проценты около ${k(ap.result.interest)}`);
    items.push({ kind: 'auto', id: 'cf-auto', title: `Автопилот закроет разрыв ${monthIn(cf.gaps[0].month)}`, text: `${cap(parts.join('; '))}. Делать ничего не нужно.` });
  } else if (cf.suggestion && !creditBlocked && ap?.suggestion?.reserveCloses) {
    // Сначала — способ без кредита
    items.push({ kind: 'alert', id: `cf-gap-${cf.minMonth}`, title: `${cap(monthIn(cf.gaps[0].month))} может не хватить денег`,
      text: `${cf.suggestion.reason} Можно обойтись без кредита: если откладывать ${pct(ap.suggestion.reserveShare)} поступлений в копилку, к этому месяцу деньги будут.`,
      link: '#/autopilot', linkText: 'Включить копилку' });
  } else if (cf.suggestion && creditBlocked) {
    // Кредит сейчас недоступен (стоп-фактор) — предупреждаем о разрыве, но не предлагаем то, что точно откажут
    items.push({ kind: 'alert', id: `cf-gap-${cf.minMonth}`, title: `${cap(monthIn(cf.gaps[0].month))} может не хватить денег`, text: `${cf.suggestion.reason} Пока есть стоп-фактор, кредит недоступен: заложите эти расходы заранее или сдвиньте крупные платежи.` });
  } else if (cf.suggestion) {
    const s = cf.suggestion;
    items.push({ kind: 'alert', id: `cf-gap-${cf.minMonth}`, title: `${cap(monthIn(cf.gaps[0].month))} может не хватить денег`, text: `${s.reason} Овердрафт на ${k(s.amount)} закроет разрыв заранее — проценты только за дни, когда деньги нужны.`,
      link: `#/offer/${inn}?product=${s.product}&amount=${s.amount}&term=${s.term}&purpose=${s.purpose}`, linkText: 'Закрыть разрыв' });
  } else {
    items.push({ kind: 'calm', id: 'cf-calm', title: 'Разрывов в ближайший год не видно', text: `Минимальный остаток по прогнозу — ${k(cf.minBalance)} ${monthIn(cf.minMonth)}. Хороший момент планировать покупку оборудования или запас товара.` });
  }
  // Крупные списания в ближайшие два месяца — чтобы к ним подготовиться
  for (const f of cf.forecast.slice(0, 2)) for (const e of f.events) {
    items.push({ kind: 'event', id: `cf-ev-${f.month}-${e.label}`, title: `${cap(monthIn(f.month))}: ${e.label[0].toLowerCase() + e.label.slice(1)} — около ${k(e.amount)}`, text: 'Видим это списание по прошлому году. Учли его в прогнозе остатка.' });
  }
  return items;
}

export function buildFeed({ ctx, fns, applications, cashflow = null, inn = ctx.inn, autopilot = null }) {
  const items = [];
  const checklist = [
    { id: 'registry', label: 'Компания найдена в реестре', done: ctx.status === 'ACTIVE' },
    { id: 'statement', label: 'Обороты по счёту видны банку', done: ctx.statementMonths >= 3, hint: 'Подключите расчётный счёт или укажите выручку в заявке.' },
    { id: 'bki', label: 'Нет текущих просрочек', done: ctx.bki.currentOverdue.length === 0, hint: 'Погасите просрочку: она блокирует одобрение.' },
    { id: 'age', label: 'Бизнесу больше 6 месяцев', done: ctx.ageMonths >= 6, hint: 'Срок работы — один из ключевых факторов.' },
    { id: 'tax', label: 'Нет налоговой задолженности', done: !ctx.flags.taxDebt, hint: 'Погасите задолженность перед ФНС.' },
    { id: 'address', label: 'Адрес без признаков массовости', done: !ctx.flags.massAddress, hint: 'Подтвердите адрес документами.' },
  ];
  const done = checklist.filter((c) => c.done).length;
  items.push({ kind: 'quest', id: 'readiness', title: 'Готовность к кредиту', progress: { done, total: checklist.length }, checklist });

  items.push(...cashflowItems(cashflow, inn, ctx.status !== 'ACTIVE' || ctx.bki.currentOverdue.length > 0, autopilot));

  const pending = applications.find((a) => ['needs_info', 'counter_offer', 'approved', 'signing'].includes(a.status));
  if (pending) items.push({ kind: 'news', id: `app-${pending.id}`, title: `Заявка ${pending.number}: ${pending.statusTitle}`, text: 'Для этой заявки нужно ваше действие.', link: `#/applications/${pending.id}` });

  const tip = TIPS[ctx.okvedGroup] || TIPS.other;
  items.push({ kind: 'tip', id: `tip-${ctx.okvedGroup}`, title: tip.title, text: tip.text });

  const facts = { region: fns.region, group: ctx.okvedGroup, ageMonths: ctx.ageMonths };
  for (const p of PROGRAMS) if (p.when(facts)) items.push({ kind: 'support', id: p.id, title: p.title, text: p.text, note: 'Пример для демонстрации. Условия реальных программ нужно проверять у организаторов.' });

  items.push({ kind: 'tip', id: 'term-vs-overpay', title: 'Длиннее срок — меньше платёж, но больше переплата', text: 'В редакторе условий видно обе стороны: сдвиньте срок и посмотрите, что изменится.' });
  return { items, products: Object.values(PRODUCTS).length };
}

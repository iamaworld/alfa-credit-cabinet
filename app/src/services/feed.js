// Лента для клиента: подсказки, примеры мер поддержки и «готовность к кредиту».
// Содержимое синтетическое. Меры поддержки — гипотеза продукта, а не справочник реальных программ.
import { PRODUCTS } from '../engine/products.js';

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

export function buildFeed({ ctx, fns, applications }) {
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

  const pending = applications.find((a) => ['needs_info', 'counter_offer', 'approved', 'signing'].includes(a.status));
  if (pending) items.push({ kind: 'news', id: `app-${pending.id}`, title: `Заявка ${pending.number}: ${pending.statusTitle}`, text: 'Для этой заявки нужно ваше действие.', link: `#/applications/${pending.id}` });

  const tip = TIPS[ctx.okvedGroup] || TIPS.other;
  items.push({ kind: 'tip', id: `tip-${ctx.okvedGroup}`, title: tip.title, text: tip.text });

  const facts = { region: fns.region, group: ctx.okvedGroup, ageMonths: ctx.ageMonths };
  for (const p of PROGRAMS) if (p.when(facts)) items.push({ kind: 'support', id: p.id, title: p.title, text: p.text, note: 'Пример для демонстрации. Условия реальных программ нужно проверять у организаторов.' });

  items.push({ kind: 'tip', id: 'term-vs-overpay', title: 'Длиннее срок — меньше платёж, но больше переплата', text: 'В редакторе условий видно обе стороны: сдвиньте срок и посмотрите, что изменится.' });
  return { items, products: Object.values(PRODUCTS).length };
}

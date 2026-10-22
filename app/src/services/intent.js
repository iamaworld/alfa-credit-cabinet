// «Опишите задачу своими словами»: фраза предпринимателя → цель, продукт, сумма, срок.
// Правила надёжно находят в тексте числа и сроки; модель выбирает по смыслу цель и нужную сумму из найденных.
// Сумму и срок от модели принимаем, только если такие числа действительно есть в тексте: модель не может «придумать» кредит.
import { PRODUCTS, PURPOSES } from '../engine/products.js';
import { badRequest } from '../util/errors.js';

const WORD_NUM = { один: 1, одна: 1, одного: 1, два: 2, две: 2, двух: 2, три: 3, трёх: 3, трех: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, полтора: 1.5, полторы: 1.5 };
const UNIT = [
  [/^(млн|миллион|лям)/, 1_000_000],
  [/^(тыс|т\.?р\.?$|к$)/, 1_000],
];

/** Все суммы в рублях, упомянутые в тексте, в порядке появления. */
export function findAmounts(text) {
  const t = text.toLowerCase().replace(/ | /g, ' ');
  const out = [];
  const re = /(\d[\d\s]*(?:[.,]\d+)?|полмиллиона|пол\s?миллиона|полтора|полторы|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|миллион)\s*([а-яё.]+)?/g;
  for (const m of t.matchAll(re)) {
    let [, raw, unitWord = ''] = m;
    if (/^пол\s?миллиона$|^полмиллиона$/.test(raw)) { out.push({ value: 500_000, at: m.index }); continue; }
    if (raw === 'миллион') { if (!/^миллион[а-яё]*\s+(два|две|три|четыре|пять|полтора)/.test(t.slice(m.index))) out.push({ value: 1_000_000, at: m.index }); continue; }
    let n = WORD_NUM[raw] ?? Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    const unit = UNIT.find(([u]) => u.test(unitWord));
    if (unit) n *= unit[1];
    else if (/^(руб|р\.?$)/.test(unitWord) || n >= 10_000) { /* уже в рублях */ } else continue; // «60 дней», «2 года» — не суммы
    if (/^(дн|дня|дней|мес|год|лет|сотрудн|человек|%|процент)/.test(unitWord)) continue;
    out.push({ value: Math.round(n), at: m.index });
  }
  // «миллиона два», «миллиона полтора» — разговорный обратный порядок
  for (const m of t.matchAll(/миллион[а-яё]*\s+(два|две|три|четыре|пять|полтора)/g)) out.push({ value: WORD_NUM[m[1]] * 1_000_000, at: m.index });
  return out.sort((a, b) => a.at - b.at);
}

/** Все сроки в месяцах, упомянутые в тексте. */
export function findTerms(text) {
  const t = text.toLowerCase();
  const out = [];
  if (/полгода|пол года/.test(t)) out.push(6);
  if (/полтора год/.test(t)) out.push(18);
  for (const m of t.matchAll(/(\d+|один|два|две|три|четыре|пять)\s*(мес|год|лет)/g)) {
    const n = WORD_NUM[m[1]] ?? Number(m[1]);
    out.push(/^мес/.test(m[2]) ? n : n * 12);
  }
  // «лет на 5», «года за четыре», «года три», «месяцев на 18»
  for (const m of t.matchAll(/(мес|год|лет)[а-яё]*\s+(?:(?:на|за)\s+)?(\d+|два|три|четыре|пять)(?![\d\s]*(?:млн|миллион|тыс|руб|₽|%))/g)) {
    const n = WORD_NUM[m[2]] ?? Number(m[2]);
    out.push(m[1] === 'мес' ? n : n * 12);
  }
  if (!out.length && /(^|[^а-яё])год([^а-яё]|$)/.test(t)) out.push(12);
  return out;
}

const PURPOSE_RULES = [
  ['equipment', /оборудован|станок|станк|техник|грузовик|фур[уыа]|тягач|газел|прицеп|автобус|экскаватор|погрузчик|машин[ау]|автомобил|трактор|фургон|печь|холодильн|линию/],
  ['cash_gap', /разрыв|зарплат|налог|аренд|платят через|отсрочк|до поступлени|пока клиенты|дебиторк|задерж/],
  ['development', /открыть|открываем|откроем|новое направлени|филиал|точку|магазин|кафе|кофейн|салон|расшир|запуск/],
  ['working', /закуп|товар|сырь|материал|оборот|поставщик|сезон/],
];
const TOPIC = /деньг|денег|кредит|финансир|займ|заём|заем|овердрафт|лимит|ссуд|рассрочк|предоплат|оплат|платеж|платёж|платит|выручк|оборот|налог|зарплат|закуп|купить|покупк|бизнес/;
const PRODUCT_WORDS = [['overdraft', /овердрафт/], ['equipment', /на оборудование|лизинг/], ['working_capital', /оборотн/]];

/** Разбор только по правилам: работает всегда, без модели. */
export function parseByRules(text) {
  const t = text.toLowerCase();
  const matchedPurpose = PURPOSE_RULES.find(([, re]) => re.test(t));
  const purpose = (matchedPurpose || ['working'])[0];
  const amounts = findAmounts(text);
  // Сумма после слов «нужно», «взять», «кредит» важнее остальных чисел (обороты, выручка)
  const cue = /(нужн|надо|взять|кредит|займ|сумм|не хватает|нечем|на старт)/g;
  let amount = null, amountCued = false;
  for (const c of t.matchAll(cue)) { const after = amounts.find((a) => a.at > c.index); if (after) { amount = after.value; amountCued = true; break; } }
  if (amount == null && amounts.length) { amount = amounts[0].value; amountCued = amounts.length === 1 && t.search(cue) >= 0; } // «аренду 350 тыс. платить нечем»
  const terms = findTerms(text);
  const explicitProduct = (PRODUCT_WORDS.find(([, re]) => re.test(t)) || [null])[0];
  // Есть ли в тексте хоть какой-то признак задачи на финансирование: цель, продукт, сумма или денежные слова
  const strong = !!matchedPurpose || !!explicitProduct || amounts.length > 0;
  return { purpose, amount, amountCued, term: terms[0] ?? null, collateral: /залог/.test(t) && !/без залог/.test(t), explicitProduct, signal: strong ? 'strong' : TOPIC.test(t) ? 'weak' : 'none' };
}

const SCHEMA = {
  type: 'object',
  properties: {
    purpose: { type: 'string', enum: Object.keys(PURPOSES) },
    amount_rub: { type: 'integer', description: 'Сумма кредита, которую просит клиент; 0 — если не назвал' },
    term_months: { type: 'integer', description: 'Срок кредита в месяцах; 0 — если не назвал' },
    collateral: { type: 'boolean' },
  },
  required: ['purpose', 'amount_rub', 'term_months', 'collateral'],
};
const SYSTEM = `Ты помогаешь предпринимателю оформить кредит. Из его сообщения извлеки:
purpose — цель: cash_gap (кассовый разрыв: зарплата, налоги, ждём оплату от клиентов), working (закупка товара, сырья, сезон), equipment (покупка оборудования, техники, транспорта), development (новое направление, точка, расширение);
amount_rub — сумму кредита в рублях, которую клиент хочет получить (не выручку и не оборот); 0, если не назвал;
term_months — срок кредита в месяцах; 0, если не назвал; отсрочку оплаты клиентов срок кредита не считать;
collateral — true, только если клиент сам предлагает залог.
Ничего не придумывай.`;
const EXAMPLES = [
  { user: 'Оборот около 3 млн в месяц, нужно 1,5 млн на закупку товара к новому году, отдадим за год', answer: { purpose: 'working', amount_rub: 1500000, term_months: 12, collateral: false } },
  { user: 'клиенты платят через 60 дней, а зарплату платить сейчас', answer: { purpose: 'cash_gap', amount_rub: 0, term_months: 0, collateral: false } },
  { user: 'нужно 400 тысяч на пару месяцев, пока покупатель не оплатит поставку', answer: { purpose: 'cash_gap', amount_rub: 400000, term_months: 0, collateral: false } },
];

// Пограничный случай («как оплатить парковку у офиса»): есть только общее денежное слово — спрашиваем модель отдельно
const RELEVANCE_SCHEMA = { type: 'object', properties: { about_financing: { type: 'boolean' } }, required: ['about_financing'] };
const RELEVANCE_SYSTEM = 'Определи, описывает ли сообщение, на что бизнесу нужны деньги (кредит, кассовый разрыв, покупка, закупка, расширение). Приветствие, бытовой вопрос, вопрос не по теме — false.';
const RELEVANCE_EXAMPLES = [
  { user: 'поставщик требует оплату вперёд, а денег на счёте мало', answer: { about_financing: true } },
  { user: 'как оплатить штраф за парковку', answer: { about_financing: false } },
];
// Цели, которые банк не финансирует, и личные расходы — проверяются правилами до модели:
// маленькой модели в таких вопросах доверять нельзя
const PROHIBITED = /шлюх|проститу|интим|эскорт|бордел|наркот|закладк|оружи|взятк|обнал|отмыв|казино|букмекер|ставк[иау] на спорт|игровые автомат/;
const PERSONAL = /на еду|поесть|продукты домой|на продукты себе|в отпуск|на отпуск|на свадьб|на ремонт квартир|ремонт в квартир|на шопинг|на айфон|на телефон себе|на лечение|на учёбу|на учебу|погасить ипотек|на кредитку|долг другу/;
const MIN_AMOUNT = 10_000;
const REFUSE = {
  prohibited: 'Такие цели банк не финансирует. Опишите задачу бизнеса: закупку, оборудование, кассовый разрыв или развитие.',
  personal: 'Похоже, деньги нужны на личные расходы. Здесь — кредиты для бизнеса; на личные цели подойдёт потребительский кредит.',
  tiny: 'Сумма слишком мала для кредита бизнесу: продукты начинаются от 100 000 ₽.',
};
const NOT_TASK = 'Не похоже на задачу для кредита. Напишите, на что бизнесу нужны деньги: например, «клиенты платят через 60 дней, а зарплату нужно платить сейчас».';

const near = (a, b) => Math.abs(a - b) <= Math.max(1000, b * 0.01);

export function createIntentService({ llm }) {
  /**
   * @returns {{ purpose, request: {product, amount, term, collateral}, summary, source: 'llm'|'rules', notes: string[], llm: {used, ms, error?} }}
   */
  async function parse(text) {
    const clean = String(text || '').trim().slice(0, 600);
    if (clean.length < 5) throw badRequest('Опишите задачу хотя бы парой слов', { field: 'text' });
    const rules = parseByRules(clean);
    const notes = [];
    let purpose = rules.purpose, amount = rules.amount, term = rules.term, collateral = rules.collateral, source = 'rules';

    // Запрещённые цели, личные расходы и копеечные суммы — не заявка; объясняем почему
    const low = clean.toLowerCase();
    const mentioned0 = findAmounts(clean).map((a) => a.value);
    const refuse = PROHIBITED.test(low) ? 'prohibited' : PERSONAL.test(low) ? 'personal' : mentioned0.length && Math.max(...mentioned0) < MIN_AMOUNT ? 'tiny' : null;
    if (refuse) return { understood: false, reason: refuse, message: REFUSE[refuse], source: 'rules', llm: { used: false, ms: 0 } };
    // Не про финансирование («как дела», «привет») — никуда не ведём, а просим описать задачу.
    // Нет ни цели, ни суммы, ни денежных слов — отвечаем сразу, без модели.
    if (rules.signal === 'none') return { understood: false, reason: 'not_task', message: NOT_TASK, source: 'rules', llm: { used: false, ms: 0 } };
    if (rules.signal === 'weak') {
      const rel = await llm.chatJson({ system: RELEVANCE_SYSTEM, user: clean, schema: RELEVANCE_SCHEMA, examples: RELEVANCE_EXAMPLES, maxTokens: 20 });
      if (rel.ok && rel.data.about_financing === false) return { understood: false, reason: 'not_task', message: NOT_TASK, source: 'llm', llm: { used: true, ms: rel.ms } };
    }
    const r = await llm.chatJson({ system: SYSTEM, user: clean, schema: SCHEMA, examples: EXAMPLES });
    if (r.ok && PURPOSES[r.data.purpose]) {
      source = 'llm';
      purpose = r.data.purpose;
      collateral = !!r.data.collateral && /залог/i.test(clean);
      const mentioned = findAmounts(clean).map((a) => a.value);
      // Маленькие модели иногда пишут сумму в тысячах или миллионах: сверяем и такие масштабы
      const said = r.data.amount_rub > 0 ? [1, 1_000, 1_000_000].map((k) => r.data.amount_rub * k).find((v) => mentioned.some((m) => near(v, m))) : undefined;
      if (said) amount = mentioned.find((m) => near(said, m));
      else if (r.data.amount_rub > 0 && !rules.amountCued) { notes.push('Модель назвала сумму, которой нет в тексте, — её не используем.'); amount = null; }
      else if (!rules.amountCued) amount = null; // модель считает, что суммы нет; правила без «нужно» тоже не уверены
      const terms = findTerms(clean);
      if (r.data.term_months > 0 && terms.includes(r.data.term_months)) term = r.data.term_months; // иначе — срок, найденный правилами
    }

    const product = PRODUCTS[rules.explicitProduct] ? rules.explicitProduct : PURPOSES[purpose].product;
    const p = PRODUCTS[product];
    if (amount != null && (amount < p.min || amount > p.max)) {
      notes.push(`Сумма для продукта «${p.name}» — от ${p.min.toLocaleString('ru-RU')} до ${p.max.toLocaleString('ru-RU')} ₽, поставили ближайшую.`);
      amount = Math.min(p.max, Math.max(p.min, amount));
    }
    if (term != null && (term < p.minTerm || term > p.maxTerm)) {
      notes.push(`Срок для продукта «${p.name}» — от ${p.minTerm} до ${p.maxTerm} мес., поставили ближайший.`);
      term = Math.min(p.maxTerm, Math.max(p.minTerm, term));
    }
    if (amount == null) notes.push('Сумму вы не назвали — подставили ориентир, его можно поменять.');
    if (term == null) notes.push('Срок не назван — поставили обычный для этого продукта.');

    // Пересказ собираем из разобранных полей: так он всегда грамотный и не расходится с параметрами
    const fmtAmount = (v) => (v >= 1_000_000 ? `${String(+(v / 1_000_000).toFixed(2)).replace('.', ',')} млн ₽` : `${Math.round(v / 1000)} тыс. ₽`);
    const summary = [PURPOSES[purpose].label, amount != null ? fmtAmount(amount) : null, term != null ? `на ${term} мес.` : null].filter(Boolean).join(' · ');
    return {
      understood: true, purpose, summary,
      request: { product, amount: amount ?? Math.min(p.max, Math.max(p.min, 1_000_000)), term: term ?? p.defaultTerm, collateral: collateral && !p.securedByPurchase },
      source, notes,
      llm: { used: source === 'llm', ms: r.ms, error: r.ok ? undefined : r.error },
    };
  }
  // Прогрев: тот же промпт с примерами — сервер кэширует его, а веса модели оказываются в памяти.
  // Без прогрева первый запрос после простоя может не уложиться в таймаут.
  let warmAt = 0, warming = null;
  function warmup({ force = false } = {}) {
    if (!llm.enabled || warming || (!force && Date.now() - warmAt < 5 * 60_000)) return warming;
    warming = llm.chatJson({ system: SYSTEM, user: 'нужно 500 тысяч на закупку на год', schema: SCHEMA, examples: EXAMPLES })
      .then((r) => { if (r.ok) warmAt = Date.now(); return r; })
      .finally(() => { warming = null; });
    return warming;
  }
  return { parse, warmup };
}

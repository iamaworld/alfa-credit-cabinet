// Синтетические данные для моков внешних источников.
// Все названия, ИНН и ФИО вымышлены. Совпадения случайны.
// Даты регистрации заданы «сколько месяцев назад», чтобы сценарии не «старели» со временем.

export function monthsAgo(n, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 12));
  return d.toISOString().slice(0, 10);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Профили компаний (имитация ЕГРЮЛ/ЕГРИП + «Прозрачный бизнес»)
export const COMPANIES = {
  '7701234567': {
    name: 'ООО «Ромашка Логистика»', shortName: 'Ромашка Логистика', legalForm: 'ООО',
    regMonthsAgo: 103, status: 'ACTIVE',
    okved: { code: '49.41', title: 'Деятельность автомобильного грузового транспорта' },
    region: 'Москва', address: 'г. Москва, ул. Вымышленная, д. 12',
    director: { fio: 'Миронов Андрей Павлович', sinceMonthsAgo: 60 }, employees: 24, taxRegime: 'УСН 15%', size: 'small',
    flags: { massAddress: false, disqualifiedPerson: false, taxDebt: false, unreliableData: false },
  },
  '500100732259': {
    name: 'ИП Соколов Дмитрий Игоревич', shortName: 'ИП Соколов Д. И.', legalForm: 'ИП',
    regMonthsAgo: 49, status: 'ACTIVE',
    okved: { code: '47.91', title: 'Торговля розничная по почте или через интернет' },
    region: 'Московская область', address: 'Московская обл., г. Вымышленск, ул. Тестовая, д. 5',
    director: { fio: 'Соколов Дмитрий Игоревич', sinceMonthsAgo: 49 }, employees: 6, taxRegime: 'УСН 6%', size: 'micro',
    flags: { massAddress: false, disqualifiedPerson: false, taxDebt: false, unreliableData: false },
  },
  '1650654321': {
    name: 'ООО «Северный Хлеб»', shortName: 'Северный Хлеб', legalForm: 'ООО',
    regMonthsAgo: 77, status: 'ACTIVE',
    okved: { code: '10.71', title: 'Производство хлеба и мучных кондитерских изделий' },
    region: 'Республика Татарстан', address: 'Республика Татарстан, г. Условный, ул. Хлебная, д. 3',
    director: { fio: 'Гарипова Лилия Рафаэлевна', sinceMonthsAgo: 77 }, employees: 18, taxRegime: 'УСН 6%', size: 'small',
    flags: { massAddress: false, disqualifiedPerson: false, taxDebt: false, unreliableData: false },
  },
  '7743987654': {
    name: 'ООО «Новый Старт»', shortName: 'Новый Старт', legalForm: 'ООО',
    regMonthsAgo: 3, status: 'ACTIVE',
    okved: { code: '56.10', title: 'Деятельность ресторанов и услуги по доставке продуктов питания' },
    region: 'Санкт-Петербург', address: 'г. Санкт-Петербург, пр-т Придуманный, д. 7',
    director: { fio: 'Лебедев Игорь Сергеевич', sinceMonthsAgo: 3 }, employees: 4, taxRegime: 'УСН 6%', size: 'micro',
    flags: { massAddress: true, disqualifiedPerson: false, taxDebt: false, unreliableData: false },
  },
  '7700000001': {
    name: 'ООО «Тихая Гавань»', shortName: 'Тихая Гавань', legalForm: 'ООО',
    regMonthsAgo: 140, status: 'LIQUIDATING',
    okved: { code: '68.20', title: 'Аренда и управление собственным или арендованным недвижимым имуществом' },
    region: 'Москва', address: 'г. Москва, ул. Несуществующая, д. 1',
    director: { fio: 'Орлов Пётр Викторович', sinceMonthsAgo: 90 }, employees: 2, taxRegime: 'ОСНО', size: 'micro',
    flags: { massAddress: false, disqualifiedPerson: false, taxDebt: true, unreliableData: false },
  },
};

// Кредитные истории (имитация бюро кредитных историй)
export const CREDIT_HISTORY = {
  '7701234567': {
    rating: 'A', noHistory: false, closedWithDelays: 0, inquiries90d: 1,
    obligations: [{ type: 'Кредит на оборудование', lender: 'Банк-партнёр (мок)', monthlyPayment: 90000, remainingBalance: 1900000, openMonthsAgo: 14, overdueDays: 0 }],
  },
  '500100732259': {
    rating: 'C', noHistory: false, closedWithDelays: 1, inquiries90d: 3,
    obligations: [{ type: 'Оборотный кредит', lender: 'Банк-партнёр (мок)', monthlyPayment: 45000, remainingBalance: 520000, openMonthsAgo: 8, overdueDays: 0 }],
  },
  '1650654321': {
    rating: 'B', noHistory: false, closedWithDelays: 0, inquiries90d: 0, obligations: [],
  },
  '7743987654': {
    rating: 'E', noHistory: false, closedWithDelays: 0, inquiries90d: 5,
    obligations: [{ type: 'Кредитная карта', lender: 'Банк-партнёр (мок)', monthlyPayment: 12000, remainingBalance: 150000, openMonthsAgo: 2, overdueDays: 34 }],
  },
  '7700000001': {
    rating: 'D', noHistory: false, closedWithDelays: 2, inquiries90d: 0, obligations: [],
  },
};

// Параметры генерации выписок. Нет записи: у клиента нет счетов в подключённых банках (ответ 404).
// Списания структурные — зарплата, аренда, поставщики, налоги, разовые и ежегодные события, —
// чтобы по выписке можно было построить денежный календарь. Доли — от базового месячного оборота.
//   events: m — месяц года (1–12), share — доля оборота, recurring — повторяется ли каждый год
//   owner — часть поступлений, которую собственник выводит из бизнеса (входит в долю suppliers, а не сверх неё)
export const STATEMENTS = {
  '7701234567': {
    base: 4800000, cv: 0.07, negativeDays: 0, minBalanceShare: 0.25,
    opening: 0.8, payroll: 0.4, rent: 0.06, suppliers: 0.46, owner: 0.04, other: 0, taxQuarter: 0.035,
    events: [
      { m: 3, label: 'Страховка и техосмотр парка', share: 0.5, recurring: true },
      { m: 4, label: 'Налог УСН за год', share: 0.12, recurring: true },
      { m: 7, label: 'Покупка подержанного тягача', share: 0.6, recurring: false },
      { m: 12, label: 'Годовые премии водителям', share: 0.18, recurring: true },
    ],
  },
  '500100732259': {
    base: 1650000, cv: 0.2, negativeDays: 2, minBalanceShare: 0.08,
    opening: -0.04, payroll: 0.22, rent: 0.09, suppliers: 0.575, owner: 0.03, other: 0.02, taxQuarter: 0.025,
    events: [
      { m: 2, label: 'Закупка товара к весеннему сезону', share: 0.3, recurring: true },
      { m: 8, label: 'Закупка к школьному сезону', share: 0.28, recurring: true },
      { m: 11, label: 'Закупка к новогоднему сезону', share: 0.35, recurring: true },
    ],
  },
  '7743987654': {
    base: 160000, cv: 0.45, negativeDays: 12, minBalanceShare: 0.0,
    opening: 0.3, payroll: 0.45, rent: 0.25, suppliers: 0.38, other: 0.0, taxQuarter: 0.0, events: [],
  },
  '7700000001': {
    base: 90000, cv: 0.3, negativeDays: 6, minBalanceShare: 0.02,
    opening: 0.2, payroll: 0.5, rent: 0.2, suppliers: 0.35, other: 0.0, taxQuarter: 0.0, events: [],
  },
};

const r1000 = (n) => Math.round(n / 1000) * 1000;

export function buildStatement(inn, monthsCount = 12, now = new Date()) {
  const p = STATEMENTS[inn];
  if (!p) return null;
  const rnd = mulberry32(Number(String(inn).slice(-7)) || 1);
  const months = [];
  const company = COMPANIES[inn];
  const available = Math.min(monthsCount, Math.max(1, (company?.regMonthsAgo ?? 12)));
  let balance = r1000(p.base * p.opening);
  for (let i = available; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const m = d.getUTCMonth() + 1;
    // Порядок вызовов rnd() как в первой версии генератора: поступления и скоринг не меняются
    const swing = (rnd() * 2 - 1) * p.cv;
    const inflow = r1000(p.base * (1 + swing));
    const supplierJitter = 0.97 + rnd() * 0.06;
    const negativeDays = Math.max(0, Math.round(p.negativeDays + (rnd() * 2 - 1) * (p.negativeDays > 0 ? 1.5 : 0)));
    const minBalance = r1000(inflow * p.minBalanceShare * (0.8 + rnd() * 0.4));
    const breakdown = {
      payroll: r1000(p.base * p.payroll),
      rent: r1000(p.base * p.rent),
      suppliers: r1000(inflow * (p.suppliers - (p.owner || 0)) * supplierJitter),
      owner: r1000(inflow * (p.owner || 0)),
      taxes: [1, 4, 7, 10].includes(m) ? r1000(p.base * p.taxQuarter) : 0,
      other: r1000(p.base * p.other),
    };
    const events = p.events.filter((e) => e.m === m).map((e) => ({ label: e.label, amount: r1000(p.base * e.share), recurring: e.recurring }));
    const outflow = Object.values(breakdown).reduce((a, b) => a + b, 0) + events.reduce((a, e) => a + e.amount, 0);
    balance += inflow - outflow;
    months.push({ month: d.toISOString().slice(0, 7), inflow, outflow, balance, minBalance, negativeDays, breakdown, events });
  }
  return months;
}

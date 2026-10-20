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
export const STATEMENTS = {
  '7701234567': { base: 4800000, cv: 0.07, negativeDays: 0, minBalanceShare: 0.25 },
  '500100732259': { base: 1650000, cv: 0.2, negativeDays: 2, minBalanceShare: 0.08 },
  '7743987654': { base: 160000, cv: 0.45, negativeDays: 12, minBalanceShare: 0.0 },
  '7700000001': { base: 90000, cv: 0.3, negativeDays: 6, minBalanceShare: 0.02 },
};

export function buildStatement(inn, monthsCount = 12, now = new Date()) {
  const p = STATEMENTS[inn];
  if (!p) return null;
  const rnd = mulberry32(Number(String(inn).slice(-7)) || 1);
  const months = [];
  const company = COMPANIES[inn];
  const available = Math.min(monthsCount, Math.max(1, (company?.regMonthsAgo ?? 12)));
  for (let i = available; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const swing = (rnd() * 2 - 1) * p.cv;
    const inflow = Math.round((p.base * (1 + swing)) / 1000) * 1000;
    const outflow = Math.round((inflow * (0.9 + rnd() * 0.08)) / 1000) * 1000;
    const negativeDays = Math.max(0, Math.round(p.negativeDays + (rnd() * 2 - 1) * (p.negativeDays > 0 ? 1.5 : 0)));
    months.push({
      month: d.toISOString().slice(0, 7),
      inflow,
      outflow,
      minBalance: Math.round((inflow * p.minBalanceShare * (0.8 + rnd() * 0.4)) / 1000) * 1000,
      negativeDays,
    });
  }
  return months;
}

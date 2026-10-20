// Каталог кредитных продуктов (синтетический, параметры вымышлены для демонстрации).
export const ENGINE_VERSION = '1.0.0';

export const PRODUCTS = {
  working_capital: {
    id: 'working_capital',
    name: 'Оборотный кредит',
    short: 'Закупки, зарплаты, текущие расходы',
    min: 300_000, max: 10_000_000,
    minTerm: 3, maxTerm: 36, defaultTerm: 24,
    baseRate: 19.0,
    approveThreshold: 50,
    turnoverMultiple: 2.0,   // максимум суммы в месячных оборотах
    securedByPurchase: false,
    documents: ['Паспорт руководителя', 'Согласие на запрос в БКИ'],
    description: 'Единовременная сумма на счёт, платежи равными частями. Без залога.',
  },
  equipment: {
    id: 'equipment',
    name: 'Кредит на оборудование',
    short: 'Покупка техники, транспорта, оборудования',
    min: 500_000, max: 15_000_000,
    minTerm: 12, maxTerm: 60, defaultTerm: 36,
    baseRate: 17.5,
    approveThreshold: 48,
    turnoverMultiple: 3.0,
    securedByPurchase: true, // приобретаемое имущество выступает залогом
    documents: ['Паспорт руководителя', 'Согласие на запрос в БКИ', 'Счёт или договор на покупку оборудования'],
    description: 'Ставка ниже, потому что залогом становится приобретаемое оборудование.',
  },
  overdraft: {
    id: 'overdraft',
    name: 'Овердрафт',
    short: 'Кассовые разрывы до года',
    min: 100_000, max: 5_000_000,
    minTerm: 1, maxTerm: 12, defaultTerm: 12,
    baseRate: 21.0,
    approveThreshold: 58,
    turnoverMultiple: 1.0,
    securedByPurchase: false,
    documents: ['Паспорт руководителя', 'Согласие на запрос в БКИ'],
    description: 'Возобновляемый лимит на счёте для закрытия кассовых разрывов.',
  },
};

export const PURPOSES = {
  cash_gap: { label: 'Закрыть кассовый разрыв', product: 'overdraft' },
  working: { label: 'Пополнить оборотные средства', product: 'working_capital' },
  equipment: { label: 'Купить оборудование или технику', product: 'equipment' },
  development: { label: 'Развитие: запуск нового направления', product: 'working_capital' },
};

export function getProduct(id) {
  const p = PRODUCTS[id];
  if (!p) throw Object.assign(new Error('Неизвестный продукт'), { status: 400, code: 'unknown_product' });
  return p;
}

// Доля свободного денежного потока от оборота по группам видов деятельности.
// Упрощённая оценка рентабельности для расчёта платёжной нагрузки (допущение MVP).
export const MARGIN_BY_GROUP = {
  trade: 0.12, production: 0.15, transport: 0.14, food_service: 0.18, services: 0.22, other: 0.15,
};

export function okvedGroup(code = '') {
  const n = Number(String(code).split('.')[0]);
  if (n === 45 || n === 46 || n === 47) return 'trade';
  if (n >= 10 && n <= 33) return 'production';
  if (n >= 49 && n <= 53) return 'transport';
  if (n === 55 || n === 56) return 'food_service';
  if ((n >= 58 && n <= 63) || (n >= 69 && n <= 75) || (n >= 77 && n <= 82) || (n >= 85 && n <= 96)) return 'services';
  return 'other';
}

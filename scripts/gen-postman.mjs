// Генерирует docs/postman/credit-cabinet.postman_collection.json. Запуск: node scripts/gen-postman.mjs
import fs from 'node:fs';

const R = (name, method, path, body, extra = {}) => ({ name, method, path, body, ...extra });
const folders = {
  'Вход и тестовые данные': [
    R('Тестовые аккаунты', 'GET', '/api/demo/accounts', null, { auth: false }),
    R('Вход клиента A (сохраняет токен)', 'POST', '/api/auth/login', { login: 'client-a', password: 'demo1234' }, { auth: false, saveToken: 'token' }),
    R('Вход аналитика (сохраняет токен)', 'POST', '/api/auth/login', { login: 'analyst', password: 'demo1234' }, { auth: false, saveToken: 'analystToken' }),
    R('Текущий пользователь', 'GET', '/api/auth/me'),
    R('Продукты', 'GET', '/api/products', null, { auth: false }),
  ],
  'Компания и предложения': [
    R('Подключить компанию по ИНН', 'POST', '/api/companies', { inn: '7701234567' }),
    R('Профиль и статус источников', 'GET', '/api/companies/7701234567'),
    R('Предодобренные предложения', 'GET', '/api/companies/7701234567/offers'),
    R('Лента (строится из денежного календаря клиента)', 'GET', '/api/companies/7701234567/feed'),
    R('Денежный календарь: прогноз остатка на 12 месяцев', 'GET', '/api/companies/7701234567/cashflow'),
    R('Автопилот: настройки, подсказка, прогноз', 'GET', '/api/companies/7701234567/autopilot'),
    R('Автопилот: включить копилку 1 %', 'PUT', '/api/companies/7701234567/autopilot', { reserveShare: 0.01, protectionLimit: 0 }),
    R('Автопилот: включить защиту 300 000 ₽', 'PUT', '/api/companies/7701234567/autopilot', { reserveShare: 0.01, protectionLimit: 300000 }),
    R('ИИ-помощник: готова ли модель', 'GET', '/api/assistant/status'),
    R('ИИ-помощник: задача своими словами', 'POST', '/api/assistant/parse', { text: 'Клиенты платят через 60 дней, а зарплату 800 тысяч нужно платить сейчас' }),
    R('Пересчёт: овердрафт под разрыв из календаря (в ответе — cashflow с кредитом)', 'POST', '/api/offers/preview', { inn: '7701234567', request: { product: 'overdraft', amount: 300000, term: 8, collateral: false } }),
    R('Пересчёт: срок 24 → 36 месяцев', 'POST', '/api/offers/preview', { inn: '7701234567', request: { product: 'working_capital', amount: 2500000, term: 36, collateral: false }, compareTo: { product: 'working_capital', amount: 2500000, term: 24, collateral: false } }),
  ],
  'Заявка клиента (сценарий «одобрение»)': [
    R('Создать черновик', 'POST', '/api/applications', { inn: '7701234567', request: { product: 'working_capital', amount: 2500000, term: 24, collateral: false }, purpose: 'working' }, { save: ['applicationId', 'application.id'] }),
    R('Приложить паспорт', 'PUT', '/api/applications/{{applicationId}}/documents/passport', { fileName: 'passport.pdf' }),
    R('Приложить согласие на запрос в БКИ', 'PUT', '/api/applications/{{applicationId}}/documents/bki_consent', { fileName: 'consent.pdf' }),
    R('Автосохранение: согласие на обработку данных', 'PATCH', '/api/applications/{{applicationId}}', { form: { consents: { personalData: true } } }),
    R('Отправить (идемпотентно)', 'POST', '/api/applications/{{applicationId}}/submit', {}, { headers: { 'Idempotency-Key': 'collection-submit-1' } }),
    R('Карточка заявки (повторяйте, пока статус не изменится)', 'GET', '/api/applications/{{applicationId}}'),
    R('Принять условия', 'POST', '/api/applications/{{applicationId}}/accept', {}, { headers: { 'Idempotency-Key': 'collection-accept-1' } }),
    R('Подписать договор', 'POST', '/api/applications/{{applicationId}}/sign', { confirm: true }, { headers: { 'Idempotency-Key': 'collection-sign-1' } }),
    R('Мои заявки', 'GET', '/api/applications'),
    R('Уведомления', 'GET', '/api/notifications'),
  ],
  'Аналитик': [
    R('Очередь', 'GET', '/api/analyst/queue', null, { tokenVar: 'analystToken' }),
    R('Карточка заявки (укажите id в переменной applicationId)', 'GET', '/api/analyst/applications/{{applicationId}}', null, { tokenVar: 'analystToken' }),
    R('Справка по заявке: факты, вывод, вопросы клиенту', 'GET', '/api/analyst/applications/{{applicationId}}/brief', null, { tokenVar: 'analystToken' }),
    R('Решение: одобрить (для заявки на ручной проверке)', 'POST', '/api/analyst/applications/{{applicationId}}/decision', { action: 'approve', comment: 'Обороты стабильны, нагрузка приемлемая.' }, { tokenVar: 'analystToken' }),
    R('Решение: запросить данные (для заявки на ручной проверке)', 'POST', '/api/analyst/applications/{{applicationId}}/decision', { action: 'request_info', comment: 'Подтвердите источник поступлений в марте.' }, { tokenVar: 'analystToken' }),
    R('Решение: повторить проверку (для заявки на ручной проверке)', 'POST', '/api/analyst/applications/{{applicationId}}/decision', { action: 'rerun' }, { tokenVar: 'analystToken' }),
  ],
  'Служебное': [
    R('Проверка живости', 'GET', '/health', null, { auth: false }),
    R('Спецификация OpenAPI', 'GET', '/openapi.json', null, { auth: false }),
  ],
};

function item(r) {
  const headers = [];
  if (r.body !== null && r.body !== undefined) headers.push({ key: 'Content-Type', value: 'application/json' });
  for (const [k, v] of Object.entries(r.headers || {})) headers.push({ key: k, value: v });
  const it = {
    name: r.name,
    request: {
      method: r.method, header: headers,
      url: { raw: `{{baseUrl}}${r.path}`, host: ['{{baseUrl}}'], path: r.path.split('/').filter(Boolean) },
    },
  };
  if (r.auth !== false) it.request.auth = { type: 'bearer', bearer: [{ key: 'token', value: `{{${r.tokenVar || 'token'}}}`, type: 'string' }] };
  else it.request.auth = { type: 'noauth' };
  if (r.body !== null && r.body !== undefined) it.request.body = { mode: 'raw', raw: JSON.stringify(r.body, null, 2), options: { raw: { language: 'json' } } };
  const exec = [];
  if (r.saveToken) exec.push(`pm.collectionVariables.set('${r.saveToken}', pm.response.json().token);`);
  if (r.save) exec.push(`pm.collectionVariables.set('${r.save[0]}', pm.response.json().${r.save[1]});`);
  exec.push(`pm.test('Статус ответа не 5xx', () => pm.expect(pm.response.code).to.be.below(500));`);
  it.event = [{ listen: 'test', script: { type: 'text/javascript', exec } }];
  return it;
}

const collection = {
  info: {
    name: 'Умный кредитный кабинет — запросы',
    description: 'Порядок: «Вход клиента A» → «Подключить компанию» → «Создать черновик» → документы → «Отправить». Токены и id сохраняются в переменные коллекции. Для сценария с аналитиком сначала войдите аналитиком, затем подайте заявку на 5 000 000 ₽ и укажите её id в applicationId.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }, { key: 'token', value: '' }, { key: 'analystToken', value: '' }, { key: 'applicationId', value: '' }],
  item: Object.entries(folders).map(([name, list]) => ({ name, item: list.map(item) })),
};
fs.mkdirSync(new URL('../docs/postman/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../docs/postman/credit-cabinet.postman_collection.json', import.meta.url), JSON.stringify(collection, null, 2));
console.log('requests:', Object.values(folders).flat().length);

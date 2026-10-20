// Тестовые учётные записи. Все данные вымышлены. Отключается переменной SEED=0.
import { hashPassword } from './auth.js';
import { nowIso } from './db.js';

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_ACCOUNTS = [
  { login: 'client-a', name: 'Миронов А. П.', role: 'client', inn: '7701234567', company: 'Ромашка Логистика', scenario: 'Одобрение', hint: 'Оборотный кредит 2 500 000 ₽ на 24 мес. — одобрят сразу. 5 000 000 ₽ — уйдёт аналитику.' },
  { login: 'client-b', name: 'Соколов Д. И.', role: 'client', inn: '500100732259', company: 'ИП Соколов Д. И.', scenario: 'Другие условия', hint: 'Овердрафт 1 500 000 ₽ на 12 мес. — банк предложит варианты, которые проходят.' },
  { login: 'client-c', name: 'Гарипова Л. Р.', role: 'client', inn: '1650654321', company: 'Северный Хлеб', scenario: 'Нужна информация', hint: 'Нет выписки по счёту. Банк спросит выручку, затем решит.' },
  { login: 'client-d', name: 'Лебедев И. С.', role: 'client', inn: '7743987654', company: 'Новый Старт', scenario: 'Отказ: стоп-фактор', hint: 'Есть текущая просрочка и компании 3 месяца. Банк объяснит причины и план.' },
  { login: 'client-e', name: 'Орлов П. В.', role: 'client', inn: '7700000001', company: 'Тихая Гавань', scenario: 'Отказ: ликвидация', hint: 'Компания в процессе ликвидации.' },
  { login: 'analyst', name: 'Кредитный аналитик', role: 'analyst', scenario: 'Кабинет аналитика', hint: 'Очередь на ручную проверку, карточка с баллами и журналом.' },
];

export function seedDemo(db) {
  const exists = db.prepare('SELECT 1 FROM users WHERE login = ?');
  const ins = db.prepare('INSERT INTO users (login, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?)');
  for (const a of DEMO_ACCOUNTS) {
    if (!exists.get(a.login)) ins.run(a.login, hashPassword(DEMO_PASSWORD), a.role, a.name, nowIso());
  }
}

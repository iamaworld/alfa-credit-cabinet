// Статусы заявки, допустимые переходы и тексты для клиента простым языком.
export const TRANSITIONS = {
  draft: ['submitted', 'cancelled'],
  submitted: ['checking'],
  checking: ['enrichment'],
  enrichment: ['scoring', 'manual_review'],
  scoring: ['approved', 'counter_offer', 'needs_info', 'declined', 'manual_review'],
  manual_review: ['approved', 'counter_offer', 'needs_info', 'declined', 'enrichment'],
  needs_info: ['enrichment', 'cancelled', 'expired'],
  counter_offer: ['signing', 'cancelled', 'expired'],
  approved: ['signing', 'cancelled', 'expired'],
  signing: ['disbursed', 'cancelled', 'expired'],
  disbursed: [],
  declined: [],
  cancelled: [],
  expired: [],
};

export const TERMINAL = new Set(['disbursed', 'declined', 'cancelled', 'expired']);
export const IN_PIPELINE = new Set(['submitted', 'checking', 'enrichment', 'scoring']);

// stage — шаг на полосе прогресса: 0 Заявка, 1 Проверка, 2 Решение, 3 Договор, 4 Деньги
export const STAGES = ['Заявка', 'Проверка', 'Решение', 'Договор', 'Деньги'];

export const STATUS_VIEW = {
  draft:         { stage: 0, tone: 'neutral', title: 'Черновик', text: 'Заявка заполнена не до конца. Изменения сохраняются автоматически.', next: 'Заполните поля, приложите документы и отправьте заявку.' },
  submitted:     { stage: 1, tone: 'progress', title: 'Заявка принята', text: 'Мы получили заявку и начинаем проверку.', next: 'Ничего делать не нужно. Статус обновится сам.' },
  checking:      { stage: 1, tone: 'progress', title: 'Проверяем документы', text: 'Проверяем, что документы и согласия на месте.', next: 'Ничего делать не нужно.' },
  enrichment:    { stage: 1, tone: 'progress', title: 'Собираем данные', text: 'Сверяем сведения о компании, кредитную историю и обороты по счёту.', next: 'Ничего делать не нужно.' },
  scoring:       { stage: 1, tone: 'progress', title: 'Оцениваем заявку', text: 'Считаем платёж, нагрузку и оценку по вашим данным.', next: 'Решение появится здесь.' },
  manual_review: { stage: 1, tone: 'progress', title: 'Проверяет специалист банка', text: 'Заявку смотрит кредитный аналитик: сумма или обстоятельства требуют решения человека.', next: 'Ответ придёт в этот кабинет. Если нужны уточнения, мы спросим здесь же.' },
  needs_info:    { stage: 1, tone: 'action', title: 'Нужна информация', text: 'Чтобы принять решение, не хватает данных.', next: 'Ответьте на вопрос ниже. Остальные данные мы сохранили.' },
  counter_offer: { stage: 2, tone: 'action', title: 'Есть другое предложение', text: 'На запрошенных условиях одобрить не можем, но подобрали варианты, которые проходят.', next: 'Выберите вариант или откажитесь.' },
  approved:      { stage: 2, tone: 'success', title: 'Одобрено', text: 'Заявка одобрена на запрошенных условиях.', next: 'Проверьте условия и примите предложение.' },
  declined:      { stage: 2, tone: 'danger', title: 'Отказ', text: 'Одобрить заявку сейчас не можем.', next: 'Ниже причины и что можно сделать, чтобы изменить ситуацию.' },
  signing:       { stage: 3, tone: 'action', title: 'Подпишите договор', text: 'Договор сформирован. Подпись в прототипе имитируется кнопкой.', next: 'Подпишите договор, и деньги поступят на счёт.' },
  disbursed:     { stage: 4, tone: 'success', title: 'Деньги на счёте', text: 'Договор подписан, средства зачислены на расчётный счёт (имитация).', next: 'График платежей — ниже, в карточке заявки.' },
  cancelled:     { stage: 0, tone: 'neutral', title: 'Отменена', text: 'Заявка отменена.', next: 'Вы можете подать новую заявку.' },
  expired:       { stage: 2, tone: 'neutral', title: 'Срок предложения истёк', text: 'Предложение действовало ограниченное время и больше не доступно.', next: 'Подайте новую заявку: условия будут пересчитаны.' },
};

export const OUTCOME_LABEL = { approve: 'Одобрить', counter_offer: 'Предложить другие условия', need_info: 'Запросить информацию', decline: 'Отказать' };

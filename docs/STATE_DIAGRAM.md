# Диаграмма состояний заявки

Источник правды — таблица `TRANSITIONS` в `app/src/services/statuses.js`. Недопустимый переход возвращает 409 `invalid_transition`.

```mermaid
stateDiagram-v2
  [*] --> draft: клиент создал черновик
  draft --> submitted: отправка (идемпотентно)
  draft --> cancelled
  submitted --> checking
  checking --> enrichment: комплект документов полный
  enrichment --> scoring: данные получены
  enrichment --> manual_review: источник недоступен, копии нет
  scoring --> approved: автоматическое одобрение
  scoring --> counter_offer: другие условия
  scoring --> needs_info: не хватает данных
  scoring --> declined: отказ со стоп-фактором
  scoring --> manual_review: крупная сумма, пограничная оценка,\nотказ без стоп-фактора, данные из кэша
  manual_review --> approved: аналитик
  manual_review --> counter_offer: аналитик
  manual_review --> needs_info: аналитик задал вопрос
  manual_review --> declined: аналитик
  manual_review --> enrichment: повторить проверку
  needs_info --> enrichment: клиент ответил на все вопросы
  needs_info --> cancelled
  counter_offer --> signing: клиент выбрал вариант
  counter_offer --> cancelled: отказался
  counter_offer --> expired: 7 дней
  approved --> signing: клиент принял условия
  approved --> cancelled
  approved --> expired: 7 дней
  signing --> disbursed: подпись (имитация)
  signing --> cancelled
  signing --> expired
  disbursed --> [*]
  declined --> [*]
  cancelled --> [*]
  expired --> [*]
```

## Что видит клиент на каждом статусе

| Статус | Заголовок | Что дальше |
|---|---|---|
| draft | Черновик | Заполнить, приложить документы, отправить |
| submitted, checking, enrichment, scoring | Заявка принята, Проверяем документы, Собираем данные, Оцениваем заявку | Ничего не делать, статус обновляется сам |
| manual_review | Проверяет специалист банка | Ждать, при вопросах банк спросит в карточке |
| needs_info | Нужна информация | Ответить на вопрос; остальные данные сохранены |
| counter_offer | Есть другое предложение | Выбрать вариант или отказаться |
| approved | Одобрено | Принять условия |
| declined | Отказ | Прочитать причины и план, пересчитать условия |
| signing | Подпишите договор | Подтвердить и подписать |
| disbursed | Деньги на счёте | — |
| cancelled, expired | Отменена, Срок предложения истёк | Подать новую заявку |

Тексты хранятся в `STATUS_VIEW` и совпадают с тем, что показывает интерфейс.

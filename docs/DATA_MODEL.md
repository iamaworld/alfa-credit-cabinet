# Модель данных

SQLite, схема создаётся при старте (`app/src/db.js`, константа `SCHEMA`). Суммы хранятся целыми рублями, время — ISO-8601 UTC.

```mermaid
erDiagram
  users ||--o{ user_companies : "подключает"
  users ||--o{ applications : "подаёт"
  users ||--o{ offers : "получает"
  users ||--o{ notifications : "читает"
  applications ||--o{ application_events : "журнал"
  applications ||--o{ decisions : "решения"
  applications ||--o{ info_requests : "вопросы клиенту"
  applications ||--o{ documents : "комплект"
  applications ||--o{ enrichment_snapshots : "данные источников"
  users { int id PK
    text login UK
    text password_hash
    text role "client | analyst"
    text display_name }
  user_companies { int user_id FK
    text inn
    text added_at }
  offers { int id PK
    int user_id FK
    text inn
    text product
    int amount
    int term
    text payload "факторы и условия"
    text expires_at
    text engine_version }
  applications { int id PK
    text number UK "AK-2026-000001"
    int user_id FK
    text inn
    text status
    text product
    int amount
    int term
    int collateral
    text purpose
    int declared_revenue
    text form "JSON: данные компании и согласия"
    text accepted_terms "JSON: условия договора"
    int version "оптимистичная блокировка"
    text submitted_at
    text decided_at }
  application_events { int id PK
    int application_id FK
    text ts
    text actor "client | system | engine | analyst:логин"
    text type
    text from_status
    text to_status
    text public_text "виден клиенту"
    text internal_text "виден аналитику"
    text payload }
  decisions { int id PK
    int application_id FK
    text outcome "approve | counter_offer | need_info | decline | pending"
    text routing "auto | manual"
    int score
    text engine_version
    text made_by
    int final "0 — рекомендация, 1 — итог"
    text payload "факторы с баллами, альтернативы, причины ручной проверки"
    text comment }
  info_requests { int id PK
    int application_id FK
    text kind "revenue | text"
    text question
    text status "open | answered | closed"
    text answer }
  documents { int id PK
    int application_id FK
    text kind
    text title
    text status "required | provided"
    text file_name }
  enrichment_snapshots { int id PK
    int application_id FK
    text inn
    text source "fns | bki | statement"
    int ok
    int degraded
    text payload
    text error
    text fetched_at }
  notifications { int id PK
    int user_id FK
    int application_id FK
    text title
    text body
    int read }
  idempotency { text key PK
    int user_id PK
    text scope PK
    text request_hash
    text response
    int status }
```

## Автопилот

| Таблица `autopilot` | Тип | Смысл |
|---|---|---|
| `user_id`, `inn` | ключ | Настройки клиента для компании |
| `reserve_share` | REAL | Доля поступлений в копилку (0–0,2, не больше доли вывода собственнику) |
| `protection_limit` | INTEGER | Лимит защиты от разрыва, ₽ (0 — выключена); включается только после одобрения движком |
| `protection_rate` | REAL | Ставка по лимиту на момент одобрения |
| `updated_at` | TEXT | Когда изменены настройки |

## Принципы

- **Журнал событий не редактируется.** `application_events` только дописывается; у каждой записи есть автор. Клиент видит записи с `public_text`, аналитик — все.
- **Рекомендация и решение разделены.** При ручной проверке движок пишет `decisions` с `final = 0`, аналитик — запись с `final = 1`. Клиент видит только итоговое.
- **Снимки данных.** Решение пересчитывается по сохранённым ответам источников, а не по тому, что они вернут сегодня.
- **Идемпотентность.** Ключ + пользователь + область + хэш тела.

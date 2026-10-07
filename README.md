# AttendBack

Возвратный залог за посещение мероприятий. Самостоятельная регистрация, очередь, check-in, споры и расчёты в Solana. Локальная разработка и devnet; реальные средства не поддержаны этим релизом.

## План и статус

- [Утверждённые этапы](hackathon-product-plan/development-plan.ru.md)
- [Проверенный прогресс](docs/progress.ru.md)
- [Продуктовая спецификация](hackathon-product-plan/product-plan.ru.md)

## Окружение

Node 24.19.0, pnpm 11.25.0, Rust 1.99.0, Anchor 1.2.1, Agave 4.3.0, Surfpool 1.6.0, PostgreSQL 18.4. Зависимости закреплены в lock-файлах. На машине Codex `scripts/pnpmw` находит bundled Node; на обычной машине установите Node и pnpm этих версий.

```sh
./scripts/pnpmw install --frozen-lockfile
# Сначала установите Rust, Anchor и Agave указанных версий.
# Для уже установленных в этом workspace инструментов:
source scripts/toolchain.sh
NO_DNA=1 anchor build
./scripts/pnpmw codegen
./scripts/pnpmw db:start
# в других терминалах из корня репозитория
./scripts/pnpmw db:migrate
./scripts/pnpmw localnet
./scripts/pnpmw dev
./scripts/pnpmw worker
./scripts/pnpmw demo:seed
```

Альтернатива локальному PostgreSQL: `docker compose up -d db`. Значения `.env.example` предназначены только для localhost. Next читает свой env из `apps/web/.env.local`; серверные процессы получают параметры из окружения. Секреты не коммитить.

Для изолированно установленных Rust/Solana CLI: `source scripts/toolchain.sh`. Скрипт не меняет глобальный профиль. `.local` содержит инструменты, данные БД и исключена из Git.

Откройте `http://127.0.0.1:3000`. В меню кошелька доступны явно помеченные локальные роли «Организатор», «Участник», «Сотрудник», «Арбитр». На localhost они используют общедоступные тестовые ключи и токены без стоимости. Обычные кошельки подключаются через Wallet Standard; есть v1 и fallback на v0. Никогда не переводите реальные средства тестовым ролям.

## Независимый возврат

```sh
./scripts/pnpmw recovery:build
./scripts/pnpmw recovery:start
```

Откройте `http://127.0.0.1:4173`, укажите RPC и адрес депозита из билета. Клиент читает finalized аккаунты напрямую из Solana, проверяет владельца/тип/PDA/mint, симулирует и предлагает подписать возврат. API, БД и worker AttendBack не нужны. Нужны доступный RPC, разрешённое состояние/срок и SOL у плательщика комиссии. Каталог `apps/recovery/dist` можно разместить отдельно от основного приложения.

## Проверки

Локальная Solana и PostgreSQL должны работать. Тесты используют отдельные базы с суффиксом `_test`; E2E поднимает собственные web и worker на порту 3001.

```sh
./scripts/pnpmw exec node --import tsx scripts/test-db.ts
./scripts/pnpmw check
./scripts/pnpmw test:db
./scripts/pnpmw recovery:build
PLAYWRIGHT_BROWSERS_PATH=.local/playwright ./scripts/pnpmw exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.local/playwright ./scripts/pnpmw test:e2e
./scripts/pnpmw db:backup-check
```

Для `db:backup-check` нужны `pg_dump` и `pg_restore` 18.4: скрипт ищет локальную установку `.local/toolchain/postgres-client/bin`. Он восстанавливает снимок тестовой БД во временную новую БД и сравнивает все строки. Не предназначен для production-бэкапов.

GitHub workflow строит SBF до программных тестов, проверяет генерацию клиента, поднимает Surfpool, выполняет PostgreSQL и браузерные тесты. Успех CI на GitHub можно подтвердить только после публикации коммитов и фактического запуска workflow.

## Структура и документы

- `apps/web`: Next.js, роли, кошелёк, API; `apps/worker`: очередь и сверка сети.
- `apps/recovery`: независимый статический клиент возврата.
- `programs/attendback`: Anchor; `idl` и `packages/chain-client`: сгенерированный Codama-клиент.
- `packages/db`: PostgreSQL и миграции; `packages/domain`: правила и денежные типы.
- [Архитектура](docs/architecture.ru.md), [денежный протокол](docs/protocol.ru.md), [ревью](docs/review.html), [ограничения окружения](docs/runtime-notes.ru.md).

## Границы текущего релиза

Это локальный демонстрационный продукт. Devnet-адрес размещённой программы, пользовательский плательщик, upgrade authority, сервисные роли и публичные URL ещё должны быть согласованы и проверены. Mainnet отключён. Внешние email/SMS, карты/тенге, SSO и интеграции с регистрационными площадками не входят в эту версию; уведомления доступны внутри приложения.

Перезапуск `localnet` сбрасывает цепочку, но не БД. После сброса создайте новое демособытие; старые адреса больше не подтверждают состояние. Для чистой демонстрации можно использовать новую локальную БД через `DATABASE_URL`, применить миграции и запустить `demo:seed`. Не удаляйте рабочую БД для сброса теста.

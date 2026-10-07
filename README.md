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
./scripts/pnpmw db:start
# в других терминалах из корня репозитория
./scripts/pnpmw dev
./scripts/pnpmw worker
./scripts/pnpmw check
```

Альтернатива локальному PostgreSQL: `docker compose up -d db`. Значения `.env.example` предназначены только для localhost. Next читает свой env из `apps/web/.env.local`; серверные процессы получают параметры из окружения. Секреты не коммитить.

Для изолированно установленных Rust/Solana CLI: `source scripts/toolchain.sh`. Скрипт не меняет глобальный профиль. `.local` содержит инструменты, данные БД и исключена из Git.

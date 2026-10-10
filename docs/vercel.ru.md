# AttendBack — подготовка к Vercel

Этап 9 [утверждённого плана](../hackathon-product-plan/development-plan.ru.md). Для бесплатного devnet-прототипа выбран Vercel Hobby + Neon Free. Текущие результаты публикации и ограничения — в [описании бесплатного размещения](free-hosting.ru.md).

## Что размещается

Основной сайт для участников и организаторов: [attendback-three.vercel.app](https://attendback-three.vercel.app/?lang=ru). Проект `attendback-signer` — отдельный сервер подписи: его главная страница объясняет назначение сервиса и ведёт в приложение. Она не проверяет состояние ключей или RPC. `GET /api/health` и `POST /api/sign` остаются закрыты Bearer-токеном; HTTP 401 при открытии health в обычном браузере ожидаем. Не заменять Root Directory signer на `apps/web`: у этих проектов разные секреты и назначение.

| Часть               | Размещение                                                        | Настройка                                        |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| Web и API           | Vercel, проект Next.js                                            | Root Directory: `apps/web`                       |
| Независимый возврат | Отдельный Vercel-проект Vite или другой статический HTTPS-хост    | Root Directory: `apps/recovery`                  |
| PostgreSQL          | Внешний PostgreSQL с TLS и пулером соединений                     | `DATABASE_URL` для web и worker                  |
| Worker расчётов     | Vercel Workflow с сохранённым состоянием и пробуждением по срокам | `RECONCILIATION_MODE=workflow`                   |
| Signer              | Отдельный Vercel-проект Next.js                                   | Root Directory: `apps/signer`                    |
| Программа Anchor    | Solana devnet                                                     | [Отдельный порядок релиза](devnet-release.ru.md) |

Workflow вызывает ограниченные пакеты существующего worker и засыпает между ними. Успешные изменения API пробуждают обработчик; защищённый Cron раз в день служит резервным запуском. Постоянный `pnpm worker` остаётся для локальной разработки и выделенного сервера. Приватные ключи сервисных ролей находятся только в проекте signer; web получает адреса и токен обращения к нему. Recovery не зависит от API AttendBack, но все Vercel-проекты зависят от одного хостинг-провайдера.

## 1. Сначала опубликовать recovery

В Vercel импортировать `ernur077sss-art/AttendBack` как отдельный проект:

- **Root Directory:** `apps/recovery`.
- **Include source files outside of the Root Directory in the Build Step:** включить — зависимости и общий код находятся в корне и `packages`.
- **Framework Preset:** Vite.
- **Node.js:** `24.x`.
- **Environment Variables:** `ENABLE_EXPERIMENTAL_COREPACK=1` для Production и Preview; остальные секреты этому проекту не нужны.
- **Install Command:** `pnpm --dir ../.. install --frozen-lockfile`.
- **Build Command:** `pnpm --dir ../.. recovery:build`.
- **Output Directory:** `dist`.

Команды уже записаны в [apps/recovery/vercel.json](../apps/recovery/vercel.json). `packageManager` фиксирует pnpm 11.25.0; Corepack нужен, чтобы пользовательская install-команда не выбрала старую версию pnpm в образе Vercel. Сохранить полученный HTTPS-адрес для `NEXT_PUBLIC_RECOVERY_URL` основного приложения.

## 2. Подготовить внешние сервисы

Нужны работающие PostgreSQL, devnet RPC, signer и размещённая программа. Для новой БД можно использовать PostgreSQL через Vercel Marketplace; существующая внешняя БД также подключается стандартной строкой PostgreSQL. Текущий код использует драйвер `pg`, транзакции и блокировки строк; заменять его HTTP-запросами к БД не требуется.

Для web использовать pooled connection string с TLS, например с параметром `sslmode=verify-full`; допустимы также `require` и `verify-ca`. Сертификаты должны проходить проверку драйвера. Не отключать TLS или проверку сертификатов для обхода ошибки подключения. Регион функций выбрать рядом с базой данных. Пул в каждом экземпляре web ограничен пятью соединениями по умолчанию, а `attachDatabasePool` освобождает простаивающие соединения перед приостановкой функции; общий лимит БД всё равно должен учитывать число экземпляров и worker.

Миграции запускать один раз отдельной release-командой **через прямое подключение к БД**, а не через transaction pooler: мигратор использует session advisory lock. Не выполнять миграции во время каждой Vercel-сборки.

```sh
# Выполнить из корня репозитория в доверенном окружении.
# DATABASE_MIGRATION_URL заранее задана через менеджер секретов.
DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm db:migrate
```

Для Preview выделить отдельную БД/ветку БД и отдельные devnet-сервисные роли; не выдавать непроверенной ветке production-доступы. Не запускать `demo:seed` или `localnet` на публичных хостах.

## 3. Настроить web/API

Импортировать тот же GitHub-репозиторий во второй Vercel-проект:

- **Root Directory:** `apps/web` — не корень репозитория.
- **Include source files outside of the Root Directory in the Build Step:** включить.
- **Framework Preset:** Next.js.
- **Node.js:** `24.x`.
- **Install Command:** `pnpm --dir ../.. install --frozen-lockfile`.
- **Build Command:** `pnpm --dir ../.. build:vercel`.
- **Output Directory:** оставить стандартным для Next.js (`.next`), без `out` или `dist`.
- **Fluid Compute:** включён в [apps/web/vercel.json](../apps/web/vercel.json).

В корне репозитория нет универсального `vercel.json`: конфигурация выбирается по Root Directory каждого проекта. Общие зависимости включены в Next.js file tracing через `outputFileTracingRoot`. В облаке не нужны Rust, Anchor, локальная Solana или пересоздание IDL — сгенерированный клиент уже находится в Git.

Шаблон переменных — [.env.vercel.example](../.env.vercel.example). Значения вводить через Vercel Environment Variables, а не коммитить env-файлы:

| Переменная                     | Значение и назначение                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, выбор закреплённого pnpm                                              |
| `DATABASE_URL`                 | Pooled URL внешнего PostgreSQL с TLS; секрет                               |
| `DATABASE_POOL_MAX`            | Необязательно: целое 2–50, по умолчанию 5 на Vercel                        |
| `APP_ORIGIN`                   | Точный production origin: `https://ваш-домен`, без пути и завершающего `/` |
| `SOLANA_CLUSTER`               | Только `devnet`                                                            |
| `SOLANA_RPC_URL`               | HTTPS RPC Solana devnet; ключ провайдера, если есть, хранить как секрет    |
| `SOLANA_EXPECTED_GENESIS_HASH` | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`                             |
| `SERVICE_SIGNER_URL`           | `https://attendback-signer.vercel.app/api/sign` для Vercel signer          |
| `SERVICE_SIGNER_TOKEN`         | Токен не короче 32 символов, совпадающий с токеном signer; секрет          |
| `SIGNER_BOOKING_ADDRESS`       | Публичный адрес booking authority                                          |
| `SIGNER_ATTESTER_ADDRESS`      | Другой публичный адрес attester                                            |
| `SIGNER_PAYER_ADDRESS`         | Третий публичный адрес плательщика сервисных транзакций                    |
| `NEXT_PUBLIC_RECOVERY_URL`     | Публичный HTTPS-адрес recovery; включается в браузерную сборку             |
| `RECONCILIATION_MODE`          | `workflow`, включает обработку очереди без отдельного сервера              |
| `CRON_SECRET`                  | Отдельный случайный секрет не короче 32 символов для резервного запуска    |

Не добавлять сюда файлы ключей, `SIGNER_*_KEY_FILE` или `SIGNER_*_KEY_BASE64`. Адрес плательщика deploy и upgrade authority нужны для отдельного выпуска программы, но не для web-сборки. После изменения `NEXT_PUBLIC_RECOVERY_URL` пересобрать web.

Production принимает запросы только с `APP_ORIGIN`. Для Preview код использует точный `https://${VERCEL_URL}`, предоставленный Vercel, и не доверяет произвольному HTTP Host. Открывать Preview по URL конкретного deployment; branch alias с другим origin не считается этим адресом. Системные переменные Vercel должны быть доступны. Проверки доступа и Secure-cookie сохраняются; Deployment Protection отключать не требуется.

## 4. Проверить конфигурацию и выпустить

```sh
# Переменные уже доступны в окружении; команда не выводит секреты.
pnpm vercel:check
pnpm build:vercel
```

`vercel:check` проверяет форму конфигурации без сетевых запросов. Отсутствующая devnet-конфигурация, localhost вместо публичных сервисов, неверный genesis, общие адреса сервисных ролей и ключевые файлы на web-хосте останавливают сборку. При `VERCEL=1` та же проверка выполняется в API и доступе к сети, поэтому обход build-команды не включает публичные localnet-роли. Успех проверки не подтверждает доступность БД, signer, программы или RPC.

После настройки сервисов выполнить read-only `pnpm release:check` из полного devnet release-окружения; затем следовать [порядку выпуска программы](devnet-release.ru.md). Для web сделать deployment и проверить:

1. `/api/health` возвращает HTTP 200, `database: true`, `cluster: devnet`.
2. `/api/config` показывает правильные program ID, mint и адреса ролей; меню не предлагает localnet-роли.
3. Подпись входа содержит правильный домен, а cookie имеет `Secure` и `HttpOnly`.
4. Кошелёк проходит создание события → депозит → QR → check-in → finalized-возврат; Workflow работает без локального worker.
5. Камера физического телефона работает по HTTPS; неявка, спор и независимый recovery проходят сценарии [демо](demo.ru.md).

Файл доказательства загружается отдельным запросом: текущий предел 2 MiB даёт менее 2,8 MB JSON с base64, ниже лимита Vercel Functions 4,5 MB. Не увеличивать этот лимит без изменения способа загрузки. Доказательства сохраняются в PostgreSQL, а не в эфемерной файловой системе функции.

## Граница готовности

Локально проверены TypeScript, 42 модульных/программных/signer/конфигурационных теста, 16 PostgreSQL/RPC-тестов и браузерный сценарий «залог → QR → finalized-возврат» (1/1). Обычная web-сборка, `build:vercel` с синтетическими значениями без внешних запросов и recovery build прошли. Проверены установка по frozen lockfile, runtime-файлы API, формат конфигураций и относительные ссылки. Незаполненная конфигурация ожидаемо отклоняется. Эти результаты относятся к подготовке исходников, а не к облачному запуску.

Эти проверки выполнялись до переноса worker в Workflow. Результаты новой схемы и облачного размещения указаны в [free-hosting.ru.md](free-hosting.ru.md); локальная production-сборка не является подтверждением успешного deployment на Vercel.

## Официальные источники

- [Vercel: monorepos](https://vercel.com/docs/monorepos)
- [Build settings и Corepack](https://vercel.com/docs/builds/configure-a-build)
- [Connection pooling with Functions](https://vercel.com/kb/guide/connection-pooling-with-functions)
- [Ограничения Vercel Functions](https://vercel.com/docs/functions/limitations)

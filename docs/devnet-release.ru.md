# AttendBack — devnet-релиз

Этап 9 [утверждённого плана](../hackathon-product-plan/development-plan.ru.md). Программа и облачные сервисы опубликованы 9 октября 2026. [Фактический протокол и подписи](deployment-2026-10-09.ru.md) · [манифест](release-manifest.json). Mainnet отключён.

## Текущее размещение

- Web/API: https://attendback-three.vercel.app — Vercel Hobby.
- Recovery: https://attendback-recovery.vercel.app — отдельный Vercel-проект.
- Signer: отдельный Vercel-проект, три приватные сервисные роли, Bearer-аутентификация.
- Очередь: Vercel Workflow с пробуждением по срокам и суточным резервным Cron.
- БД: Neon Free, 17 таблиц и 7 миграций. Все платные тарифы отключены.

[Настройка и ограничения размещения](free-hosting.ru.md). Дополнительный постоянный worker для этой топологии не нужен. Для локального запуска и альтернативного VPS остаётся отдельный процесс `pnpm worker`.

## Стоимость и недостающие параметры

Devnet genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
Программа: `6CUM27mNoskjKnCsoywCQz4puZfhpXj5DJWEDZJuiwuV`.
Тестовый USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, SPL Token, 6 знаков.

При `--max-len 265152`: Program account 833120 lamports; ProgramData 1347851000 lamports. Сумма account rent — 1348684120 lamports, плюс комиссии. Временный buffer повторно используется: [Agave CLI](https://github.com/anza-xyz/agave/blob/v4.3.0/cli/src/program.rs) финансирует его на rent ProgramData; [loader](https://github.com/anza-xyz/agave/blob/v4.3.0/programs/bpf_loader/src/lib.rs) возвращает сумму плательщику перед созданием ProgramData. Поэтому повторно прибавлять buffer нельзя. Прежняя оценка 5 SOL была завышена; ориентир первого пополнения 2 тестовых SOL был достаточен для этого бинарника с резервом. Фактически пользователь пополнил deployer на 10 devnet SOL.

Тестовые SOL/USDC не имеют денежной стоимости. Платные планы не подключались. Free/Hobby имеют квоты; размещение рассчитано на devnet-прототип для хакатона. Upgrade authority сохранён и может менять программу: это остаётся границей доверия.

## Повторный выпуск

1. Проверить конфигурацию по `.env.devnet.example`, HTTPS, genesis и отдельные роли. `release:check` проверяет форму конфигурации и сеть; он не подтверждает подпись или готовность БД.
2. Собрать SBF/IDL/клиент на зафиксированном toolchain, выполнить проверки по изменению. Сверить program ID, SHA-256, плательщика, upgrade authority и размер программы.
3. Сохранить протокол текущего релиза. `release:manifest` отказывается стирать манифест с `deployment: deployed`; для нового кандидата сначала архивировать предыдущую запись. Хеши, а не имя коммита, подтверждают идентичность бинарника.
4. Развёртывание выполняется только в согласованной сети с явными ключами/authority и включённым preflight. Не использовать `--final`, если не было отдельного решения отказаться от обновлений. Рост бинарника требует дополнительного расчёта rent.
5. Проверить finalized-подпись, executable/loader, ProgramData, authority и выгруженный SBF. Сохранить новые доказательства отдельно.
6. Применять только новые миграции перед выпуском web; не запускать первоначальный SQL для пустой схемы повторно. Сборка не выполняет миграции. Ключи и `.env` не загружать вместе с исходниками.
7. Собрать web с правильными `APP_ORIGIN` и `NEXT_PUBLIC_RECOVERY_URL`. Git push сам по себе пока не создаёт Vercel deployment: GitHub Login Connection не настроен. Текущие публикации выполнялись загрузкой отобранных исходников через API.
8. Проверить health, защиту API, пользовательский кошелёк, QR и фактический finalized-расчёт. Независимый recovery проверять отдельно от обычного возврата.

## Сервис подписи

Web отправляет POST на настроенный HTTPS `SERVICE_SIGNER_URL` с Bearer-токеном и `{role, cluster: 'devnet', program, transactions}`. Ответ содержит подписи байтов сообщения, которые web проверяет по публичному ключу роли. Сервис не меняет сообщение и не рассылает транзакции: он проверяет инструкции, сеть, mint, on-chain состояние, комиссию и симуляцию. [Контракт и ограничения signer](signer.ru.md).

Только signer получает приватные booking/attester/payer ключи. Web получает токен и публичные адреса. Deployer и upgrade authority хранятся отдельно. Не публиковать seed-фразы, приватные ключи или значения окружения. Изоляция Vercel-проектов не является аппаратным KMS.

## Не закрытые проверки

Основной API-сценарий подтверждён в облаке; обычный Wallet Standard кошелёк, физическая камера, публичный recovery при отказе API и дополнительные devnet-сценарии споров остаются в плане. Локальные automated tests не заменяют эти проверки. Не запускать `demo:seed` или public localnet test keys на devnet. При отказе RPC не освобождать PaymentPending вручную — дождаться finalized-сверки.

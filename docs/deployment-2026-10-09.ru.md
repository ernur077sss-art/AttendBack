# AttendBack: фактический devnet-релиз, 9 октября 2026

Продолжение этапов 6, 8 и 9 [утверждённого плана](../hackathon-product-plan/development-plan.ru.md).

## Опубликовано

- [Основное приложение](https://attendback-three.vercel.app): Vercel Hobby, Next.js/API + Workflow, deployment `dpl_UmD1Jz1Tb96pKReMsiTLEvfqg5y1`, код `849cfb6`, READY.
- [Независимая страница возврата](https://attendback-recovery.vercel.app): Vercel Hobby, devnet по умолчанию.
- Отдельный signer на Vercel Hobby: авторизованный health 200, без Bearer-токена 401; ключи booking/attester/payer изолированы от web и БД. Ключи deployer и upgrade authority не загружались в Vercel.
- Neon Free `neon-coquelicot-ridge`: с явного согласия пользователя применены 7 миграций одним атомарным SQL; проверены 17 таблиц, полный список миграций и trigger `immutable_policy`.
- Платные тарифы, домены и RPC не подключались. Квоты бесплатных сервисов остаются ограниченными.

## Программа

[Программа в Solana Explorer](https://explorer.solana.com/address/6CUM27mNoskjKnCsoywCQz4puZfhpXj5DJWEDZJuiwuV?cluster=devnet) · [транзакция deploy](https://explorer.solana.com/tx/2aqGBKvNvxpsbEjPqEzXnG7FrKNrSUbcALMmbUn9RajYm6PG63TD3uAuN7WQB7QMRXez2wfp6EnyR45QKym25xmg?cluster=devnet).

- Program ID: `6CUM27mNoskjKnCsoywCQz4puZfhpXj5DJWEDZJuiwuV`.
- ProgramData: `3dHhws1PLCuA6wGeg9cGE75ozmrvK8awYVqrLaaWFh1x`, слот `509101163`.
- Loader: `BPFLoaderUpgradeab1e11111111111111111111111`; executable подтверждён.
- Upgrade authority: `2hPC19aogQ7SVaCHzUrvdsrJ7iDnZL9SbemRdFw8gKJa`; программа остаётся обновляемой.
- 265152 байта; выгруженный из devnet SBF совпадает с локальным SHA-256 `21cf0effb8b753844870b052f76f15d05d003226bd1675990a26fa05465925fc`.
- На deployer поступило 10 devnet SOL. 0,2 тестового SOL выделено сервисному payer. Rent программы около 1,349 SOL; это не итоговая сумма вместе со всеми комиссиями.
- Первая загрузка через RPC достигла лимита повторной доставки. Публикация продолжена из того же буфера через транспорт валидаторов и успешно завершилась. Новый program ID или дополнительный буфер не создавались.

## Сквозная облачная проверка

Техническое событие явно помечено как автоматическая проверка и не представляет реальное мероприятие. Использованы отдельные сгенерированные локально кошельки организатора и гостя; их приватные ключи и сессионные cookies не публикуются.

1. Вход подписью сообщения через HTTPS API, создание организации и события в Neon.
2. [Публикация условий](https://explorer.solana.com/tx/2S7HXrY2jouoYm7jhp5WuvLFmJuMfNHJgwRKkBfeSURPaSYV2mQsW7jVT9XmgsafMiDSYpzXE2QDj4czVtg8PhLR?cluster=devnet) в devnet, версия транзакции v0, успешная симуляция.
3. [Залог 1 тестового USDC](https://explorer.solana.com/tx/3o5jugZCd3xgfcdFYeLGZ3qUWZwCtZXMgQg1BUswpsFJbb1rCLN5qhMdEDEZckQbNpdMVB68mgdg2MyWLQLtbqWP?cluster=devnet) с реальной подписью облачного booking signer. Баланс гостя: 2 → 1 USDC; билет Active.
4. Выпуск QR-токена от имени гостя, check-in от имени организатора; 30-секундное окно исправления.
5. Облачные Workflow, attester и payer выполнили [возврат](https://explorer.solana.com/tx/3BH1NYnYx6ryz59wLtWYc27YYSeujqRKdEse2Z4pj7mWdRjLvnH5Hy4PgrPdvzi9ucSrAdLHD4ABQaLuzUS6zyh2?cluster=devnet). Расчёт finalized в `2026-10-09T07:40:43.884Z`, слот `509106303`: refund 1 USDC, penalty 0. Баланс гостя вернулся к 2 USDC. Залог Settled, билет Active, ошибок сверки нет.

Отдельный локальный worker не участвовал. Проверка через API использовала настоящий контракт, SPL Token, Neon, подписи и очередь Vercel. Она не является тестом расширения кошелька или физической камеры. Тестовые USDC получены через [официальный кран Circle](https://faucet.circle.com/).

При первом тесте одна роль была одновременно гостем и получателем удержаний. Контракт правильно отказал. Исправлен API: теперь отказ PENALTY_RECIPIENT объясняет причину до занятия места. TypeScript и адресный интеграционный тест PostgreSQL/RPC прошли; тест подтверждает отсутствие брони после отказа и успешную оплату другим гостем. Исправление опубликовано в `849cfb6`.

Финальная проверка после публикации исправления: главная, health/config/events — HTTP 200; database=true, cluster=devnet; /api/me и Cron без авторизации — 401; неверный Origin — 403. Все четыре подписи (deploy, публикация, залог, возврат) повторно проверены через devnet RPC: finalized, err=null.

GitHub CI для опубликованного кода `849cfb6`: [success](https://github.com/ernur077sss-art/AttendBack/actions/runs/37900390698). Сборка программы, генерация клиента, проверки приложения, PostgreSQL/RPC и браузерные тесты завершились успешно.

## Осталось

- Обычный Wallet Standard кошелёк и камера физического телефона по HTTPS.
- Возврат через публичный recovery-клиент при недоступности основного API.
- Дополнительные devnet-сценарии неявок и споров; локальные проверки уже выполнены.
- Итоговое видео и заявка на хакатон. Публикация кода и сайта не означает отправку заявки.

[Машиночитаемые доказательства](release-manifest.json) · [прогресс по плану](progress.ru.md) · [эксплуатация бесплатного размещения](free-hosting.ru.md).

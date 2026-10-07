# Этап 2 — правила и интерфейсы

Политика сессии неизменна после публикации. On-chain Event хранит организатора и отмену; Policy — условия одной сессии; Commitment — один залог гостя; отдельный SPL vault — principal. PDA Commitment выводится из Policy и гостя, не закрывается после расчёта: повторная регистрация в той же политике не создаёт новый залог. Для следующего мероприятия создаётся новая сессия/политика. Ticket и Seat — серверные проекции, деньги — состояние программы.

| Действие              | Исполнитель               | Условие                                                                        | Итог                                        | Проверяемая ошибка                             |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------- |
| Создать событие       | организатор               | cancel_deadline в будущем                                                      | Event                                       | неверный срок                                  |
| Опубликовать правила  | организатор               | mint SPL, amount>0; порядок сроков; cancel_deadline ≤ dispute_deadline         | Policy                                      | подмена authority; повтор PDA                  |
| Внести залог          | гость + booking authority | до booking_close, permit не истёк, событие активно                             | Funded                                      | неверный mint/сумма/получатель/подпись; повтор |
| Ранняя отмена         | гость                     | Funded; now < free_cancel_until                                                | Refundable                                  | чужой гость; повтор                            |
| Поздняя отмена        | гость                     | Funded; now ≥ free_cancel_until                                                | Funded, late_cancel=true                    | последующий attest запрещён                    |
| Подтвердить посещение | attester                  | Funded/NoShowProposed; checkin_open ≤ now < dispute_deadline; не отменён билет | Refundable                                  | неверная роль; поздняя отмена                  |
| Предложить неявку     | attester                  | Funded; checkin_close ≤ now < proposal_cutoff                                  | NoShowProposed                              | слишком рано/поздно                            |
| Открыть спор          | гость                     | Funded/NoShowProposed; checkin_close ≤ now < dispute_deadline                  | Disputed                                    | повтор/чужой/поздний                           |
| Решить спор           | resolver                  | Disputed; now < resolution_deadline                                            | Refundable или Forfeitable                  | произвольная сумма/получатель невозможны       |
| Расчёт                | любой плательщик комиссии | Refundable; либо разрешённое удержание после dispute_deadline                  | Settled                                     | повтор/открытый спор                           |
| Отмена события        | организатор               | now < event.cancel_deadline                                                    | все оставшиеся залоги имеют полный возврат  | поздняя отмена                                 |
| Защитный возврат      | любой плательщик комиссии | now ≥ hard_refund_at                                                           | полный возврат любого незавершённого залога | до срока                                       |

В любой операции расчёта проверка отмены события и hard_refund_at имеет приоритет над удержанием. Уже Settled не переводится повторно. Полный возврат — principal. Penalty = floor(principal × bps / 10000), refund = principal − penalty; u128 для промежуточного произведения. Оба перевода атомарны. Посторонние пополнения vault не меняют principal; vault/tombstone не закрываются. Получатели проверяются через связанные mint/owner и ATA, не принимаются произвольно. Комиссии Solana и rent показываются отдельно от залога; сервис не удерживает долю неявок.

Подпись booking authority охватывает всю транзакцию: сессию, кошелёк, сумму, срок permit и blockhash. Сервер выдаёт её только удерживаемому месту. При истечении резерва с выданным permit место удерживается до доказанного истечения permit и blockhash и finalized отсутствия Commitment. Недоступный RPC сохраняет PaymentPending.

## HTTP-контракт

Все изменяющие запросы требуют same-origin, серверную сессию и проверку роли/владельца. JSON ограничен 64 KiB; evidence 2 MiB, текст/PNG/JPEG/PDF с проверкой содержимого, доступ владельцу и уполномоченному арбитру. Ошибки: 400 валидация, 401 нет входа, 403 нет роли, 404 недоступный объект, 409 конфликт состояния, 503 сеть временно недоступна. API не принимает клиентское `paid=true`.

- `/api/auth/challenge`, `/api/auth/verify`, `/api/auth/logout`, `/api/me`: Wallet Standard signMessage, случайный nonce, домен, expiry, одноразовый challenge, HttpOnly SameSite session.
- `/api/events`, `/api/events/:id`, `/api/organizations`, `/api/members`: публичные события; изменения только организация.
- `/api/sessions/:id/register`, `/api/registrations/:id/transaction`: reserve/waitlist; сервер создаёт разрешённую транзакцию; гость подписывает.
- `/api/registrations/:id`, `/api/registrations/:id/ticket`, `/api/registrations/:id/sync`: состояние и обновляемый QR; доказательства оплаты из finalized RPC.
- `/api/checkins`, `/api/checkins/:id/correct`: staff выбранного события; уникальный check-in, окно исправления 30 секунд, freeze перед on-chain.
- `/api/disputes`, `/api/disputes/:id/evidence`, `/api/disputes/:id/resolve`: владелец/назначенный resolver, приватные материалы.
- `/api/ledger`, `/api/jobs`: scoped реестр и ошибки обработки.

Места: Waitlisted → Offered/Reserved → PaymentPending → Active → Released. Таймер интерфейса не освобождает PaymentPending. После подтверждённой отмены место получает первый доступный участник очереди; предложение живёт 10 минут и не списывает деньги.

## Доверие и эксплуатация

Attester подтверждает физическое присутствие; блокчейн его не доказывает. Resolver решает спор; upgrade authority может менять программу — этот риск отображается в условиях. Сервисные ключи отдельны от кошельков гостей; signer-интерфейс допускает KMS/удалённый сервис. Локальные тестовые ключи не используются в devnet/production. Основной backend не нужен для permissionless возврата через резервный клиент и RPC.

Frontend: список событий → условия → подпись → отправлено → finalized → QR. Кабинеты организатора, staff, resolver используют один API с разными полномочиями. Об успешном возврате сообщаем только после finalized состояния, отдельно от доставки уведомления.

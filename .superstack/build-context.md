# AttendBack — контекст реализации

Стек: Next.js 16.4 / React 19.3 / Kit 8.4 / Anchor 1.2.1 / PostgreSQL 18.4.
Программа и интеграции проверяются локально на LiteSVM и Surfpool. Полный статус: docs/progress.ru.md.

```json
{
  "review": {
    "security_score": "B",
    "quality_score": "B",
    "ready_for_mainnet": false,
    "findings": [
      {
        "severity": "high",
        "category": "reconciliation",
        "description": "Unpaid permits could starve funded deposits; one expiration RPC failure aborted unrelated worker jobs",
        "fix": "Rotate bounded batches, exclude released unfunded rows, require confirmed deposits for payouts, isolate per-registration expiration errors"
      },
      {
        "severity": "medium",
        "category": "receipts",
        "description": "Batched settlements lost a receipt; remaining accounts could falsely identify a settlement transaction",
        "fix": "Ledger unique by registration, notification per receipt, verify commitment account position and store the transaction slot; real RPC and DB rollback regressions"
      },
      {
        "severity": "medium",
        "category": "auditability",
        "description": "Check-in kept only the latest actor and state",
        "fix": "Transactional author/revision history for new confirmations and corrections, scoped organizer/staff UI"
      },
      {
        "severity": "medium",
        "category": "testing",
        "description": "Per-file teardown closed a database pool reused by the full Playwright suite",
        "fix": "Shared worker-scoped database lifetime; verify all seven browser cases together"
      },
      {
        "severity": "high",
        "category": "correctness",
        "description": "Finalized projection could be lost after transient RPC error",
        "fix": "Mark intent finalized only after projection; regression test added"
      },
      {
        "severity": "medium",
        "category": "correctness",
        "description": "Corrected check-in could not be scanned again",
        "fix": "Versioned new check-in and uniquely keyed attestation job"
      },
      {
        "severity": "medium",
        "category": "ux",
        "description": "Device clock could expose disputes prematurely",
        "fix": "Use finalized Solana clock for monetary action windows"
      },
      {
        "severity": "medium",
        "category": "ux",
        "description": "Event booking button still used device time and could disable a valid reservation",
        "fix": "Use Solana clock on the event page; browser regression covers device drift, RPC failure and recovery"
      },
      {
        "severity": "high",
        "category": "dependencies",
        "description": "Production audit reported eight advisories in Workflow transitive dependencies",
        "fix": "Pin nanoid 5.1.16 and devalue 5.9.3 using scoped overrides; production audit returns zero advisories"
      },
      {
        "severity": "medium",
        "category": "product",
        "description": "Landing lacked the planned sample policy and demo entry",
        "fix": "Add bilingual landing explanation and clearly labeled transaction-free educational demo; verify keyboard, locale, error recovery and mobile layouts"
      }
    ],
    "last_reviewed": "2026-10-09"
  }
}
```

Оценки относятся к внутреннему ревью devnet-прототипа, не к независимому аудиту. Mainnet не готов.

Актуально на 9 октября: web/API, изолированный signer, отдельный recovery и Workflow размещены на Vercel Hobby; 7 миграций применены в Neon Free. Программа опубликована в devnet; облачный возврат 1 test USDC ранее подтверждён через API-клиент со сгенерированными ключами. Подробности: docs/release-manifest.json.

Остаются обычный кошелёк, физическая камера по HTTPS, публичный recovery с транзакцией и дополнительные публичные споры/неявки. Ограничение запросов signer в памяти процесса не является глобальным distributed rate limit. Сотрудник подтверждает посещение, backend распределяет места, resolver решает спор, upgrade authority управляет обновлениями. Финальные видео и подача заявки не подтверждены. Текущая сверка: docs/plan-audit-2026-10-09.ru.md.

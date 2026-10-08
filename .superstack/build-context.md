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
      }
    ]
  }
}
```

Оценки относятся к внутреннему ревью прототипа, не к независимому аудиту. Внешний запуск требует devnet-ролей, размещения signer-сервиса, хостинга и проверки с пользовательским кошельком.

Этап 9: реализован изолированный devnet signer; 13 проверок канонического сообщения, аккаунтов, ролей, комиссии, симуляции, подписи и HTTP. Общий прогон — 30 тестов. Секреты и TLS ещё не размещены. Ограничение запросов находится в памяти процесса; фактическое посещение и распределение мест остаются доверием к backend. Защищённый mount ключей и независимое размещение recovery проверяются на выбранном хосте.

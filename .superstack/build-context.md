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

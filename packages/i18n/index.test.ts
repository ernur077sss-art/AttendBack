import { describe, expect, it } from 'vitest';
import english from './en.json';
import {
  formatDate,
  languageUrl,
  resolveLocale,
  translate,
  translateMessage,
} from './index';

describe('interface language', () => {
  it('honors a valid shared language link before the saved preference', () => {
    expect(resolveLocale('?lang=en', 'ru')).toBe('en');
    expect(resolveLocale('?lang=ru', 'en')).toBe('ru');
    expect(resolveLocale('?lang=de', 'en')).toBe('en');
    expect(resolveLocale('', null)).toBe('ru');
    expect(resolveLocale('', 'invalid')).toBe('ru');
  });
  it('carries the language to recovery without losing the path, query or fragment', () => {
    expect(
      languageUrl('https://example.com/refund?deposit=abc#terms', 'en'),
    ).toBe('https://example.com/refund?deposit=abc&lang=en#terms');
  });
  it('keeps all amounts and wallet values literal, including placeholder-like input', () => {
    expect(
      translate('en', 'Вернуть {0} тестовых USDC в сети {1} на кошелёк:', [
        '0.000001',
        'devnet',
      ]),
    ).toBe('Refund 0.000001 test USDC on devnet to this wallet:');
    expect(translate('en', 'Арбитр: {0}', ['wallet{1}'])).toBe(
      'Dispute resolver: wallet{1}',
    );
    expect(translate('ru', '{0} тестовых USDC', [0])).toBe('0 тестовых USDC');
  });
  it('keeps the same interpolation fields in both languages', () => {
    for (const [ru, en] of Object.entries(english)) {
      expect(en, ru).not.toMatch(/[А-Яа-яЁё]/);
      expect(en.match(/\{\d+\}/g)?.sort() ?? [], ru).toEqual(
        ru.match(/\{\d+\}/g)?.sort() ?? [],
      );
    }
  });
  it('translates stored notifications and errors without changing onchain facts', () => {
    expect(
      translateMessage(
        'en',
        'Расчёт подтверждён: возвращено 1.5 USDC, удержано 0.5 USDC.',
      ),
    ).toBe('Settlement confirmed: 1.5 USDC refunded, 0.5 USDC withheld.');
    expect(translateMessage('en', 'Операция истекла: BLOCKHASH_EXPIRED')).toBe(
      'Transaction expired: BLOCKHASH_EXPIRED',
    );
    expect(
      translateMessage('en', 'Проверьте поля формы: session.title: Too small'),
    ).toBe('Check the form fields: session.title: Too small');
    expect(translateMessage('ru', 'Недостаточно прав')).toBe(
      'Недостаточно прав',
    );
    expect(translateMessage('en', 'RPC_CUSTOM_ERROR')).toBe('RPC_CUSTOM_ERROR');
  });
  it('formats month names in the selected language', () => {
    expect(formatDate('en', '2026-10-09T12:00:00Z')).toContain('Oct');
    expect(formatDate('ru', '2026-10-09T12:00:00Z')).toContain('окт');
  });
});

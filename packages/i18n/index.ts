import english from './en.json';

export type Locale = 'ru' | 'en';
export const languageKey = 'attendback-language';
export const intlLocale = (locale: Locale) =>
  locale === 'en' ? 'en-US' : 'ru-RU';
export const isLocale = (value: unknown): value is Locale =>
  value === 'ru' || value === 'en';
export function resolveLocale(search: string, saved: string | null): Locale {
  const requested = new URLSearchParams(search).get('lang');
  return isLocale(requested) ? requested : isLocale(saved) ? saved : 'ru';
}
export function languageUrl(url: string, locale: Locale): string {
  const parsed = new URL(url);
  parsed.searchParams.set('lang', locale);
  return parsed.toString();
}
type Value = string | number | bigint | null | undefined;
const translations: Record<string, string> = english;
export function translate(
  locale: Locale,
  key: string,
  values: readonly Value[] = [],
): string {
  const text = locale === 'en' ? (translations[key] ?? key) : key;
  return text.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : match,
  );
}
// Only app-owned status/error text goes through this function. Event content is never translated.
export function translateMessage(locale: Locale, message: string): string {
  if (locale === 'ru') return message;
  if (translations[message]) return translations[message];
  const settlement =
    /^Расчёт подтверждён: возвращено (.+) USDC, удержано (.+) USDC\.$/.exec(
      message,
    );
  if (settlement)
    return `Settlement confirmed: ${settlement[1]} USDC refunded, ${settlement[2]} USDC withheld.`;
  const proposal =
    /^Посещение не подтверждено\. Можно открыть спор до (.+)\.$/.exec(message);
  if (proposal)
    return `Attendance is unconfirmed. You can open a dispute until ${formatDate(locale, proposal[1])}.`;
  const operation = /^Операция (истекла|отклонена): (.+)$/.exec(message);
  if (operation)
    return `Transaction ${operation[1] === 'истекла' ? 'expired' : 'rejected'}: ${translateMessage(locale, operation[2])}`;
  const confirmation =
    /^(Возврат подтверждён \(finalized\)|Подтверждение ещё не получено): (.+)$/.exec(
      message,
    );
  if (confirmation)
    return `${confirmation[1].startsWith('Возврат') ? 'Refund finalized' : 'Awaiting confirmation'}: ${confirmation[2]}`;
  // Validation errors may append field paths and details to an app error.
  for (const [ru, en] of Object.entries(translations)) {
    if (message.startsWith(`${ru}: `))
      return `${en}: ${message.slice(ru.length + 2)}`;
  }
  return message;
}
export function formatDate(locale: Locale, value: string | number): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof value === 'number' ? value * 1000 : new Date(value));
}

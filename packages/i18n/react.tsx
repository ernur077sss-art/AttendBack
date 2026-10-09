'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  formatDate,
  isLocale,
  languageKey,
  languageUrl,
  resolveLocale,
  translate,
  translateMessage,
  type Locale,
} from './index';

type LanguageContext = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (
    key: string,
    values?: readonly (string | number | bigint | null | undefined)[],
  ) => string;
  message: (text: string) => string;
  date: (value: string | number) => string;
};
const Context = createContext<LanguageContext | null>(null);
function persist(locale: Locale) {
  try {
    localStorage.setItem(languageKey, locale);
  } catch {
    /* Storage may be disabled. */
  }
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('ru');
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(languageKey);
    } catch {
      /* Use URL or default. */
    }
    const initial = resolveLocale(window.location.search, saved);
    updateLocale(initial);
    persist(initial);
    const onPopState = () => {
      const requested = new URLSearchParams(window.location.search).get('lang');
      if (isLocale(requested)) {
        updateLocale(requested);
        persist(requested);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    persist(next);
    // Update the shareable URL without navigation, remounting forms or reconnecting wallets.
    window.history.replaceState(
      window.history.state,
      '',
      languageUrl(window.location.href, next),
    );
  }, []);
  const t = useCallback(
    (
      key: string,
      values?: readonly (string | number | bigint | null | undefined)[],
    ) => translate(locale, key, values),
    [locale],
  );
  const message = useCallback(
    (text: string) => translateMessage(locale, text),
    [locale],
  );
  const date = useCallback(
    (value: string | number) => formatDate(locale, value),
    [locale],
  );
  const value = useMemo(
    () => ({ locale, setLocale, t, message, date }),
    [locale, setLocale, t, message, date],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing LanguageProvider');
  return context;
}
export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div
      className="language-switcher"
      role="group"
      aria-label="Язык / Language"
    >
      <button
        type="button"
        lang="ru"
        aria-label="Русский"
        aria-pressed={locale === 'ru'}
        onClick={() => setLocale('ru')}
      >
        RU
      </button>
      <button
        type="button"
        lang="en"
        aria-label="English"
        aria-pressed={locale === 'en'}
        onClick={() => setLocale('en')}
      >
        EN
      </button>
    </div>
  );
}

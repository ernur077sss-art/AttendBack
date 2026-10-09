'use client';
import { useI18n, LanguageSwitcher } from '../../../packages/i18n/react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, RotateCcw, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from './providers';
import { Button } from './ui/button';
import { languageUrl } from '../../../packages/i18n';
import { short } from '../lib/api';
export function Shell({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();

  const app = useApp(),
    path = usePathname();
  const recoveryUrl =
    process.env.NEXT_PUBLIC_RECOVERY_URL ||
    (app.config.cluster === 'localnet' ? 'http://127.0.0.1:4173' : null);
  return (
    <>
      <a className="sr-only focus:not-sr-only" href="#main">
        {t('К содержимому')}
      </a>
      <div className="border-b bg-muted text-center text-xs py-2 px-4">
        {t('Тестовая сеть {0} · Тестовые USDC не имеют денежной стоимости', [
          app.config.cluster,
        ])}
      </div>
      <header className="border-b bg-card">
        <div className="shell flex min-h-20 flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <RotateCcw aria-hidden="true" size={24} />
            AttendBack
            <span className="text-xs text-muted-foreground font-normal">
              beta
            </span>
          </Link>
          <nav
            aria-label={t('Основная навигация')}
            className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1"
          >
            {[
              ['/', 'События'],
              ['/tickets', 'Мои билеты'],
              ['/organizer', 'Организатор'],
              ['/checkin', 'Вход'],
              ['/disputes', 'Споры'],
              ['/ledger', 'Реестр'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-2.5 text-sm ${path === href ? 'bg-muted font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t(label)}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher />
          <Button
            className="ml-auto sm:ml-0"
            variant="outline"
            onClick={app.login}
          >
            <Wallet size={16} aria-hidden="true" />
            {app.me ? short(app.me.wallet) : t('Войти')}
          </Button>
        </div>
      </header>
      <main id="main" className="shell">
        {children}
      </main>
      <footer className="border-t">
        <div className="shell flex flex-wrap justify-between gap-4 py-6 text-xs text-muted-foreground">
          <span>
            {t('AttendBack · Место забронировано. Условия зафиксированы.')}
          </span>
          {recoveryUrl && (
            <a
              className="flex gap-1 underline underline-offset-4"
              href={languageUrl(recoveryUrl, locale)}
              target="_blank"
              rel="noreferrer"
            >
              {t('Резервный возврат ')}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      </footer>
    </>
  );
}

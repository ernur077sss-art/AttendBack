import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '../components/providers';
import { Shell } from '../components/shell';
export const metadata = {
  title: 'AttendBack',
  description: 'Планируйте явку. Возвращайте доверие.',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}

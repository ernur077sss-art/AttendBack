import type {
  Policy,
  DepositState,
  SeatState,
  Role,
} from '../../../packages/domain/src';
export type Config = {
  cluster: 'localnet' | 'devnet';
  program: string;
  mint: string;
  bookingAuthority: string;
  attester: string;
};
export type Session = {
  id: string;
  title: string;
  policy: Policy;
  published: boolean;
  capacity: number;
  terms_hash: string;
  policy_address?: string;
};
export type Event = {
  id: string;
  title: string;
  description: string;
  location: string;
  organization: string;
  org_id: string;
  cancelled: boolean;
  sessions: Session[];
  policy: Policy;
  session_id: string;
  occupied: number;
  capacity: number;
  published: boolean;
};
export type Registration = {
  id: string;
  title: string;
  wallet: string;
  session_id: string;
  event_id: string;
  location: string;
  policy: Policy;
  seat_state: SeatState;
  deposit_state: DepositState | null;
  deposit_address: string | null;
  reserved_until: string | null;
  refund_amount: string | null;
  penalty_amount: string | null;
  chain_slot: string | null;
  late_cancel: boolean;
  cancelled: boolean;
  dispute_description?: string;
  decision?: string;
  checkin_frozen?: boolean;
  checkin_corrected?: boolean;
};
export type Dashboard = {
  wallet: string;
  organizations: { id: string; name: string; role: Role }[];
  events: Event[];
  registrations: Registration[];
  notifications: { id: string; message: string; created_at: string }[];
};
export type Prepared = {
  id: string;
  transaction: string;
  simulation: unknown;
  summary: {
    action: string;
    cluster: string;
    program: string;
    mint: string;
    principal: string;
    guest: string;
    penaltyRecipient: string;
    penaltyBps: number;
    feePayer: string;
    fees: string;
  };
};
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.message +
        (value.issues
          ? ': ' +
            value.issues
              .map(
                (i: { path: string; message: string }) =>
                  `${i.path}: ${i.message}`,
              )
              .join('; ')
          : ''),
    );
  return value;
}
export const from64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const to64 = (b: Uint8Array | readonly number[]) =>
  btoa(Array.from(b, (c) => String.fromCharCode(c)).join(''));
export const short = (s: string) =>
  s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
export const date = (s: number | string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(typeof s === 'number' ? s * 1000 : s));
export const statuses: Record<string, string> = {
  Waitlisted: 'В листе ожидания',
  Offered: 'Место предложено',
  Reserved: 'Место зарезервировано',
  PaymentPending: 'Проверяем оплату',
  Active: 'Билет активен',
  Released: 'Место освобождено',
  Funded: 'Залог внесён',
  Refundable: 'Доступен возврат',
  NoShowProposed: 'Предложена неявка',
  Disputed: 'Спор открыт',
  Forfeitable: 'Решено удержать',
  Settled: 'Расчёт завершён',
};

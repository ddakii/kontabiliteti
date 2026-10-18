export function formatDate(value?: string | null) {
  if (!value) return '—';
  const iso = value.slice(0, 10);
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

export function formatMoney(value?: string | number | null, currency = 'EUR') {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat('sq-AL', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

export function todayInput() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

export const statusLabel: Record<string, string> = {
  DRAFT: 'Draft',
  ISSUED: 'E lëshuar',
  PARTIALLY_PAID: 'Pjesërisht e paguar',
  PAID: 'E paguar',
  OVERDUE: 'Me afat të kaluar',
  CANCELLED: 'E anuluar',
  IN_REVIEW: 'Në shqyrtim',
  POSTED: 'E postuar',
  ACTIVE: 'Aktiv',
  PENDING: 'Në pritje',
  SUSPENDED: 'I pezulluar',
  ARCHIVED: 'I arkivuar',
  NEW: 'E re',
  IN_PROGRESS: 'Në proces',
  WAITING_DOCUMENTS: 'Në pritje të dokumenteve',
  COMPLETED: 'E përfunduar',
  TRIAL: 'Provë',
  GRACE: 'Periudhë faljeje',
  EXPIRED: 'E skaduar',
  INTERNAL_DRAFT: 'Draft i brendshëm',
  REVIEWED_BY_ACCOUNTANT: 'E shqyrtuar nga kontabilisti',
  MARKED_EXTERNALLY_SUBMITTED: 'E shënuar si e dorëzuar jashtë',
  RECEIVED: 'I pranuar',
  REVIEWED: 'I shqyrtuar',
  APPROVED: 'I aprovuar',
  REJECTED: 'I refuzuar',
  FISCALIZED: 'I fiskalizuar',
  READY: 'Gati për dërgim',
  PROCESSING: 'Duke u dërguar',
  UNKNOWN: 'Rezultat i panjohur',
  NOT_SENT: 'Nuk u dërgua',
  SALE: 'Shitje',
  CANCEL: 'Anulim',
  RETURN: 'Kthim',
  NEEDS_CLARIFICATION: 'Kërkon sqarim',
  PROCESSED: 'I procesuar',
  OPEN: 'E hapur',
  DONE: 'E përfunduar',
  NOT_APPLICABLE: 'Nuk zbatohet',
  NOT_DUE: 'Pa kaluar afati',
  UNMATCHED: 'I papërputhur',
  MATCHED: 'I përputhur',
};

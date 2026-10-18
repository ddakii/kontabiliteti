import { config } from '../config';

export function todayISO(timeZone = config.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function asDate(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('Data duhet të jetë në formatin VVVV-MM-DD.');
  }
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = asDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: dateOnly(start), end: dateOnly(end) };
}

export function fiscalYearContaining(isoDate: string, startMonth: number): { year: number; start: string; end: string } {
  const [yearText, monthText] = isoDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const fiscalYear = month >= startMonth ? year : year - 1;
  const start = new Date(Date.UTC(fiscalYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(fiscalYear + 1, startMonth - 1, 0));
  return { year: fiscalYear, start: dateOnly(start), end: dateOnly(end) };
}

export function displayDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

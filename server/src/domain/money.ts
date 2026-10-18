import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value;

export function d(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Shuma nuk është e vlefshme.');
    return new Decimal(value.toString());
  }
  const text = String(value).trim().replace(',', '.');
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error('Shuma nuk është e vlefshme.');
  }
  return new Decimal(text);
}

/** Rrumbullakosje gjysmë-lart në 2 dhjetore, për euro. */
export function money(value: MoneyInput): Decimal {
  return d(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function rate(value: MoneyInput): Decimal {
  return d(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function fxRate(value: MoneyInput): Decimal {
  return d(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, value) => acc.plus(money(value)), new Decimal(0));
}

export function moneyString(value: MoneyInput): string {
  return money(value).toFixed(2);
}

export function isZero(value: MoneyInput): boolean {
  return money(value).isZero();
}

export function cmp(a: MoneyInput, b: MoneyInput): number {
  return money(a).comparedTo(money(b));
}

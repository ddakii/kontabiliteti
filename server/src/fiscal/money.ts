import Decimal from 'decimal.js';
import { d, money } from '../domain/money';

/** Çmimi i artikullit në njësi €0.0001, si në shënimin e protokollit publik. */
export function eurosToPriceUnits(value: Decimal.Value): number {
  const units = d(value).mul(10000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (!units.isInteger() || units.lt(0) || !units.lte(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Çmimi nuk u shndërrua në njësi €0.0001.');
  }
  return units.toNumber();
}

/** Totalet e kuponit në centë (€0.01). */
export function eurosToCents(value: Decimal.Value): number {
  const cents = money(value).mul(100);
  if (!cents.isInteger() || cents.lt(0) || !cents.lte(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Shuma nuk u shndërrua në centë.');
  }
  return cents.toNumber();
}

/**
 * Çmimi njësi bruto në €0.0001, i rikontrolluar që sasia × çmimi të kthejë totalin në centë.
 * Nuk përdor numra me presje lundruese.
 */
export function grossUnitPriceUnits(lineTotal: Decimal.Value, quantity: Decimal.Value): number {
  const qty = d(quantity);
  if (qty.lte(0)) throw new Error('Sasia duhet të jetë më e madhe se zero.');
  const units = d(lineTotal).div(qty).mul(10000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const reconstructed = units.mul(qty).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const expected = new Decimal(eurosToCents(lineTotal));
  if (!reconstructed.eq(expected)) {
    throw new Error('Çmimi njësi i kuponit nuk përputhet me totalin e rreshtit pas rrumbullakimit. Rregulloni sasinë ose çmimin.');
  }
  if (!units.lte(Number.MAX_SAFE_INTEGER)) throw new Error('Çmimi njësi është shumë i madh.');
  return units.toNumber();
}

export function assertUint(value: string, label: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} duhet të jetë numër i plotë pozitiv.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${label} është shumë i madh për kërkesën JSON të ATK-së.`);
  }
  return number;
}

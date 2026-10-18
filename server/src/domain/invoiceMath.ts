import Decimal from 'decimal.js';
import { d, money, moneyString, sumMoney } from './money';

export type TaxTreatment = 'STANDARD' | 'REDUCED' | 'ZERO' | 'EXEMPT' | 'OUT_OF_SCOPE';

export type LineDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  vatPercent?: string;
  treatment?: TaxTreatment;
};

export type CalculatedLine = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  vatPercent: string;
  treatment: TaxTreatment;
  gross: string;
  discount: string;
  net: string;
  taxableBase: string;
  vat: string;
  lineTotal: string;
};

const TAXABLE = new Set<TaxTreatment>(['STANDARD', 'REDUCED', 'ZERO']);

/**
 * Politika e rrumbullakjes: çdo rresht rrumbullakohet veç e veç
 * (gjysmë-lart, 2 dhjetore). Totali i faturës është shuma e rreshtave,
 * jo rrumbullakimi i një formule të vetme.
 */
export function calculateLine(line: LineDraft): CalculatedLine {
  const treatment = line.treatment ?? 'STANDARD';
  const quantity = d(line.quantity);
  const unitPrice = d(line.unitPrice);
  const discountPercent = d(line.discountPercent ?? '0');
  const vatPercent = d(line.vatPercent ?? '0');

  if (quantity.lte(0)) throw new Error('Sasia duhet të jetë më e madhe se zero.');
  if (unitPrice.lt(0)) throw new Error('Çmimi nuk mund të jetë negativ.');
  if (discountPercent.lt(0) || discountPercent.gt(100)) {
    throw new Error('Zbritja duhet të jetë nga 0 deri në 100.');
  }
  if (vatPercent.lt(0) || vatPercent.gt(100)) {
    throw new Error('Norma e TVSH-së nuk është e vlefshme.');
  }
  if ((treatment === 'EXEMPT' || treatment === 'OUT_OF_SCOPE' || treatment === 'ZERO') && vatPercent.gt(0)) {
    throw new Error('Ky trajtim tatimor nuk lejon TVSH më të madhe se zero.');
  }
  if (!line.description.trim()) throw new Error('Përshkrimi i rreshtit është i detyrueshëm.');

  const grossExact = quantity.mul(unitPrice);
  const discountExact = grossExact.mul(discountPercent).div(100);
  const net = money(grossExact.minus(discountExact));
  const taxable = TAXABLE.has(treatment);
  const vat = taxable ? money(net.mul(vatPercent).div(100)) : money(0);
  const lineTotal = money(net.plus(vat));

  return {
    description: line.description.trim(),
    quantity: quantity.toFixed(4),
    unitPrice: unitPrice.toFixed(4),
    discountPercent: discountPercent.toFixed(4),
    vatPercent: vatPercent.toFixed(4),
    treatment,
    gross: money(grossExact).toFixed(2),
    discount: money(discountExact).toFixed(2),
    net: net.toFixed(2),
    taxableBase: taxable ? net.toFixed(2) : '0.00',
    vat: vat.toFixed(2),
    lineTotal: lineTotal.toFixed(2),
  };
}

export function calculateDocument(lines: LineDraft[]) {
  if (lines.length === 0) throw new Error('Dokumenti duhet të ketë të paktën një rresht.');
  const calculated = lines.map(calculateLine);
  const subtotal = sumMoney(calculated.map((line) => line.gross));
  const discountTotal = sumMoney(calculated.map((line) => line.discount));
  const taxableBase = sumMoney(calculated.map((line) => line.taxableBase));
  const vatTotal = sumMoney(calculated.map((line) => line.vat));
  const total = sumMoney(calculated.map((line) => line.lineTotal));
  return {
    lines: calculated,
    subtotal: subtotal.toFixed(2),
    discountTotal: discountTotal.toFixed(2),
    taxableBase: taxableBase.toFixed(2),
    vatTotal: vatTotal.toFixed(2),
    total: total.toFixed(2),
  };
}

/** Konvertimi i kokës së dokumentit. Neto është diferenca që e mban baraspeshën. */
export function toBaseCurrency(total: string, vatTotal: string, exchangeRate: string) {
  const rateValue = d(exchangeRate);
  if (rateValue.lte(0)) throw new Error('Kursi i këmbimit duhet të jetë pozitiv.');
  const baseTotal = money(d(total).mul(rateValue));
  const baseVat = money(d(vatTotal).mul(rateValue));
  const baseNet = money(baseTotal.minus(baseVat));
  if (baseNet.lt(0)) throw new Error('TVSH-ja e konvertuar e kalon totalin.');
  return {
    total: baseTotal.toFixed(2),
    vat: baseVat.toFixed(2),
    net: baseNet.toFixed(2),
  };
}

export function amountDue(total: string, paid: string, credited = '0'): string {
  const due = money(d(total).minus(d(paid)).minus(d(credited)));
  if (due.lt(0)) return '0.00';
  return due.toFixed(2);
}

export function isPositive(value: string): boolean {
  return d(value).gt(0);
}

export function decimalEquals(a: string, b: string): boolean {
  return money(a).eq(money(b));
}

export function assertNonNegativeMoney(value: string, label: string): Decimal {
  const parsed = money(value);
  if (parsed.lt(0)) throw new Error(`${label} nuk mund të jetë negativ.`);
  return parsed;
}

export { moneyString };

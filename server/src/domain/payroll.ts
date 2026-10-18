import Decimal from 'decimal.js';
import { d, money } from './money';

export type TaxBracket = {
  upTo: string | null;
  ratePercent: string;
};

export type PayrollInput = {
  gross: string;
  pensionEmployeePercent: string;
  pensionEmployerPercent: string;
  taxBase: 'GROSS' | 'GROSS_MINUS_EMPLOYEE_PENSION';
  brackets: TaxBracket[];
};

export type PayrollResult = {
  gross: string;
  pensionEmployee: string;
  pensionEmployer: string;
  taxableBase: string;
  tax: string;
  net: string;
  bands: { from: string; to: string; ratePercent: string; tax: string }[];
};

/**
 * Motori i pagës zbaton rregullat e ruajtura. Nuk i trajton normat si ligj
 * të verifikuar. Thirrësi duhet të përdorë vetëm një set të konfirmuar nga kontabilisti.
 */
export function calculatePayroll(input: PayrollInput): PayrollResult {
  const gross = money(input.gross);
  if (gross.lt(0)) throw new Error('Paga bruto nuk mund të jetë negative.');
  const employeeRate = d(input.pensionEmployeePercent);
  const employerRate = d(input.pensionEmployerPercent);
  if (employeeRate.lt(0) || employerRate.lt(0) || employeeRate.gt(100) || employerRate.gt(100)) {
    throw new Error('Norma e pensionit nuk është e vlefshme.');
  }
  if (input.brackets.length === 0) {
    throw new Error('Mungojnë shkallët e tatimit në pagë.');
  }

  const pensionEmployee = money(gross.mul(employeeRate).div(100));
  const pensionEmployer = money(gross.mul(employerRate).div(100));
  const taxableBase =
    input.taxBase === 'GROSS' ? gross : money(gross.minus(pensionEmployee));

  const { tax, bands } = progressiveTax(taxableBase, input.brackets);
  const net = money(gross.minus(pensionEmployee).minus(tax));
  if (net.lt(0)) throw new Error('Paga neto doli negative. Kontrolloni rregullat.');

  return {
    gross: gross.toFixed(2),
    pensionEmployee: pensionEmployee.toFixed(2),
    pensionEmployer: pensionEmployer.toFixed(2),
    taxableBase: taxableBase.toFixed(2),
    tax: tax.toFixed(2),
    net: net.toFixed(2),
    bands,
  };
}

export function progressiveTax(baseInput: Decimal | string, brackets: TaxBracket[]) {
  const base = money(baseInput);
  const ordered = [...brackets].sort((a, b) => {
    if (a.upTo === null) return 1;
    if (b.upTo === null) return -1;
    return d(a.upTo).comparedTo(d(b.upTo));
  });

  let floor = new Decimal(0);
  let tax = new Decimal(0);
  const bands: PayrollResult['bands'] = [];
  let sawOpenEnded = false;

  for (const bracket of ordered) {
    const ratePercent = d(bracket.ratePercent);
    if (ratePercent.lt(0) || ratePercent.gt(100)) {
      throw new Error('Shkalla tatimore nuk është e vlefshme.');
    }
    if (bracket.upTo === null) {
      if (sawOpenEnded) throw new Error('Lejohet vetëm një shkallë e hapur.');
      sawOpenEnded = true;
    }
    const cap = bracket.upTo === null ? null : money(bracket.upTo);
    if (cap && cap.lt(floor)) throw new Error('Shkallët tatimore nuk janë në rend.');
    const top = cap === null ? base : Decimal.min(base, cap);
    const slice = money(top.minus(floor));
    const bandTax = slice.gt(0) ? money(slice.mul(ratePercent).div(100)) : money(0);
    if (slice.gt(0)) {
      bands.push({
        from: floor.toFixed(2),
        to: top.toFixed(2),
        ratePercent: ratePercent.toFixed(4),
        tax: bandTax.toFixed(2),
      });
      tax = tax.plus(bandTax);
    }
    if (cap === null || base.lte(cap)) break;
    floor = cap;
  }

  if (ordered.length > 0) {
    const last = ordered[ordered.length - 1];
    if (last.upTo !== null && base.gt(d(last.upTo))) {
      throw new Error('Shkallët tatimore nuk e mbulojnë të gjithë bazën.');
    }
  }

  return { tax: money(tax), bands };
}

export function straightLineDepreciation(input: {
  cost: string;
  residual: string;
  usefulLifeMonths: number;
}): string {
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths <= 0) {
    throw new Error('Jetëgjatësia duhet të jetë në muaj të plotë.');
  }
  const depreciable = money(d(input.cost).minus(d(input.residual)));
  if (depreciable.lt(0)) throw new Error('Vlera e mbetur e kalon koston.');
  return money(depreciable.div(input.usefulLifeMonths)).toFixed(2);
}

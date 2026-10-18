import { d } from '../domain/money';

/**
 * Shkronjat e shembullit publik ATK. Nuk janë opinion ligjor.
 * A = e përjashtuar, C = 0%, D = 8%, E = 18%.
 */
export function fiscalTaxLetter(treatment: string, vatPercent: string): 'A' | 'C' | 'D' | 'E' {
  const vat = d(vatPercent);
  if (treatment === 'EXEMPT' || treatment === 'OUT_OF_SCOPE') {
    if (vat.gt(0)) throw new Error('Trajtimi i përjashtuar nuk lejon TVSH më të madhe se zero.');
    return 'A';
  }
  if (vat.eq(0)) return 'C';
  if (vat.eq(8)) return 'D';
  if (vat.eq(18)) return 'E';
  throw new Error(
    `Norma ${vat.toString()}% nuk ka shkronjë në shembullin publik të ATK-së (A, C, D, E). Kuponi nuk dërgohet me një shkronjë të shpikur.`,
  );
}

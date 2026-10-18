import { d, money } from './money';

export type JournalLineInput = {
  accountId: string;
  debit: string;
  credit: string;
  description?: string;
};

export function assertBalanced(lines: JournalLineInput[]): { debit: string; credit: string } {
  if (lines.length < 2) {
    throw new Error('Regjistrimi duhet të ketë të paktën dy rreshta.');
  }
  let debit = money(0);
  let credit = money(0);
  for (const line of lines) {
    const lineDebit = money(line.debit || '0');
    const lineCredit = money(line.credit || '0');
    if (lineDebit.lt(0) || lineCredit.lt(0)) {
      throw new Error('Debit dhe krediti nuk mund të jenë negativë.');
    }
    if (lineDebit.gt(0) && lineCredit.gt(0)) {
      throw new Error('Rreshti nuk mund të ketë edhe debit edhe kredit.');
    }
    if (lineDebit.eq(0) && lineCredit.eq(0)) {
      throw new Error('Rreshti i regjistrimit është bosh.');
    }
    if (!line.accountId) throw new Error('Llogaria e rreshtit mungon.');
    debit = debit.plus(lineDebit);
    credit = credit.plus(lineCredit);
  }
  const debitTotal = money(debit);
  const creditTotal = money(credit);
  if (!debitTotal.eq(creditTotal)) {
    throw new Error(
      `Regjistrimi nuk është i baraspeshuar. Debit ${debitTotal.toFixed(2)}, kredit ${creditTotal.toFixed(2)}.`,
    );
  }
  if (debitTotal.eq(0)) throw new Error('Regjistrimi nuk mund të jetë zero.');
  return { debit: debitTotal.toFixed(2), credit: creditTotal.toFixed(2) };
}

export function reverseLines(lines: JournalLineInput[]): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debit: money(line.credit || '0').toFixed(2),
    credit: money(line.debit || '0').toFixed(2),
    description: line.description,
  }));
}

export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type NormalSide = 'DEBIT' | 'CREDIT';

export function signedBalance(debit: string, credit: string, normal: NormalSide): string {
  const raw = d(debit).minus(d(credit));
  const signed = normal === 'DEBIT' ? raw : raw.neg();
  return money(signed).toFixed(2);
}

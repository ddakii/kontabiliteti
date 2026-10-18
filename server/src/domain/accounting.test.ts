import { describe, expect, it } from 'vitest';
import { calculateDocument, calculateLine, toBaseCurrency } from './invoiceMath';
import { assertBalanced, reverseLines } from './journal';
import { money } from './money';
import { validateAllocations, nextReceivableStatus } from './payments';
import { calculatePayroll, straightLineDepreciation } from './payroll';
import { balanceSheet, cashFlowStatement, incomeStatement, trialBalance } from './reports';
import { agingBucket } from './aging';
import { summarizeVat } from './vat';
import type { ReportLine } from './reports';

describe('paraja dhe rrumbullakja', () => {
  it('rrumbullakon gjysmë-lart në dy dhjetore', () => {
    expect(money('1.005').toFixed(2)).toBe('1.01');
    expect(money('1.004').toFixed(2)).toBe('1.00');
    expect(money('0.999').toFixed(2)).toBe('1.00');
  });
});

describe('fatura', () => {
  it('llogarit zbritjen dhe TVSH-në në nivel rreshti', () => {
    const line = calculateLine({
      description: 'Shërbim kontabiliteti',
      quantity: '2',
      unitPrice: '10',
      discountPercent: '10',
      vatPercent: '18',
      treatment: 'STANDARD',
    });
    expect(line.net).toBe('18.00');
    expect(line.discount).toBe('2.00');
    expect(line.vat).toBe('3.24');
    expect(line.lineTotal).toBe('21.24');
  });

  it('nuk e fut furnizimin e liruar në bazën e tatueshme', () => {
    const totals = calculateDocument([
      {
        description: 'Shërbim i liruar',
        quantity: '1',
        unitPrice: '100',
        vatPercent: '0',
        treatment: 'EXEMPT',
      },
      {
        description: 'Shërbim standard',
        quantity: '1',
        unitPrice: '50',
        vatPercent: '18',
        treatment: 'STANDARD',
      },
    ]);
    expect(totals.taxableBase).toBe('50.00');
    expect(totals.vatTotal).toBe('9.00');
    expect(totals.total).toBe('159.00');
  });

  it('refuzon TVSH-në te trajtimi i liruar', () => {
    expect(() =>
      calculateLine({
        description: 'Gabim',
        quantity: '1',
        unitPrice: '10',
        vatPercent: '18',
        treatment: 'EXEMPT',
      }),
    ).toThrow(/nuk lejon TVSH/);
  });

  it('mban baraspeshën kur totali konvertohet', () => {
    const base = toBaseCurrency('100.00', '18.00', '1.1');
    expect(money(base.net).plus(base.vat).toFixed(2)).toBe(base.total);
  });
});

describe('regjistrimi kontabël', () => {
  it('pranon vetëm regjistrime të baraspeshuara', () => {
    expect(
      assertBalanced([
        { accountId: 'a', debit: '118.00', credit: '0' },
        { accountId: 'b', debit: '0', credit: '100.00' },
        { accountId: 'c', debit: '0', credit: '18.00' },
      ]).debit,
    ).toBe('118.00');
  });

  it('refuzon debitin që nuk barazohet me kreditin', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: '10.00', credit: '0' },
        { accountId: 'b', debit: '0', credit: '9.00' },
      ]),
    ).toThrow(/nuk është i baraspeshuar/);
  });

  it('kthen anën e kundërt për stornim', () => {
    const reversed = reverseLines([
      { accountId: 'a', debit: '5.00', credit: '0.00' },
      { accountId: 'b', debit: '0.00', credit: '5.00' },
    ]);
    expect(reversed[0].credit).toBe('5.00');
    expect(reversed[1].debit).toBe('5.00');
  });
});

describe('pagesat', () => {
  it('lejon pagesë të pjesshme dhe refuzon tejkalimin', () => {
    expect(validateAllocations('40.00', [{ outstanding: '100.00', amount: '40.00' }]).unallocated).toBe('0.00');
    expect(() => validateAllocations('50.00', [{ outstanding: '40.00', amount: '50.00' }])).toThrow(/kalon detyrimin/);
  });

  it('kalon statusin sipas shumës së mbetur', () => {
    expect(
      nextReceivableStatus({
        total: '100.00',
        amountPaid: '40.00',
        amountCredited: '0.00',
        dueDate: '2026-10-01',
        today: '2026-10-18',
      }),
    ).toBe('PARTIALLY_PAID');
    expect(
      nextReceivableStatus({
        total: '100.00',
        amountPaid: '100.00',
        amountCredited: '0.00',
        dueDate: '2026-10-01',
        today: '2026-10-18',
      }),
    ).toBe('PAID');
    expect(
      nextReceivableStatus({
        total: '100.00',
        amountPaid: '0.00',
        amountCredited: '0.00',
        dueDate: '2026-10-01',
        today: '2026-10-18',
      }),
    ).toBe('OVERDUE');
  });
});

describe('pagat — vektor testues, jo normë ligjore', () => {
  it('llogarit pensionin dhe tatimin progresiv sipas rregullave të dhëna', () => {
    const result = calculatePayroll({
      gross: '1000.00',
      pensionEmployeePercent: '5',
      pensionEmployerPercent: '5',
      taxBase: 'GROSS_MINUS_EMPLOYEE_PENSION',
      brackets: [
        { upTo: '200.00', ratePercent: '0' },
        { upTo: '500.00', ratePercent: '4' },
        { upTo: null, ratePercent: '10' },
      ],
    });
    expect(result.pensionEmployee).toBe('50.00');
    expect(result.pensionEmployer).toBe('50.00');
    expect(result.taxableBase).toBe('950.00');
    expect(result.tax).toBe('57.00');
    expect(result.net).toBe('893.00');
  });
});

describe('amortizimi', () => {
  it('llogarit vijën e drejtë mujore', () => {
    expect(straightLineDepreciation({ cost: '1200.00', residual: '0.00', usefulLifeMonths: 12 })).toBe('100.00');
  });
});

describe('raportet nga libri', () => {
  const lines: ReportLine[] = [
    line('1', '1100', 'ARK', 'ASSET', 'DEBIT', '118.00', '0.00'),
    line('1', '4000', 'Të hyrat', 'REVENUE', 'CREDIT', '0.00', '100.00'),
    line('1', '2100', 'TVSH', 'LIABILITY', 'CREDIT', '0.00', '18.00'),
    line('2', '1020', 'Banka', 'ASSET', 'DEBIT', '118.00', '0.00', true),
    line('2', '1100', 'ARK', 'ASSET', 'DEBIT', '0.00', '118.00'),
    line('3', '6000', 'Shpenzime', 'EXPENSE', 'DEBIT', '40.00', '0.00'),
    line('3', '1020', 'Banka', 'ASSET', 'DEBIT', '0.00', '40.00', true),
  ];

  it('baraspeshon bilancin e provës, pasqyrën dhe bilancin', () => {
    const trial = trialBalance(lines);
    expect(trial.balanced).toBe(true);
    expect(trial.debit).toBe(trial.credit);
    const income = incomeStatement(lines);
    expect(income.revenueTotal).toBe('100.00');
    expect(income.expenseTotal).toBe('40.00');
    expect(income.profit).toBe('60.00');
    const sheet = balanceSheet(lines);
    expect(sheet.balanced).toBe(true);
    expect(sheet.assetTotal).toBe(sheet.liabilitiesAndEquity);
  });

  it('ndjek paranë e arkëtuar dhe të paguar', () => {
    const flow = cashFlowStatement(lines);
    expect(flow.net).toBe('78.00');
  });
});

describe('TVSH', () => {
  it('ndan TVSH-në e zbritshme nga ajo që nuk zbritet', () => {
    const summary = summarizeVat(
      [{ treatment: 'STANDARD', net: '100.00', vat: '18.00' }],
      [
        { treatment: 'STANDARD', net: '50.00', vat: '9.00', deductible: true },
        { treatment: 'STANDARD', net: '10.00', vat: '1.80', deductible: false },
      ],
    );
    expect(summary.salesVat).toBe('18.00');
    expect(summary.deductibleVat).toBe('9.00');
    expect(summary.nonDeductibleVat).toBe('1.80');
    expect(summary.vatPosition).toBe('9.00');
  });
});

describe('vjetërsimi i borxheve', () => {
  it('i vendos faturat në intervale sipas datës së raportit', () => {
    expect(agingBucket('2026-10-18', '2026-10-18')).toBe('NOT_DUE');
    expect(agingBucket('2026-10-17', '2026-10-18')).toBe('DAYS_1_30');
    expect(agingBucket('2026-09-01', '2026-10-18')).toBe('DAYS_31_60');
    expect(agingBucket('2026-07-01', '2026-10-18')).toBe('DAYS_90_PLUS');
  });
});

function line(
  entryId: string,
  code: string,
  name: string,
  type: ReportLine['accountType'],
  normal: ReportLine['normalBalance'],
  debit: string,
  credit: string,
  cashAccount = false,
): ReportLine {
  return {
    entryId,
    date: '2026-10-01',
    accountId: code,
    accountCode: code,
    accountName: name,
    accountType: type,
    normalBalance: normal,
    debit,
    credit,
    cashAccount,
  };
}

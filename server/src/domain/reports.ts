import Decimal from 'decimal.js';
import { d, money } from './money';
import type { AccountKind, NormalSide } from './journal';

export type ReportLine = {
  entryId: string;
  date: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountKind;
  normalBalance: NormalSide;
  debit: string;
  credit: string;
  cashAccount?: boolean;
};

export type AccountTotal = {
  accountId: string;
  code: string;
  name: string;
  type: AccountKind;
  normalBalance: NormalSide;
  debit: string;
  credit: string;
  balance: string;
};

function add(map: Map<string, AccountTotal>, line: ReportLine) {
  const current = map.get(line.accountId) ?? {
    accountId: line.accountId,
    code: line.accountCode,
    name: line.accountName,
    type: line.accountType,
    normalBalance: line.normalBalance,
    debit: '0.00',
    credit: '0.00',
    balance: '0.00',
  };
  const debit = money(d(current.debit).plus(line.debit));
  const credit = money(d(current.credit).plus(line.credit));
  const raw = debit.minus(credit);
  const signed = line.normalBalance === 'DEBIT' ? raw : raw.neg();
  map.set(line.accountId, {
    ...current,
    debit: debit.toFixed(2),
    credit: credit.toFixed(2),
    balance: money(signed).toFixed(2),
  });
}

export function totalsByAccount(lines: ReportLine[]): AccountTotal[] {
  const map = new Map<string, AccountTotal>();
  for (const line of lines) add(map, line);
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'sq'));
}

export function trialBalance(lines: ReportLine[]) {
  const accounts = totalsByAccount(lines).map((account) => {
    const raw = d(account.debit).minus(d(account.credit));
    const debitBalance = raw.gt(0) ? money(raw).toFixed(2) : '0.00';
    const creditBalance = raw.lt(0) ? money(raw.neg()).toFixed(2) : '0.00';
    return { ...account, debitBalance, creditBalance };
  });
  const debit = accounts.reduce((sum, row) => sum.plus(row.debitBalance), new Decimal(0));
  const credit = accounts.reduce((sum, row) => sum.plus(row.creditBalance), new Decimal(0));
  return {
    rows: accounts.filter((row) => d(row.debit).gt(0) || d(row.credit).gt(0)),
    debit: money(debit).toFixed(2),
    credit: money(credit).toFixed(2),
    balanced: money(debit).eq(money(credit)),
  };
}

export function incomeStatement(lines: ReportLine[]) {
  const accounts = totalsByAccount(lines);
  const revenue = accounts.filter((account) => account.type === 'REVENUE');
  const expenses = accounts.filter((account) => account.type === 'EXPENSE');
  const revenueTotal = revenue.reduce((sum, row) => sum.plus(row.balance), new Decimal(0));
  const expenseTotal = expenses.reduce((sum, row) => sum.plus(row.balance), new Decimal(0));
  const profit = money(revenueTotal.minus(expenseTotal));
  return {
    revenue: revenue.filter((row) => !d(row.balance).isZero()),
    expenses: expenses.filter((row) => !d(row.balance).isZero()),
    revenueTotal: money(revenueTotal).toFixed(2),
    expenseTotal: money(expenseTotal).toFixed(2),
    profit: profit.toFixed(2),
  };
}

export function balanceSheet(lines: ReportLine[]) {
  const accounts = totalsByAccount(lines);
  const income = incomeStatement(lines);
  const assets = accounts.filter((account) => account.type === 'ASSET' && !d(account.balance).isZero());
  const liabilities = accounts.filter((account) => account.type === 'LIABILITY' && !d(account.balance).isZero());
  const equity = accounts.filter((account) => account.type === 'EQUITY' && !d(account.balance).isZero());
  const assetTotal = money(assets.reduce((sum, row) => sum.plus(row.balance), new Decimal(0)));
  const liabilityTotal = money(liabilities.reduce((sum, row) => sum.plus(row.balance), new Decimal(0)));
  const equityAccounts = money(equity.reduce((sum, row) => sum.plus(row.balance), new Decimal(0)));
  const currentResult = money(income.profit);
  const equityTotal = money(equityAccounts.plus(currentResult));
  const liabilitiesAndEquity = money(liabilityTotal.plus(equityTotal));
  return {
    assets,
    liabilities,
    equity,
    currentResult: currentResult.toFixed(2),
    assetTotal: assetTotal.toFixed(2),
    liabilityTotal: liabilityTotal.toFixed(2),
    equityTotal: equityTotal.toFixed(2),
    liabilitiesAndEquity: liabilitiesAndEquity.toFixed(2),
    balanced: assetTotal.eq(liabilitiesAndEquity),
  };
}

export function generalLedger(lines: ReportLine[], accountId?: string) {
  const filtered = accountId ? lines.filter((line) => line.accountId === accountId) : lines;
  const grouped = new Map<string, ReportLine[]>();
  for (const line of filtered) {
    const bucket = grouped.get(line.accountId) ?? [];
    bucket.push(line);
    grouped.set(line.accountId, bucket);
  }
  return [...grouped.entries()].map(([id, entries]) => {
    const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId));
    let running = new Decimal(0);
    const rows = ordered.map((line) => {
      const delta = d(line.debit).minus(d(line.credit));
      running = line.normalBalance === 'DEBIT' ? running.plus(delta) : running.minus(delta);
      return { ...line, runningBalance: money(running).toFixed(2) };
    });
    return {
      accountId: id,
      code: ordered[0]?.accountCode ?? '',
      name: ordered[0]?.accountName ?? '',
      rows,
      balance: rows.at(-1)?.runningBalance ?? '0.00',
    };
  });
}

export type CashFlowSection = 'operating' | 'investing' | 'financing';

export function cashFlowStatement(lines: ReportLine[]) {
  const byEntry = new Map<string, ReportLine[]>();
  for (const line of lines) {
    const bucket = byEntry.get(line.entryId) ?? [];
    bucket.push(line);
    byEntry.set(line.entryId, bucket);
  }

  const sections: Record<CashFlowSection, { description: string; amount: string }[]> = {
    operating: [],
    investing: [],
    financing: [],
  };

  for (const entryLines of byEntry.values()) {
    const cashLines = entryLines.filter((line) => line.cashAccount);
    if (cashLines.length === 0) continue;
    const movement = cashLines.reduce(
      (sum, line) => sum.plus(d(line.debit).minus(d(line.credit))),
      new Decimal(0),
    );
    if (money(movement).eq(0)) continue;
    const offsets = entryLines.filter((line) => !line.cashAccount);
    const section = classifyCash(offsets);
    sections[section].push({
      description: offsets[0]?.accountName ?? 'Lëvizje e parasë',
      amount: money(movement).toFixed(2),
    });
  }

  const totalOf = (section: CashFlowSection) =>
    money(sections[section].reduce((sum, row) => sum.plus(row.amount), new Decimal(0))).toFixed(2);

  const operating = totalOf('operating');
  const investing = totalOf('investing');
  const financing = totalOf('financing');
  const net = money(d(operating).plus(investing).plus(financing)).toFixed(2);
  return {
    operating: sections.operating,
    investing: sections.investing,
    financing: sections.financing,
    operatingTotal: operating,
    investingTotal: investing,
    financingTotal: financing,
    net,
    methodNote:
      'Rrjedha e parasë është përgatitur me metodën direkte nga llogaritë e arkës dhe të bankës në regjistrimet e postuara. Klasifikimi është i brendshëm dhe duhet shqyrtuar nga kontabilisti.',
  };
}

function classifyCash(offsets: ReportLine[]): CashFlowSection {
  if (offsets.some((line) => line.accountType === 'EQUITY')) return 'financing';
  if (offsets.some((line) => line.accountCode.startsWith('16') || line.accountCode.startsWith('15'))) {
    return 'investing';
  }
  return 'operating';
}

export function sumBy(lines: { amount: string }[]): string {
  return money(lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0))).toFixed(2);
}

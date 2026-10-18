import { d, money } from './money';

export type AllocationDraft = {
  outstanding: string;
  amount: string;
};

export function validateAllocations(paymentAmount: string, allocations: AllocationDraft[]) {
  const payment = money(paymentAmount);
  if (payment.lte(0)) throw new Error('Shuma e pagesës duhet të jetë më e madhe se zero.');
  if (allocations.length === 0) throw new Error('Pagesa duhet të shpërndahet të paktën në një dokument.');

  let allocated = money(0);
  for (const allocation of allocations) {
    const amount = money(allocation.amount);
    const outstanding = money(allocation.outstanding);
    if (amount.lte(0)) throw new Error('Shuma e shpërndarjes duhet të jetë më e madhe se zero.');
    if (amount.gt(outstanding)) {
      throw new Error('Shpërndarja e kalon detyrimin e mbetur të dokumentit.');
    }
    allocated = allocated.plus(amount);
  }
  if (allocated.gt(payment)) {
    throw new Error('Shuma e shpërndarë e kalon pagesën.');
  }
  return {
    allocated: allocated.toFixed(2),
    unallocated: money(payment.minus(allocated)).toFixed(2),
  };
}

export function nextReceivableStatus(input: {
  total: string;
  amountPaid: string;
  amountCredited: string;
  dueDate: string;
  today: string;
}): 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' {
  const total = money(input.total);
  const paid = money(input.amountPaid);
  const credited = money(input.amountCredited);
  const due = money(total.minus(paid).minus(credited));

  if (credited.gte(total) && paid.eq(0)) return 'CANCELLED';
  if (due.lte(0) && paid.eq(0) && credited.gt(0)) return 'CANCELLED';
  if (due.lte(0)) return 'PAID';
  if (paid.gt(0)) return 'PARTIALLY_PAID';
  if (input.dueDate < input.today) return 'OVERDUE';
  return 'ISSUED';
}

export function assertPaymentFits(outstanding: string, amount: string) {
  if (d(amount).gt(d(outstanding))) {
    throw new Error('Pagesa e kalon detyrimin e mbetur.');
  }
}

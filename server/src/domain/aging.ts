export type AgingBucket = 'NOT_DUE' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_90_PLUS';

export function agingBucket(dueDate: string, asOf: string): AgingBucket {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const asof = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`);
  const days = Math.floor((asof - due) / 86_400_000);
  if (days <= 0) return 'NOT_DUE';
  if (days <= 30) return 'DAYS_1_30';
  if (days <= 60) return 'DAYS_31_60';
  if (days <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}

export const AGING_LABELS: Record<AgingBucket, string> = {
  NOT_DUE: 'Pa kaluar afati',
  DAYS_1_30: '1–30 ditë vonesë',
  DAYS_31_60: '31–60 ditë vonesë',
  DAYS_61_90: '61–90 ditë vonesë',
  DAYS_90_PLUS: 'Mbi 90 ditë vonesë',
};

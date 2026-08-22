export type TuitionStatus = 'paid' | 'pending' | 'overdue';

export const TUITION_STATUS_LABELS: Record<TuitionStatus, string> = {
  paid: '납부',
  pending: '미납',
  overdue: '연체',
};

export const TUITION_STATUS_OPTIONS: TuitionStatus[] = ['paid', 'pending', 'overdue'];

export interface TuitionRecord {
  studentId: string;
  month: string; // YYYY-MM
  status: TuitionStatus;
  amount: number;
  paidDate?: string;
}

export function tuitionKey(studentId: string, month: string): string {
  return `${studentId}_${month}`;
}

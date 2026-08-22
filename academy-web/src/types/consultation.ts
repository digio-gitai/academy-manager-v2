export type ConsultationCategory = 'general' | 'progress' | 'parent' | 'behavior' | 'other';

export const CATEGORY_LABELS: Record<ConsultationCategory, string> = {
  general: '일반',
  progress: '학습 진도',
  parent: '학부모 상담',
  behavior: '태도 / 행동',
  other: '기타',
};

export const CATEGORY_OPTIONS: ConsultationCategory[] = ['general', 'progress', 'parent', 'behavior', 'other'];

export interface ConsultationLogEntry {
  id: string;
  studentId: string;
  category: ConsultationCategory;
  note: string;
  author: string;
  createdAt: string; // YYYY-MM-DD HH:mm
}

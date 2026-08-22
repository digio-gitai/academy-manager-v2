export type HwItemType = 'page_range' | 'wrong_note';

export const HW_ITEM_TYPE_LABELS: Record<HwItemType, string> = {
  page_range: '페이지 범위형',
  wrong_note: '오답정리형',
};

export interface HwItem {
  id: string;
  assignmentId: string;
  itemType: HwItemType;
  materialName: string;
  pageStart?: number;
  pageEnd?: number;
  description?: string;
  studentId?: string; // 없으면 공통 항목, 있으면 그 학생 전용 개별 항목
}

export interface HwAssignment {
  id: string;
  classId: string;
  title: string;
  assignedDate: string; // YYYY-MM-DD
  dueDate?: string;
  studentIds: string[];
  noCertStudentIds: string[];
  includeCommonByStudent: Record<string, boolean>;
}

export type HwItemStatus = 'done' | 'incomplete';

export interface HwSubmissionItemState {
  itemId: string;
  completedPages: number[];
  status: HwItemStatus;
}

export type HwSubmissionStatus = 'not_viewed' | 'viewed' | 'done';

export interface HwSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: HwSubmissionStatus;
  teacherVerified: boolean;
  hasPhoto: boolean;
  notifiedToday: boolean;
  itemStates: HwSubmissionItemState[];
}
